/**
 * GET /api/admin/stores - 매장·메뉴 데이터 조회 (admin 전용)
 * PUT /api/admin/stores - 매장·메뉴 데이터 저장 (admin 전용)
 */

const { getStores, getMenus, saveStoresAndMenus } = require('../_redis');
const { requireAuth, apiResponse, isAdmin, getNormalizedAdminEmail, isAdminEmail } = require('../_utils');

function todayYYYYMMDD() {
  return new Date().toISOString().slice(0, 10);
}

function toEmailEntries(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (item && typeof item === 'object' && typeof item.email === 'string') {
        const e = item.email.trim().toLowerCase();
        return e ? { email: e, addedAt: item.addedAt || null } : null;
      }
      const e = String(item).trim().toLowerCase();
      return e ? { email: e, addedAt: null } : null;
    })
    .filter(Boolean);
}

function emailEntriesToUniqueList(entries) {
  const seen = new Set();
  return entries.filter(({ email }) => {
    if (seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'GET' && req.method !== 'PUT' && req.method !== 'PATCH') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const auth = requireAuth(req);
    if (!auth || !isAdmin(auth.user)) {
      return apiResponse(res, auth ? 403 : 401, { error: auth ? '관리자만 접근할 수 있습니다.' : '로그인이 필요합니다.' });
    }

    if (req.method === 'GET') {
      const stores = await getStores();
      const menusByStore = {};
      for (const store of stores) {
        menusByStore[store.id] = await getMenus(store.id);
      }
      const adminEmail = getNormalizedAdminEmail();
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
      const previousStores = await getStores();
      const adminEmail = getNormalizedAdminEmail();
      const storesWithAdmin = (stores || []).map((s) => {
        const existing = (previousStores || []).find((p) => p.id === s.id);
        const managerEntries = toEmailEntries(existing?.managerEmails || s.managerEmails || []);
        let normalizedManager = emailEntriesToUniqueList(managerEntries).filter((x) => !adminEmail || x.email !== adminEmail);
        let allowedEntries = toEmailEntries(existing?.allowedEmails ?? s.allowedEmails ?? []);
        allowedEntries = emailEntriesToUniqueList(allowedEntries);
        if (adminEmail) {
          allowedEntries = allowedEntries.filter((x) => x.email !== adminEmail);
          allowedEntries.unshift({ email: adminEmail, addedAt: null });
        }
        return { ...s, allowedEmails: allowedEntries, managerEmails: normalizedManager };
      });
      await saveStoresAndMenus(storesWithAdmin, menus);
      return apiResponse(res, 200, { success: true });
    }

    if (req.method === 'PATCH') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { storeId, email, action, type } = body;
      const emailTrim = (email && String(email).trim().toLowerCase()) || '';
      if (!storeId || typeof storeId !== 'string' || !emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
        return apiResponse(res, 400, { error: 'storeId와 유효한 email이 필요합니다.' });
      }
      if (action !== 'add' && action !== 'remove') {
        return apiResponse(res, 400, { error: 'action은 add 또는 remove여야 합니다.' });
      }
      const permType = type === 'manager' ? 'manager' : 'allowed';
      const stores = await getStores();
      const storeIndex = (stores || []).findIndex((s) => s.id === storeId.trim());
      if (storeIndex === -1) {
        return apiResponse(res, 404, { error: '해당 그룹(매장)을 찾을 수 없습니다.' });
      }
      const menusByStore = {};
      for (const s of stores) {
        menusByStore[s.id] = await getMenus(s.id);
      }
      const store = stores[storeIndex];
      if (permType === 'manager') {
        if (action === 'remove' && isAdminEmail(emailTrim)) {
          return apiResponse(res, 400, { error: '관리자(EMAIL_ADMIN) 계정은 브랜드 매니저 목록에서 제거할 수 없습니다.' });
        }
        let list = emailEntriesToUniqueList(toEmailEntries(store.managerEmails || []));
        if (action === 'add') {
          if (!list.some((x) => x.email === emailTrim)) list.push({ email: emailTrim, addedAt: todayYYYYMMDD() });
        } else {
          list = list.filter((x) => x.email !== emailTrim);
        }
        const updatedStores = stores.slice();
        updatedStores[storeIndex] = { ...store, managerEmails: list };
        await saveStoresAndMenus(updatedStores, menusByStore);
        return apiResponse(res, 200, { success: true });
      }
      let list = emailEntriesToUniqueList(toEmailEntries(store.allowedEmails || []));
      if (action === 'add') {
        if (list.some((x) => x.email === emailTrim)) {
          return apiResponse(res, 200, { success: true });
        }
        list.push({ email: emailTrim, addedAt: todayYYYYMMDD() });
      } else {
        list = list.filter((x) => x.email !== emailTrim);
      }
      const updatedStores = stores.slice();
      updatedStores[storeIndex] = { ...store, allowedEmails: list };
      await saveStoresAndMenus(updatedStores, menusByStore);
      return apiResponse(res, 200, { success: true });
    }
  } catch (error) {
    console.error('Admin stores error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
