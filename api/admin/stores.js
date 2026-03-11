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

  if (req.method !== 'GET' && req.method !== 'PUT' && req.method !== 'PATCH') {
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
      let adminEmail = (process.env.EMAIL_ADMIN || '').trim();
      if (adminEmail.startsWith('"') && adminEmail.endsWith('"')) adminEmail = adminEmail.slice(1, -1);
      if (adminEmail.startsWith("'") && adminEmail.endsWith("'")) adminEmail = adminEmail.slice(1, -1);
      adminEmail = adminEmail.toLowerCase().trim();
      return apiResponse(res, 200, { stores, menus: menusByStore, adminEmail: adminEmail || null });
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
      let adminEmail = (process.env.EMAIL_ADMIN || '').trim();
      if (adminEmail.startsWith('"') && adminEmail.endsWith('"')) adminEmail = adminEmail.slice(1, -1);
      if (adminEmail.startsWith("'") && adminEmail.endsWith("'")) adminEmail = adminEmail.slice(1, -1);
      adminEmail = adminEmail.toLowerCase().trim();
      const storesWithAdmin = (stores || []).map((s) => {
        const list = Array.isArray(s.allowedEmails) ? [...s.allowedEmails] : [];
        let normalizedList = list.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
        if (adminEmail) {
          normalizedList = normalizedList.filter((e) => e !== adminEmail);
          normalizedList.unshift(adminEmail);
        }
        return { ...s, allowedEmails: normalizedList };
      });
      await saveStoresAndMenus(storesWithAdmin, menus);
      return apiResponse(res, 200, { success: true });
    }

    if (req.method === 'PATCH') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { storeId, email, action } = body;
      const emailTrim = (email && String(email).trim().toLowerCase()) || '';
      if (!storeId || typeof storeId !== 'string' || !emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
        return apiResponse(res, 400, { error: 'storeId와 유효한 email이 필요합니다.' });
      }
      if (action !== 'add' && action !== 'remove') {
        return apiResponse(res, 400, { error: 'action은 add 또는 remove여야 합니다.' });
      }
      const stores = await getStores();
      const storeIndex = (stores || []).findIndex((s) => s.id === storeId.trim());
      if (storeIndex === -1) {
        return apiResponse(res, 404, { error: '해당 그룹(매장)을 찾을 수 없습니다.' });
      }
      const menusByStore = {};
      for (const s of stores) {
        menusByStore[s.id] = await getMenus(s.id);
      }
      let list = Array.isArray(stores[storeIndex].allowedEmails) ? [...stores[storeIndex].allowedEmails] : [];
      list = list.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
      if (action === 'add') {
        if (list.includes(emailTrim)) {
          return apiResponse(res, 200, { success: true });
        }
        list.push(emailTrim);
      } else {
        list = list.filter((e) => e !== emailTrim);
      }
      const updatedStores = stores.slice();
      updatedStores[storeIndex] = { ...updatedStores[storeIndex], allowedEmails: list };
      await saveStoresAndMenus(updatedStores, menusByStore);
      return apiResponse(res, 200, { success: true });
    }
  } catch (error) {
    console.error('Admin stores error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
