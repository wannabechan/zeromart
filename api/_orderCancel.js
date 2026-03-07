/**
 * 주문 취소 + 주문서 PDF 재생성 공통 로직
 */

const { put } = require('@vercel/blob');
const { getOrderById, updateOrderStatus, updateOrderCancelReason, updateOrderPdfUrl, getStores } = require('./_redis');
const { generateOrderPdf } = require('./_pdf');

const PAYMENT_DEADLINE_HOURS = 24;
const PAYMENT_DEADLINE_MS = PAYMENT_DEADLINE_HOURS * 60 * 60 * 1000;

/** 주문 일시로부터 24시간 경과 시 true (결제 완료 전 자동 취소 대상) */
function isPastPaymentDeadline(order) {
  if (!order || !order.created_at) return false;
  const created = new Date(order.created_at).getTime();
  if (Number.isNaN(created)) return false;
  return Date.now() - created >= PAYMENT_DEADLINE_MS;
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

  return order;
}

module.exports = {
  isPastPaymentDeadline,
  cancelOrderAndRegeneratePdf,
};
