/**
 * POST /api/admin/delivery-complete
 * 주문을 배송 완료로 변경 (admin 전용, 코드 검증)
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrderById, updateOrderStatus } = require('../_redis');

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

    const { orderId, code } = req.body || {};
    if (!orderId || typeof orderId !== 'string') {
      return apiResponse(res, 400, { error: '주문 번호가 필요합니다.' });
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return apiResponse(res, 404, { error: '주문을 찾을 수 없습니다.' });
    }

    if (order.status !== 'shipping') {
      return apiResponse(res, 400, { error: '배송 번호가 등록된 주문만 배송 완료 처리할 수 있습니다.' });
    }

    const codeTrim = (code || '').trim();
    const valid = codeTrim === orderId || codeTrim === `주문 #${orderId}`;
    if (!valid) {
      return apiResponse(res, 400, { error: '배송 완료 승인 코드 오류' });
    }

    await updateOrderStatus(orderId, 'delivery_completed');
    return apiResponse(res, 200, { success: true });
  } catch (err) {
    console.error('Admin delivery-complete error:', err);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
