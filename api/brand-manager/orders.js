/**
 * GET /api/brand-manager/orders
 * 브랜드 매니저 권한이 있는 매장에 해당하는 주문만 조회 (어드민 주문관리와 동일 응답 구조, 데이터만 필터)
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrdersForAdmin, getStores, getProfileSettingsBatch } = require('../_redis');
const { getAllowedStoresForManager, getAllowedStoresForManagerExpanded, getAllowedSlugSet } = require('./_helpers');

function orderSlugs(order) {
  const items = order.order_items || order.orderItems || [];
  const slugs = new Set();
  for (const item of items) {
    const id = (item.id || '').toString();
    const slug = (id.split('-')[0] || '').toLowerCase();
    if (slug) slugs.add(slug);
  }
  return slugs;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return apiResponse(res, 200, {});

  if (req.method !== 'GET') return apiResponse(res, 405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const user = verifyToken(authHeader.substring(7));
    if (!user) return apiResponse(res, 401, { error: '로그인이 필요합니다.' });

    const isAdmin = user.level === 'admin';
    const userEmail = (user.email || '').trim().toLowerCase();
    const directlyAllowed = await getAllowedStoresForManager(userEmail);
    const isBrandManager = directlyAllowed.length > 0;

    if (!isAdmin && !isBrandManager) {
      return apiResponse(res, 403, { error: '브랜드 매니저 권한이 필요합니다.' });
    }

    const allowedStores = isAdmin ? await getStores() || [] : await getAllowedStoresForManagerExpanded(userEmail);
    const allowedSlugs = getAllowedSlugSet(allowedStores);

    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 25), 100);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const startDateStr = (req.query.startDate || '').trim();

    let allOrders = await getOrdersForAdmin() || [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) {
      const startMs = new Date(startDateStr + 'T00:00:00+09:00').getTime();
      const endMs = Date.now();
      allOrders = allOrders.filter((o) => {
        const t = new Date(o.created_at).getTime();
        return !Number.isNaN(t) && t >= startMs && t <= endMs;
      });
    }
    const filtered = allOrders.filter((order) => {
      const slugs = orderSlugs(order);
      return [...slugs].some((slug) => allowedSlugs.has(slug));
    });

    const sorted = filtered.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const total = sorted.length;
    const orders = sorted.slice(offset, offset + limit);

    const emails = orders.map((o) => o.user_email || '').filter(Boolean);
    const profilesByEmail = await getProfileSettingsBatch(emails);
    for (const o of orders) {
      const email = (o.user_email || '').trim().toLowerCase();
      const profile = email ? profilesByEmail[email] : null;
      o.profileStoreName = (profile?.storeName || '').trim() || null;
    }

    return apiResponse(res, 200, { orders, total });
  } catch (error) {
    console.error('Brand manager orders error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
