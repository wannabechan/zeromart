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

/**
 * 브랜드 매니저가 권한 있는 매장 목록을 **그룹(suburl) 단위로 확장**하여 반환.
 * 어드민 권한 UI는 그룹당 한 행만 보여 주고, "사용자 추가" 시 해당 그룹의 첫 번째 매장에만
 * managerEmails가 저장되므로, 매니저가 접근 가능한 "그룹"의 모든 매장을 반환하려면 확장 필요.
 */
async function getAllowedStoresForManagerExpanded(userEmail) {
  const stores = await getStores() || [];
  const directlyAllowed = stores.filter((s) => isStoreAllowedForManager(s, userEmail));
  const allowedSuburls = new Set();
  directlyAllowed.forEach((s) => {
    const g = (s.suburl || '').toString().trim();
    if (g) allowedSuburls.add(g);
  });
  if (allowedSuburls.size === 0) {
    return directlyAllowed;
  }
  const result = [];
  const addedSlug = new Set();
  directlyAllowed.forEach((s) => {
    const slug = (s.slug || s.id || '').toString().toLowerCase();
    if (slug && !addedSlug.has(slug)) {
      addedSlug.add(slug);
      result.push(s);
    }
  });
  stores.forEach((s) => {
    const slug = (s.slug || s.id || '').toString().toLowerCase();
    if (!slug || addedSlug.has(slug)) return;
    const suburl = (s.suburl || '').toString().trim();
    if (suburl && allowedSuburls.has(suburl)) {
      addedSlug.add(slug);
      result.push(s);
    }
  });
  return result;
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
  getAllowedStoresForManagerExpanded,
  getAllowedSlugSet,
};
