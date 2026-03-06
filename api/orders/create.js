/**
 * POST /api/orders/create
 * 주문 생성 (주문서 PDF 생성 후 Vercel Blob 저장)
 */

const { put } = require('@vercel/blob');
const { verifyToken, apiResponse } = require('../_utils');
const crypto = require('crypto');
const { createOrder, updateOrderPdfUrl, getStores, updateOrderAcceptToken } = require('../_redis');
const { generateOrderPdf } = require('../_pdf');
const { getAppOrigin } = require('../payment/_helpers');
const { getStoreForOrder, getStoreDisplayName, getStoreEmailForOrder, buildOrderNotificationHtml } = require('./_order-email');
const { sendAlimtalk } = require('../_alimtalk');

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
      deliveryDate,
      deliveryTime,
      deliveryAddress,
      detailAddress,
      orderItems,
      totalAmount,
      categoryTotals,
    } = req.body;

    // 필수 필드 검증
    if (!depositor || !contact || !deliveryDate || !deliveryTime || !deliveryAddress || !orderItems || !totalAmount) {
      return apiResponse(res, 400, { error: '필수 정보를 모두 입력해 주세요.' });
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

    // 최소 주문 금액 검증 (테스트용 100원)
    const TOTAL_MIN = 100;
    const orderTotal = Number(totalAmount) || 0;
    if (orderTotal < TOTAL_MIN) {
      return apiResponse(res, 400, { error: '최소 주문 금액은 100원입니다.' });
    }

    // 주문 생성 (Redis)
    const order = await createOrder({
      user_email: user.email,
      depositor,
      contact,
      expense_type: expenseType || 'none',
      expense_doc: expenseDoc || null,
      delivery_date: deliveryDate,
      delivery_time: deliveryTime,
      delivery_address: deliveryAddress,
      detail_address: detailAddress || null,
      order_items: orderItems,
      total_amount: totalAmount,
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

    // 신규 주문 접수 시 해당 매장 담당자에게 이메일/알림톡 발송
    if (stores.length > 0) {
      const store = getStoreForOrder(order, stores);
      const toEmail = store ? (store.storeContactEmail || '').trim() : null;
      if (process.env.RESEND_API_KEY && toEmail) {
        try {
          const acceptToken = crypto.randomBytes(24).toString('hex');
          await updateOrderAcceptToken(order.id, acceptToken);
          const origin = getAppOrigin(req);
          const acceptUrl = `${origin}/api/orders/accept?orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(acceptToken)}`;
          const rejectUrlSchedule = `${origin}/api/orders/reject?orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(acceptToken)}&reason=schedule`;
          const rejectUrlCooking = `${origin}/api/orders/reject?orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(acceptToken)}&reason=cooking`;
          const rejectUrlOther = `${origin}/api/orders/reject?orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(acceptToken)}&reason=other`;

          const { Resend } = require('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);
          const fromEmail = process.env.RESEND_FROM_EMAIL || 'no-reply@bzcat.co';
          const fromName = process.env.RESEND_FROM_NAME || 'BzCat';
          const storeBrand = (store.brand || store.title || store.id || store.slug || '').trim() || '주문';
          const html = buildOrderNotificationHtml(order, stores, { acceptUrl, rejectUrlSchedule, rejectUrlCooking, rejectUrlOther });
          await resend.emails.send({
            from: `${fromName} <${fromEmail}>`,
            to: toEmail,
            subject: `[BzCat 신규 주문] ${storeBrand} #${order.id}`,
            html,
          });
        } catch (emailErr) {
          console.error('Order notification email error:', emailErr);
          // 이메일 실패해도 주문 접수 응답은 성공으로 반환
        }
      }

      // 신규 주문 알림톡: 해당 매장 담당자 연락처(010 휴대폰)로 발송
      const storeSlug = store ? (store.slug || store.id || '').toString() : '';
      if (!store) {
        console.warn('Alimtalk skip: 주문에 해당하는 매장을 찾을 수 없음. order_items:', order.order_items?.[0]?.id);
      } else {
        const storeContact = (store.storeContact || '').trim();
        const templateCode = (process.env.NHN_ALIMTALK_TEMPLATE_CODE_STORE_NEW_ORDER || '').trim();
        if (!storeContact) {
          console.warn('Alimtalk skip: 매장 담당자연락처(storeContact)가 비어 있음. 매장관리에서 [', storeSlug, '] 매장의 담당자 연락처에 010 휴대폰 번호를 입력하세요.');
        } else if (!templateCode) {
          console.warn('Alimtalk skip: NHN_ALIMTALK_TEMPLATE_CODE_STORE_NEW_ORDER 환경 변수가 비어 있음.');
        } else {
          try {
            const storeName = getStoreDisplayName(store);
            const deliveryDateStr = (order.delivery_date || '').toString().trim() || '-';
            const digits = storeContact.replace(/\D/g, '');
            const maskedNo = digits.length >= 4 ? '010****' + digits.slice(-4) : '***';
            const codeLen = (templateCode || '').length;
            console.log('Alimtalk sending: orderId=', order.id, 'store=', storeSlug, 'recipient=', maskedNo, 'templateCodeLen=', codeLen);
            if (codeLen > 20) {
              console.warn('Alimtalk: NHN templateCode is max 20 chars. Current length=', codeLen, '- use the short template code from NHN console (e.g. STORE_NEW_ORDER), not the long Kakao code.');
            }
            // STORE_NEW_ORDER 템플릿: storeName, orderId, deliveryDate 만 사용
            const result = await sendAlimtalk({
              templateCode,
              recipientNo: storeContact,
              templateParameter: {
                storeName,
                orderId: order.id,
                deliveryDate: deliveryDateStr,
              },
            });
            if (result.success) {
              console.log('Alimtalk sent successfully: orderId=', order.id);
            } else {
              console.error('Order notification alimtalk failed: orderId=', order.id, 'recipient=', maskedNo, 'resultCode=', result.resultCode, 'resultMessage=', result.resultMessage);
            }
          } catch (alimErr) {
            console.error('Order notification alimtalk error: orderId=', order.id, alimErr);
          }
        }
      }

      // 신규 주문 알림톡: 주문자(고객) 연락처로 발송 (주문 접수 안내)
      const orderContact = (order.contact || '').trim();
      const userTemplateCode = (process.env.NHN_ALIMTALK_TEMPLATE_CODE_USER_NEW_ORDER || '').trim();
      // 주문자 알림톡: USER_NEW_ORDER 템플릿 (env NHN_ALIMTALK_TEMPLATE_CODE_USER_NEW_ORDER = USER_NEW_ORDER)
      if (orderContact && userTemplateCode && store) {
        try {
          const storeName = getStoreDisplayName(store);
          const totalAmountStr = Number(order.total_amount || 0).toLocaleString() + '원';
          const deliveryDateStr = (order.delivery_date || '').toString().trim() || '-';
          const deliveryAddressStr = (order.delivery_address || '').trim() || '-';
          const detailAddressStr = (order.detail_address || '').trim() || '-';
          const digitsU = orderContact.replace(/\D/g, '');
          const maskedU = digitsU.length >= 4 ? '010****' + digitsU.slice(-4) : '***';
          console.log('Alimtalk (user) sending: orderId=', order.id, 'recipient=', maskedU);
          // USER_NEW_ORDER 템플릿: depositor, storeName, orderId, totalAmount, deliveryDate, deliveryAddress, detailAddress
          const depositorStr = (order.depositor || '').trim() || '-';
          const resultUser = await sendAlimtalk({
            templateCode: userTemplateCode,
            recipientNo: orderContact,
            templateParameter: {
              depositor: depositorStr,
              storeName,
              orderId: order.id,
              totalAmount: totalAmountStr,
              deliveryDate: deliveryDateStr,
              deliveryAddress: deliveryAddressStr,
              detailAddress: detailAddressStr,
            },
          });
          if (resultUser.success) {
            console.log('Alimtalk (user) sent successfully: orderId=', order.id);
          } else {
            console.error('Order notification alimtalk (user) failed: orderId=', order.id, 'resultCode=', resultUser.resultCode, 'resultMessage=', resultUser.resultMessage);
          }
        } catch (alimErrUser) {
          console.error('Order notification alimtalk (user) error: orderId=', order.id, alimErrUser);
        }
      }
    }

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
