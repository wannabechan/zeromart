/**
 * POST /api/manager/accept-order
 * 주문 접수 목록 페이지에서 매장 담당자가 "주문 수령하기" 클릭 시 (이메일과 동일 동작)
 * 로그인 세션으로 담당자 확인, submitted → order_accepted
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrderById, updateOrderStatus, updateOrderAcceptToken, getStores } = require('../_redis');
const { getStoreEmailForOrder } = require('../orders/_order-email');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'POST') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const token = authHeader.substring(7);
    const user = verifyToken(token);
    if (!user) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const { orderId } = req.body || {};
    const id = (orderId || '').trim();
    if (!id) {
      return apiResponse(res, 400, { error: '주문 번호가 필요합니다.' });
    }

    const stores = await getStores();
    const order = await getOrderById(id);
    if (!order) {
      return apiResponse(res, 404, { error: '주문을 찾을 수 없습니다.' });
    }

    const managerEmail = (getStoreEmailForOrder(order, stores) || '').trim().toLowerCase();
    const userEmail = (user.email || '').trim().toLowerCase();
    if (!managerEmail || managerEmail !== userEmail) {
      return apiResponse(res, 403, { error: '해당 주문의 담당자가 아닙니다.' });
    }

    const currentStatus = order.status || 'submitted';
    if (currentStatus !== 'submitted') {
      return apiResponse(res, 400, { error: '이미 처리된 주문입니다.' });
    }

    await updateOrderStatus(id, 'order_accepted');
    await updateOrderAcceptToken(id, null);

    return apiResponse(res, 200, { success: true });
  } catch (error) {
    console.error('Manager accept order error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
