/**
 * GET /api/admin/stores - 매장·메뉴 데이터 조회 (admin 전용)
 * PUT /api/admin/stores - 매장·메뉴 데이터 저장 (admin 전용)
 */

const { getStores, getMenus, saveStoresAndMenus } = require('../_redis');
const { verifyToken, apiResponse } = require('../_utils');

function isAdmin(user) {
  return user && user.level === 'admin';
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'GET' && req.method !== 'PUT') {
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

    if (req.method === 'GET') {
      const stores = await getStores();
      const menusByStore = {};
      for (const store of stores) {
        menusByStore[store.id] = await getMenus(store.id);
      }
      return apiResponse(res, 200, { stores, menus: menusByStore });
    }

    if (req.method === 'PUT') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { stores, menus } = body;
      if (!Array.isArray(stores) || typeof menus !== 'object' || menus === null) {
        return apiResponse(res, 400, { error: 'stores(배열)와 menus(객체)가 필요합니다.' });
      }
      if (stores.length > 100) {
        return apiResponse(res, 400, { error: '매장 수는 100개를 초과할 수 없습니다.' });
      }
      const totalMenus = Object.values(menus).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
      if (totalMenus > 2000) {
        return apiResponse(res, 400, { error: '전체 메뉴 수는 2000개를 초과할 수 없습니다.' });
      }
      await saveStoresAndMenus(stores, menus);
      return apiResponse(res, 200, { success: true });
    }
  } catch (error) {
    console.error('Admin stores error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
