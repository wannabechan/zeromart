/**
 * GET /api/brand-manager/settlement?date=YYYY-MM-DD 또는 startDate&endDate
 * 정산 데이터 (발송완료 집계 + 미발송 목록). 브랜드 매니저는 권한 있는 매장만.
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getAllOrders, getStores } = require('../_redis');
const { getStoreForOrder } = require('../orders/_order-email');
const { toKSTDateKey } = require('../_kst');
const { getAllowedStoresForManager, getAllowedSlugSet } = require('./_helpers');

function normalizeDate(str) {
  if (!str || typeof str !== 'string') return '';
  const s = String(str).trim().replace(/\D/g, '');
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (s.length >= 10) return String(str).slice(0, 10);
  return '';
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
    const allowedStoresForCheck = await getAllowedStoresForManager(userEmail);
    const isBrandManager = allowedStoresForCheck.length > 0;
    if (!isAdmin && !isBrandManager) {
      return apiResponse(res, 403, { error: '브랜드 매니저 권한이 필요합니다.' });
    }

    let startDate = (req.query.startDate || '').trim();
    let endDate = (req.query.endDate || '').trim();
    const dateStr = (req.query.date || '').trim();
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      startDate = endDate = normalizeDate(dateStr);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return apiResponse(res, 400, { error: 'date 또는 startDate·endDate (YYYY-MM-DD)가 필요합니다.' });
    }
    startDate = normalizeDate(startDate);
    endDate = normalizeDate(endDate);
    if (startDate > endDate) return apiResponse(res, 400, { error: 'startDate는 endDate 이전이어야 합니다.' });

    const allowedStores = isAdmin ? await getStores() || [] : allowedStoresForCheck;
    const allowedSlugs = getAllowedSlugSet(allowedStores);
    const stores = await getStores() || [];
    const orders = await getAllOrders() || [];

    const deliveryCompleted = orders.filter((o) => {
      if ((o.status || '') !== 'delivery_completed') return false;
      const orderDate = toKSTDateKey(o.created_at);
      if (orderDate < startDate || orderDate > endDate) return false;
      const store = getStoreForOrder(o, stores);
      const slug = (store?.slug || store?.id || 'unknown').toString().toLowerCase();
      return allowedSlugs.has(slug);
    });

    const bySlug = {};
    deliveryCompleted.forEach((o) => {
      const store = getStoreForOrder(o, stores);
      const slug = (store?.slug || store?.id || 'unknown').toString().toLowerCase();
      if (!bySlug[slug]) {
        bySlug[slug] = {
          slug,
          brandTitle: (store?.brand || store?.title || store?.id || slug).toString().trim() || slug,
          orderCount: 0,
          totalAmount: 0,
        };
      }
      bySlug[slug].orderCount += 1;
      bySlug[slug].totalAmount += Number(o.total_amount) || 0;
    });
    const byBrand = Object.values(bySlug).sort((a, b) => (a.brandTitle || '').localeCompare(b.brandTitle || '', 'ko'));

    const pendingShipment = orders.filter((o) => {
      const status = (o.status || '').trim();
      if (status === 'delivery_completed' || status === 'cancelled') return false;
      if (status !== 'payment_completed' && status !== 'shipping') return false;
      const orderDate = toKSTDateKey(o.created_at);
      if (orderDate < startDate || orderDate > endDate) return false;
      const store = getStoreForOrder(o, stores);
      const slug = (store?.slug || store?.id || 'unknown').toString().toLowerCase();
      return allowedSlugs.has(slug);
    }).map((o) => {
      const store = getStoreForOrder(o, stores);
      const slug = (store?.slug || store?.id || 'unknown').toString().toLowerCase();
      const brandTitle = (store?.brand || store?.title || store?.id || slug).toString().trim() || slug;
      return {
        id: o.id,
        created_at: o.created_at,
        orderDate: toKSTDateKey(o.created_at),
        status: o.status,
        total_amount: o.total_amount,
        slug,
        brandTitle,
      };
    }).sort((a, b) => (a.orderDate || '').localeCompare(b.orderDate || '') || (a.created_at || '').localeCompare(b.created_at || ''));

    return apiResponse(res, 200, { startDate, endDate, byBrand, pendingShipment });
  } catch (error) {
    console.error('Brand manager settlement error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
