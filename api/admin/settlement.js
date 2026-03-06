/**
 * GET /api/admin/settlement?date=YYYY-MM-DD
 * 해당 날짜에 배송완료된 주문을 브랜드별로 집계 (admin 전용)
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getAllOrders, getStores } = require('../_redis');
const { getStoreForOrder } = require('../orders/_order-email');

/** delivery_date 문자열을 YYYY-MM-DD로 정규화 */
function normalizeDeliveryDate(str) {
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
    const token = authHeader.substring(7);
    const user = verifyToken(token);
    if (!user) return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    if (user.level !== 'admin') return apiResponse(res, 403, { error: '관리자만 접근할 수 있습니다.' });

    const dateStr = (req.query.date || '').trim();
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return apiResponse(res, 400, { error: 'date 파라미터가 필요합니다. (YYYY-MM-DD)' });
    }

    const orders = await getAllOrders() || [];
    const stores = await getStores() || [];

    const targetDate = normalizeDeliveryDate(dateStr);
    const filtered = orders.filter((o) => {
      if ((o.status || '') !== 'delivery_completed') return false;
      return normalizeDeliveryDate(o.delivery_date) === targetDate;
    });

    const bySlug = {};
    filtered.forEach((o) => {
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

    const byBrand = Object.values(bySlug).sort((a, b) =>
      (a.brandTitle || '').localeCompare(b.brandTitle || '', 'ko')
    );

    return apiResponse(res, 200, {
      date: targetDate,
      byBrand,
    });
  } catch (error) {
    console.error('Admin settlement error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
