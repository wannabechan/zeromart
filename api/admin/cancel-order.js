/**
 * POST /api/admin/cancel-order
 * 주문 취소 (결제 완료 이전 단계만 가능, admin 전용)
 */

const { getOrderById } = require('../_redis');
const { cancelOrderAndRegeneratePdf } = require('../_orderCancel');
const { verifyToken, apiResponse } = require('../_utils');

const CANCELABLE_STATUSES = ['submitted', 'pending', 'order_accepted', 'payment_link_issued'];

function isAdmin(user) {
  return user && user.level === 'admin';
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return apiResponse(res, 200, {});

  if (req.method !== 'POST') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const user = verifyToken(authHeader.substring(7));
    if (!user || !isAdmin(user)) {
      return apiResponse(res, 403, { error: '관리자만 접근할 수 있습니다.' });
    }

    const { orderId } = req.body && typeof req.body === 'object' ? req.body : {};
    const id = orderId != null ? String(orderId).trim() : '';
    if (!id) {
      return apiResponse(res, 400, { error: 'orderId가 필요합니다.' });
    }

    const order = await getOrderById(id);
    if (!order) {
      return apiResponse(res, 404, { error: '주문을 찾을 수 없습니다.' });
    }

    const status = order.status === 'pending' ? 'submitted' : (order.status || 'submitted');
    if (!CANCELABLE_STATUSES.includes(status)) {
      return apiResponse(res, 400, { error: '결제 완료 이후에는 주문을 취소할 수 없습니다.' });
    }

    if (order.status === 'cancelled') {
      return apiResponse(res, 400, { error: '이미 취소된 주문입니다.' });
    }

    await cancelOrderAndRegeneratePdf(id, '관리자취소');
    return apiResponse(res, 200, { success: true, message: '주문이 취소되었습니다.' });
  } catch (error) {
    console.error('Admin cancel order error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
