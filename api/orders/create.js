/**
 * POST /api/orders/create
 * 주문 생성 (주문서 PDF 생성 후 Vercel Blob 저장)
 */

const { put } = require('@vercel/blob');
const { verifyToken, apiResponse } = require('../_utils');
const {
  createOrder,
  updateOrderPdfUrl,
  getStores,
  checkRateLimitIncr,
  getUser,
  deductUserZeroPoints,
  refundUserZeroPoints,
  appendZeroPointHistory,
} = require('../_redis');
const { persistSlipsIfMissing } = require('./_orderSlips');
const { generateOrderPdf } = require('../_pdf');
const { appendOrderRawLog } = require('../_orderRawLog');

const MIN_PAYABLE_KRW = 10000;

function sumOrderItemsKrw(orderItems) {
  let sum = 0;
  for (const it of orderItems) {
    const qty = Math.floor(Number(it.quantity));
    const price = Math.floor(Number(it.price));
    if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;
    sum += qty * price;
  }
  return sum;
}

/** 앱 주문 요약과 동일: 장바구니 총액(원)과 잔액(포인트) 기준 최대 사용 가능 포인트 */
function maxUsableZeroPointsForOrder(grossKrw, userBalancePoints) {
  const g = Math.max(0, Math.floor(Number(grossKrw) || 0));
  const bal = Math.max(0, Math.floor(Number(userBalancePoints) || 0));
  if (g <= MIN_PAYABLE_KRW || bal <= 0) return 0;
  return Math.min(bal, g - MIN_PAYABLE_KRW);
}

/** 계정·IP 단위 주문 생성 남용 방지 (1시간 윈도) */
const ORDER_CREATE_LIMIT_PER_EMAIL = 40;
const ORDER_CREATE_LIMIT_PER_IP = 120;
const ORDER_CREATE_WINDOW_SECONDS = 3600;

