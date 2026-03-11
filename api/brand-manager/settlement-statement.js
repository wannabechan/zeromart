/**
 * GET /api/brand-manager/settlement-statement?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&slug=xxx
 * 정산서 데이터. 브랜드 매니저는 권한 있는 매장(slug)만 요청 가능.
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
    const allowedStores = await getAllowedStoresForManager(userEmail);
    const isBrandManager = allowedStores.length > 0;
    if (!isAdmin && !isBrandManager) {
      return apiResponse(res, 403, { error: '브랜드 매니저 권한이 필요합니다.' });
    }

    const startStr = (req.query.startDate || '').trim();
    const endStr = (req.query.endDate || '').trim();
    const slug = (req.query.slug || '').trim().toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) {
      return apiResponse(res, 400, { error: 'startDate, endDate (YYYY-MM-DD)가 필요합니다.' });
    }
    if (!slug) return apiResponse(res, 400, { error: 'slug(브랜드)가 필요합니다.' });

    const allowedSlugs = isAdmin ? new Set((await getStores() || []).map((s) => (s.slug || s.id || '').toString().toLowerCase()).filter(Boolean)) : getAllowedSlugSet(allowedStores);
    if (!allowedSlugs.has(slug)) {
      return apiResponse(res, 403, { error: '해당 브랜드에 대한 권한이 없습니다.' });
    }

    const orders = await getAllOrders() || [];
    const stores = await getStores() || [];

    const filtered = orders.filter((o) => {
      if ((o.status || '') !== 'delivery_completed') return false;
      const d = toKSTDateKey(o.created_at);
      if (!d || d < startStr || d > endStr) return false;
      const store = getStoreForOrder(o, stores);
      const s = (store?.slug || store?.id || '').toString().toLowerCase();
      return s === slug;
    });

    const store = (stores || []).find((s) => (s.slug || s.id || '').toString().toLowerCase() === slug);
    const brandTitle = (store?.brand || store?.title || store?.id || slug).toString().trim() || slug;
    const storeContactEmail = (store?.storeContactEmail || '').trim();
    const representative = (store?.representative || '').trim();

    const byDate = {};
    filtered.forEach((o) => {
      const d = toKSTDateKey(o.created_at);
      if (!d) return;
      if (!byDate[d]) byDate[d] = { date: d, orderCount: 0, totalAmount: 0 };
      byDate[d].orderCount += 1;
      byDate[d].totalAmount += Number(o.total_amount) || 0;
    });

    const days = Object.keys(byDate)
      .sort()
      .map((d) => {
        const row = byDate[d];
        const sales = row.totalAmount;
        const fee = Math.round(sales * 0.048);
        const settlement = sales - fee;
        return { date: d, orderCount: row.orderCount, totalAmount: sales, fee, settlement };
      });

    let totalOrderCount = 0;
    let totalSales = 0;
    let totalFee = 0;
    let totalSettlement = 0;
    days.forEach((r) => {
      totalOrderCount += r.orderCount;
      totalSales += r.totalAmount;
      totalFee += r.fee;
      totalSettlement += r.settlement;
    });

    return apiResponse(res, 200, {
      brandTitle,
      slug,
      storeContactEmail,
      representative,
      startDate: startStr,
      endDate: endStr,
      days,
      totalOrderCount,
      totalSales,
      totalFee,
      totalSettlement,
    });
  } catch (error) {
    console.error('Brand manager settlement-statement error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
