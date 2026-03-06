/**
 * GET /api/orders/reject
 * 매장 담당자 이메일의 거부 링크 클릭 시 주문 취소
 * query: orderId, token (이메일 발송 시 저장한 일회용 토큰), reason (schedule|cooking|other)
 * 취소 사유: schedule → 매장 일정 이슈, cooking → 매장 준비 이슈, other → 매장 운영 이슈
 */

const { getOrderById, updateOrderAcceptToken } = require('../_redis');
const { getAppOrigin } = require('../payment/_helpers');
const { cancelOrderAndRegeneratePdf } = require('../_orderCancel');

const REASON_TO_LABEL = {
  schedule: '매장일정이슈',
  cooking: '매장준비이슈',
  other: '매장운영이슈',
};

function pickQuery(req, key) {
  const v = req.query[key] ?? req.query[key.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  const orderId = (pickQuery(req, 'orderId') || '').trim();
  const token = (pickQuery(req, 'token') || '').trim();
  const reason = (pickQuery(req, 'reason') || '').trim().toLowerCase();
  const origin = getAppOrigin(req);

  if (!orderId || !token) {
    return res.redirect(302, `${origin}/?order_reject=error`);
  }

  const cancelLabel = REASON_TO_LABEL[reason];
  if (!cancelLabel) {
    return res.redirect(302, `${origin}/?order_reject=error`);
  }

  const order = await getOrderById(orderId);
  if (!order) {
    return res.redirect(302, `${origin}/?order_reject=error`);
  }

  const currentStatus = order.status || 'submitted';
  if (currentStatus !== 'submitted') {
    return res.redirect(302, `${origin}/?order_reject=already`);
  }

  const storedToken = order.accept_token;
  if (!storedToken || storedToken !== token) {
    return res.redirect(302, `${origin}/?order_reject=error`);
  }

  await cancelOrderAndRegeneratePdf(orderId, cancelLabel);
  await updateOrderAcceptToken(orderId, null);

  return res.redirect(302, `${origin}/?order_reject=success`);
};
