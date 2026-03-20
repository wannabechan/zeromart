/**
 * GET /api/admin/orders
 * 전체 주문 목록 조회 (admin 전용)
 */

const { requireAuth, apiResponse } = require('../_utils');
const { getOrdersForAdmin, getProfileSettingsBatch } = require('../_redis');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'GET') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const auth = requireAuth(req);
    if (!auth || auth.user.level !== 'admin') {
      return apiResponse(res, auth ? 403 : 401, { error: auth ? '관리자만 접근할 수 있습니다.' : '로그인이 필요합니다.' });
    }

    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 25), 100);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const startDateStr = (req.query.startDate || '').trim();

    let list = await getOrdersForAdmin() || [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) {
      const startMs = new Date(startDateStr + 'T00:00:00+09:00').getTime();
      const endMs = Date.now();
      list = list.filter((o) => {
        const t = new Date(o.created_at).getTime();
        return !Number.isNaN(t) && t >= startMs && t <= endMs;
      });
    }
    const sorted = list.slice().sort((a, b) =>
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' })
    );
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
    console.error('Admin get orders error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
