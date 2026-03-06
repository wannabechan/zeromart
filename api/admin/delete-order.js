/**
 * POST /api/admin/delete-order
 * 주문 기록 삭제 (Redis에서 완전 제거, admin 전용)
 */

const { getOrderById, deleteOrder } = require('../_redis');
const { verifyToken, apiResponse } = require('../_utils');

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
    if (!orderId || typeof orderId !== 'string') {
      return apiResponse(res, 400, { error: 'orderId가 필요합니다.' });
    }

    const orderIdStr = orderId.trim();
    const existed = await getOrderById(orderIdStr);
    if (!existed) {
      return apiResponse(res, 404, { error: '주문을 찾을 수 없습니다.' });
    }

    await deleteOrder(orderIdStr);
    return apiResponse(res, 200, { success: true });
  } catch (error) {
    console.error('Admin delete order error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
