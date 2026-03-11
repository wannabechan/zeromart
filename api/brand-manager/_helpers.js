/**
 * 브랜드 매니저 API 공통: 허용된 매장 목록
 */

const { getStores } = require('../_redis');

const MASTER_MANAGER_EMAIL = 'zeromartmanager@gmail.com';

function isStoreAllowedForManager(store, userEmail) {
  if (!userEmail) return false;
  const normalized = String(userEmail).trim().toLowerCase();
  if (normalized === MASTER_MANAGER_EMAIL) return true;
  const list = Array.isArray(store.managerEmails) ? store.managerEmails : [];
  return list.some((e) => {
    const em = e && typeof e === 'object' && e.email != null ? String(e.email).trim().toLowerCase() : String(e).trim().toLowerCase();
    return em === normalized;
  });
}

async function getAllowedStoresForManager(userEmail) {
  const stores = await getStores() || [];
  return stores.filter((s) => isStoreAllowedForManager(s, userEmail));
}

function getAllowedSlugSet(stores) {
  const set = new Set();
  (stores || []).forEach((s) => {
    const slug = (s.slug || s.id || '').toString().toLowerCase();
    if (slug) set.add(slug);
  });
  return set;
}

module.exports = {
  MASTER_MANAGER_EMAIL,
  isStoreAllowedForManager,
  getAllowedStoresForManager,
  getAllowedSlugSet,
};
