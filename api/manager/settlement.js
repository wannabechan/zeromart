/**
 * GET /api/manager/settlement?date=YYYY-MM-DD
 * 해당 날짜에 주문된 건 중 발송완료된 주문 집계 (매장 담당자 전용). zeromart: 주문일(created_at) 기준
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrdersForAdmin, getStores } = require('../_redis');
const { getStoresWithItemsInOrder } = require('../orders/_order-email');
const { toKSTDateKey } = require('../_kst');

function normalizeDate(str) {
  if (!str || typeof str !== 'string') return '';
  const s = String(str).trim().replace(/\D/g, '');
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (s.length >= 10) return String(str).slice(0, 10);
  return '';
}

function scopeOrderToManagerStores(order, managerEmail, stores) {
  const entries = getStoresWithItemsInOrder(order, stores);
  const managerSlugs = new Set();
  const storeBySlug = {};
  for (const { store, slug } of entries) {
    const email = (store?.storeContactEmail || '').trim().toLowerCase();
    if (email === managerEmail) {
      managerSlugs.add(slug);
      storeBySlug[slug] = store;
    }
  }
  if (managerSlugs.size === 0) return null;

  const items = order.order_items || order.orderItems || [];
  const scopedItems = items.filter((item) => {
    const id = (item.id || '').toString();
    const slug = (id.split('-')[0] || '').toLowerCase();
    return managerSlugs.has(slug);
  });
  if (scopedItems.length === 0) return null;

  return { order, scopedItems, storeBySlug };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return apiResponse(res, 200, {});
  if (req.method !== 'GET') return apiResponse(res, 405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }
    const token = authHeader.substring(7);
    const user = verifyToken(token);
    if (!user) return apiResponse(res, 401, { error: '로그인이 필요합니다.' });

    const managerEmail = (user.email || '').trim().toLowerCase();
    if (!managerEmail) {
      return apiResponse(res, 403, { error: '담당자로 등록된 매장이 없습니다.' });
    }

    const dateStr = (req.query.date || '').trim();
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return apiResponse(res, 400, { error: 'date 파라미터가 필요합니다. (YYYY-MM-DD)' });
    }

    const orders = await getOrdersForAdmin() || [];
    const stores = await getStores() || [];
    const targetDate = normalizeDate(dateStr);

    const bySlug = {};
    for (const o of orders) {
      if ((o.status || '') !== 'delivery_completed') continue;
      const orderDate = toKSTDateKey(o.created_at);
      if (orderDate !== targetDate) continue;

      const scoped = scopeOrderToManagerStores(o, managerEmail, stores);
      if (!scoped) continue;

      const { scopedItems, storeBySlug } = scoped;
      const amountBySlug = {};
      for (const item of scopedItems) {
        const slug = (item.id || '').toString().split('-')[0].toLowerCase() || 'unknown';
        const amt = Number(item.price || 0) * Math.max(0, Number(item.quantity) || 0);
        amountBySlug[slug] = (amountBySlug[slug] || 0) + amt;
      }
      for (const slug of Object.keys(amountBySlug)) {
        const store = storeBySlug[slug];
        if (!bySlug[slug]) {
          bySlug[slug] = {
            slug,
            brandTitle: (store?.brand || store?.title || store?.id || slug).toString().trim() || slug,
            orderCount: 0,
            totalAmount: 0,
          };
        }
        bySlug[slug].orderCount += 1;
        bySlug[slug].totalAmount += amountBySlug[slug];
      }
    }

    const byBrand = Object.values(bySlug).sort((a, b) =>
      (a.brandTitle || '').localeCompare(b.brandTitle || '', 'ko')
    );

    return apiResponse(res, 200, {
      date: targetDate,
      byBrand,
    });
  } catch (error) {
    console.error('Manager settlement error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
