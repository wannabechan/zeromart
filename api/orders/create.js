/**
 * POST /api/orders/create
 * 주문 생성 (주문서 PDF 생성 후 Vercel Blob 저장)
 */

const { put } = require('@vercel/blob');
const { verifyToken, apiResponse } = require('../_utils');
const { createOrder, updateOrderPdfUrl, getStores } = require('../_redis');
const { generateOrderPdf } = require('../_pdf');
const { appendOrderRawLog } = require('../_orderRawLog');

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

    // 주문 생성 (Redis) — zeromart: 배송희망일/시간 없음, 주문 시 매장에 배송 목록 전달
    const order = await createOrder({
      user_email: user.email,
      depositor,
      contact,
      expense_type: expenseType || 'none',
      expense_doc: expenseDoc || null,
      delivery_address: deliveryAddress,
      detail_address: detailAddress || null,
      order_items: orderItems,
      total_amount: totalNum,
    });

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
