/**
 * 주문 취소 + 주문서 PDF 재생성 공통 로직
 * 배송 희망일 4일 전 23:59 (KST) 기준일 계산
 */

const { put } = require('@vercel/blob');
const { getOrderById, updateOrderStatus, updateOrderCancelReason, updateOrderPdfUrl, getStores } = require('./_redis');
const { generateOrderPdf } = require('./_pdf');
const { getStoreForOrder, getStoreDisplayName } = require('./orders/_order-email');
const { sendAlimtalk } = require('./_alimtalk');

/** 배송 희망일 문자열을 (배송일 - 4일) 23:59 KST Date로 변환 */
function getPaymentDeadline(deliveryDateStr) {
  if (!deliveryDateStr || typeof deliveryDateStr !== 'string') return null;
  const s = deliveryDateStr.trim();
  let y, m, d;
  if (/^\d{8}$/.test(s)) {
    y = parseInt(s.slice(0, 4), 10);
    m = parseInt(s.slice(4, 6), 10) - 1;
    d = parseInt(s.slice(6, 8), 10);
  } else {
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    y = parseInt(match[1], 10);
    m = parseInt(match[2], 10) - 1;
    d = parseInt(match[3], 10);
  }
  const date = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
  date.setUTCDate(date.getUTCDate() - 4);
  date.setUTCHours(14, 59, 0, 0); // 23:59 KST = 14:59 UTC
  return date;
}

/** 현재 시각이 결제 마감(배송 희망일 4일 전 23:59 KST)을 지났는지 */
function isPastPaymentDeadline(order) {
  const deadline = getPaymentDeadline(order.delivery_date);
  if (!deadline) return false;
  return Date.now() > deadline.getTime();
}

/** 주문 취소 처리 + 취소 주문서 PDF 재생성 및 URL 갱신. cancelReason: 고객취소 | 관리자취소 | 결제기한만료 | 결제실패 */
async function cancelOrderAndRegeneratePdf(orderId, cancelReason) {
  const order = await getOrderById(orderId);
  if (!order) return null;
  await updateOrderStatus(orderId, 'cancelled');
  await updateOrderCancelReason(orderId, cancelReason || null);
  order.status = 'cancelled';
  order.cancel_reason = cancelReason || null;

  let stores = [];
  try {
    stores = await getStores() || [];
    const pdfBuffer = await generateOrderPdf(order, stores, { isCancelled: true });
    const pathname = `orders/order-${orderId}.pdf`;
    const blob = await put(pathname, pdfBuffer, {
      access: 'public',
      contentType: 'application/pdf',
      allowOverwrite: true,
    });
    await updateOrderPdfUrl(orderId, blob.url);
  } catch (err) {
    console.error('PDF regeneration on cancel:', err);
  }

  // 주문 취소 시 매장 담당자 알림톡
  try {
    const store = getStoreForOrder(order, stores);
    const templateCode = (process.env.NHN_ALIMTALK_TEMPLATE_CODE_STORE_CANCEL_ORDER || '').trim();
    if (store && templateCode) {
      const storeContact = (store.storeContact || '').trim();
      if (storeContact) {
        const storeName = getStoreDisplayName(store);
        await sendAlimtalk({
          templateCode,
          recipientNo: storeContact,
          templateParameter: {
            storeName,
            orderId: order.id,
            cancelReason: (order.cancel_reason || '').trim() || '-',
          },
        });
      }
    }
  } catch (alimErr) {
    console.error('Alimtalk cancel notification error:', alimErr);
  }

  // 주문 취소 시 주문자(고객) 알림톡: cancelReason, storeName, orderId, deliveryDate, deliveryAddress, detailAddress
  try {
    const userTemplateCode = (process.env.NHN_ALIMTALK_TEMPLATE_CODE_USER_CANCEL_ORDER || '').trim();
    const orderContact = (order.contact || '').trim();
    if (userTemplateCode && orderContact) {
      const store = getStoreForOrder(order, stores);
      const storeName = getStoreDisplayName(store);
      await sendAlimtalk({
        templateCode: userTemplateCode,
        recipientNo: orderContact,
        templateParameter: {
          cancelReason: (order.cancel_reason || '').trim() || '-',
          storeName,
          orderId: order.id,
          deliveryDate: (order.delivery_date || '').toString().trim() || '-',
          deliveryAddress: (order.delivery_address || '').trim() || '-',
          detailAddress: (order.detail_address || '').trim() || '-',
        },
      });
    }
  } catch (alimErr) {
    console.error('Alimtalk cancel (user) notification error:', alimErr);
  }

  return order;
}

module.exports = {
  getPaymentDeadline,
  isPastPaymentDeadline,
  cancelOrderAndRegeneratePdf,
};
