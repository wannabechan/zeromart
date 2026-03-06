/**
 * GET /api/orders/accept
 * 매장 담당자 이메일의 "주문 수령하기" 클릭 시 주문 상태를 주문접수(order_accepted)로 변경
 * query: orderId, token (이메일 발송 시 저장한 일회용 토큰)
 */

const { getOrderById, updateOrderStatus, updateOrderAcceptToken } = require('../_redis');
const { getAppOrigin } = require('../payment/_helpers');

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
  const origin = getAppOrigin(req);

  if (!orderId || !token) {
    return res.redirect(302, `${origin}/?order_accept=error`);
  }

  const order = await getOrderById(orderId);
  if (!order) {
    return res.redirect(302, `${origin}/?order_accept=error`);
  }

  const currentStatus = order.status || 'submitted';
  if (currentStatus !== 'submitted') {
    return res.redirect(302, `${origin}/?order_accept=already`);
  }

  const storedToken = order.accept_token;
  if (!storedToken || storedToken !== token) {
    return res.redirect(302, `${origin}/?order_accept=error`);
  }

  await updateOrderStatus(orderId, 'order_accepted');
  await updateOrderAcceptToken(orderId, null);

  return res.redirect(302, `${origin}/?order_accept=success`);
};