module.exports = async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'POST') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    // 인증 확인
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const token = authHeader.substring(7);
    const user = verifyToken(token);

    if (!user) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const rawFwd = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
    const clientIp = (rawFwd.split(',')[0] || req.socket?.remoteAddress || 'unknown').trim().slice(0, 200);
    const emailNorm = String(user.email || '').trim().toLowerCase();
    const orderRateEmailKey = `ratelimit:order:create:email:${emailNorm}`;
    const orderRateIpKey = `ratelimit:order:create:ip:${clientIp}`;
    const [orderRateEmailOk, orderRateIpOk] = await Promise.all([
      checkRateLimitIncr(orderRateEmailKey, ORDER_CREATE_LIMIT_PER_EMAIL, ORDER_CREATE_WINDOW_SECONDS),
      checkRateLimitIncr(orderRateIpKey, ORDER_CREATE_LIMIT_PER_IP, ORDER_CREATE_WINDOW_SECONDS),
    ]);
    if (!orderRateEmailOk || !orderRateIpOk) {
      return apiResponse(res, 429, { error: '주문 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    }

    const {
      depositor,
      contact,
      expenseType,
      expenseDoc,
      deliveryAddress,
      detailAddress,
      orderItems,
      totalAmount,
      categoryTotals,
      zeroPointsUsed: zeroPointsUsedRaw,
    } = req.body;

    // 필수 필드 검증
    if (!depositor || !contact || !deliveryAddress || !orderItems || !totalAmount) {
      return apiResponse(res, 400, { error: '필수 정보를 모두 입력해 주세요.' });
    }

    // 문자열 길이 제한 (과도한 입력·Redis 남용 방지)
    const str = (v) => (v != null ? String(v).trim() : '');
    if (str(depositor).length > 50) return apiResponse(res, 400, { error: '입금자명은 50자 이내로 입력해 주세요.' });
    if (str(contact).length > 30) return apiResponse(res, 400, { error: '연락처는 30자 이내로 입력해 주세요.' });
    if (str(deliveryAddress).length > 500) return apiResponse(res, 400, { error: '배송 주소는 500자 이내로 입력해 주세요.' });
    if (str(detailAddress).length > 200) return apiResponse(res, 400, { error: '상세 주소는 200자 이내로 입력해 주세요.' });
    if (str(expenseType).length > 20) return apiResponse(res, 400, { error: '경비 구분은 20자 이내로 입력해 주세요.' });
    if (str(expenseDoc).length > 500) return apiResponse(res, 400, { error: '경비 증빙은 500자 이내로 입력해 주세요.' });

    const totalNum = Number(totalAmount);
    if (!Number.isFinite(totalNum) || totalNum < 0 || totalNum > 999_999_999) {
      return apiResponse(res, 400, { error: '총 금액이 올바르지 않습니다.' });
    }

    // orderItems 구조 검증 (배열, 최대 100건, 각 항목 id/name/price/quantity)
    const MAX_ORDER_ITEMS = 100;
    if (!Array.isArray(orderItems) || orderItems.length === 0 || orderItems.length > MAX_ORDER_ITEMS) {
      return apiResponse(res, 400, { error: '주문 메뉴가 올바르지 않습니다.' });
    }
    for (let i = 0; i < orderItems.length; i++) {
      const it = orderItems[i];
      if (!it || typeof it !== 'object' || it.id == null || it.name == null || it.price == null || it.quantity == null) {
        return apiResponse(res, 400, { error: '주문 메뉴 형식이 올바르지 않습니다.' });
      }
      const qty = Number(it.quantity);
      const price = Number(it.price);
      if (!Number.isInteger(qty) || qty < 1 || qty > 999 || !Number.isFinite(price) || price < 0) {
        return apiResponse(res, 400, { error: '주문 메뉴 수량/가격이 올바르지 않습니다.' });
      }
    }

    const grossKrw = sumOrderItemsKrw(orderItems);
    const ptsRequested = Math.floor(Number(zeroPointsUsedRaw));
    const pointsToUse = Number.isFinite(ptsRequested) && ptsRequested > 0 ? ptsRequested : 0;

    if (zeroPointsUsedRaw != null && zeroPointsUsedRaw !== '' && (!Number.isFinite(ptsRequested) || ptsRequested < 0)) {
      return apiResponse(res, 400, { error: '제로포인트 사용 수량이 올바르지 않습니다.' });
    }

    const userRow = await getUser(emailNorm);
    const balancePts = Math.max(0, Math.floor(Number(userRow && userRow.zero_point) || 0));
    const maxUsable = maxUsableZeroPointsForOrder(grossKrw, balancePts);

    if (pointsToUse > maxUsable) {
      return apiResponse(res, 400, { error: '제로포인트 사용이 허용되지 않거나 잔액이 부족합니다.' });
    }

    if (totalNum !== grossKrw - pointsToUse) {
      return apiResponse(res, 400, { error: '결제 금액과 제로포인트 사용 내역이 일치하지 않습니다.' });
    }

    let deductedPoints = 0;
    if (pointsToUse > 0) {
      const dr = await deductUserZeroPoints(emailNorm, pointsToUse);
      if (!dr.ok) {
        if (dr.error === 'insufficient_balance') {
          return apiResponse(res, 400, { error: '제로포인트 잔액이 부족합니다.' });
        }
        return apiResponse(res, 400, { error: '제로포인트 차감에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
      }
      deductedPoints = pointsToUse;
    }

    let order;
    try {
      order = await createOrder({
        user_email: user.email,
        depositor,
        contact,
        expense_type: expenseType || 'none',
        expense_doc: expenseDoc || null,
        delivery_address: deliveryAddress,
        detail_address: detailAddress || null,
        order_items: orderItems,
        total_amount: totalNum,
        zero_point_used: pointsToUse,
      });
    } catch (createErr) {
      if (deductedPoints > 0) {
        try {
          await refundUserZeroPoints(emailNorm, deductedPoints, { orderId: null });
        } catch (refundErr) {
          console.error('Create order: zero point refund after create failure', refundErr);
        }
      }
      throw createErr;
    }

    if (pointsToUse > 0) {
      try {
        await appendZeroPointHistory(emailNorm, {
          code: 'use_order',
          delta: -pointsToUse,
          orderId: String(order.id),
          ts: new Date().toISOString(),
        });
      } catch (histErr) {
        console.error('Create order: appendZeroPointHistory', histErr);
      }
    }

    // 주문서 PDF 생성 및 Vercel Blob 저장
    let stores = [];
    try {
      stores = await getStores();
      const pdfBuffer = await generateOrderPdf(order, stores);
      const pathname = `orders/order-${order.id}.pdf`;
      const blob = await put(pathname, pdfBuffer, {
        access: 'public',
        contentType: 'application/pdf',
      });
      await updateOrderPdfUrl(order.id, blob.url);
    } catch (pdfErr) {
      console.error('PDF generation/upload error:', pdfErr);
      // 주문은 완료됐으므로 PDF 실패만 로깅
    }

    try {
      const storesForSlips = stores.length ? stores : await getStores();
      await persistSlipsIfMissing(order.id, storesForSlips || []);
    } catch (slipErr) {
      console.error('Order create: persist slips', slipErr.message);
    }

    appendOrderRawLog(order, {
      eventType: 'order_created',
      statusAfter: 'submitted',
      actor: 'user',
      note: '주문 접수',
    }).catch((e) => console.error('[orderRawLog]', e.message));

    return apiResponse(res, 201, {
      success: true,
      message: '주문이 접수되었습니다.',
      order: {
        id: order.id,
        createdAt: order.created_at,
      },
    });

  } catch (error) {
    console.error('Create order error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
