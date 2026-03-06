/**
 * GET /api/admin/check-menu-in-use?menuId=xxx
 * 해당 메뉴가 주문 진행 중(비취소)인 주문에 포함되어 있는지 확인 (admin 전용)
 */

const { getAllOrders } = require('../_redis');
const { verifyToken, apiResponse } = require('../_utils');

function isAdmin(user) {
  return user && user.level === 'admin';
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return apiResponse(res, 200, {});

  if (req.method !== 'GET') {
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

    const menuId = typeof req.query.menuId === 'string' ? req.query.menuId.trim() : '';
    if (!menuId) {
      return apiResponse(res, 400, { error: 'menuId가 필요합니다.', inUse: false });
    }

    const allOrders = await getAllOrders();
    for (const order of allOrders) {
      if (order.status === 'cancelled') continue;
      const items = order.order_items || [];
      for (const oi of items) {
        if (oi.id === menuId) {
          return apiResponse(res, 200, { inUse: true });
        }
      }
    }
    return apiResponse(res, 200, { inUse: false });
  } catch (error) {
    console.error('Check menu in use error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.', inUse: false });
  }
};
