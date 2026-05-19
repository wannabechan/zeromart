/**
 * GET /api/admin/zero-points-history-orders?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * 관리자: 발송 완료(`delivery_completed`) 주문을 슬립(브랜드) 단위로 분해해
 *         본래결제금액·사용 포인트(비례 배분)·최종결제금액 행으로 반환.
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

function sumItemsKrw(items) {
  let s = 0;
  for (const it of items || []) {
    const qty = Math.max(0, Number(it.quantity) || 0);
    const price = Number(it.price) || 0;
    s += qty * price;
  }
  return s;
}

/**
 * 한 주문을 슬립(브랜드) 단위로 분해해 ZP History 행으로 변환.
 * 사용 포인트는 슬립별 본래결제금액 비율로 배분하고, 마지막 슬립에서 잔여를 보정해
 * 합계가 주문 단위 zero_point_used와 정확히 일치하도록 한다.
 */
function expandOrderToZpHistoryRows(order, stores) {
  const entries = getStoresWithItemsInOrder(order, stores);
  if (entries.length === 0) return [];
  const orderId = String(order.id || '');
  const orderDate = toKSTDateKey(order.created_at);
  const userEmail = String(order.user_email || '').trim().toLowerCase();
  const totalPointsUsed = Math.max(0, Math.floor(Number(order.zero_point_used) || 0));

  const slipGross = entries.map((e) => sumItemsKrw(e.items));
  const totalGross = slipGross.reduce((a, b) => a + b, 0);

  let assigned = 0;
  const rows = [];
  for (let i = 0; i < entries.length; i++) {
    const { store, slug } = entries[i];
    const gross = slipGross[i];
    let pointsUsed = 0;
    if (totalPointsUsed > 0 && totalGross > 0) {
      if (i === entries.length - 1) {
        pointsUsed = totalPointsUsed - assigned;
      } else {
        pointsUsed = Math.floor((totalPointsUsed * gross) / totalGross);
        assigned += pointsUsed;
      }
    }
    if (pointsUsed < 0) pointsUsed = 0;
    if (pointsUsed > gross) pointsUsed = gross;
    const finalAmount = Math.max(0, gross - pointsUsed);
    rows.push({
      orderDate,
      orderId,
      slipIndex: i + 1,
      orderNumberDisplay: `#${orderId}-${i + 1}`,
      slug: (store?.slug || store?.id || slug || 'unknown').toString().toLowerCase(),
      brandTitle: (store?.brand || store?.title || store?.id || slug || '').toString().trim() || slug,
      suburl: (store?.suburl || '').toString().trim(),
      userEmail,
      grossAmount: gross,
      pointsUsed,
      finalAmount,
    });
  }
  return rows;
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
    if (user.level !== 'admin') return apiResponse(res, 403, { error: '관리자만 접근할 수 있습니다.' });

    let startDate = normalizeDate(String(req.query.startDate || '').trim());
    let endDate = normalizeDate(String(req.query.endDate || '').trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return apiResponse(res, 400, { error: 'startDate·endDate (YYYY-MM-DD)가 필요합니다.' });
    }
    if (startDate > endDate) return apiResponse(res, 400, { error: 'startDate는 endDate 이전이어야 합니다.' });

    const [orders, stores] = await Promise.all([
      getOrdersForAdmin().then((v) => v || []),
      getStores().then((v) => v || []),
    ]);

    const rows = [];
    for (const o of orders) {
      if ((o.status || '') !== 'delivery_completed') continue;
      const orderDate = toKSTDateKey(o.created_at);
      if (!orderDate || orderDate < startDate || orderDate > endDate) continue;
      rows.push(...expandOrderToZpHistoryRows(o, stores));
    }

    rows.sort((a, b) => {
      if (a.orderDate !== b.orderDate) return (b.orderDate || '').localeCompare(a.orderDate || '');
      const idCmp = (b.orderId || '').localeCompare(a.orderId || '');
      if (idCmp !== 0) return idCmp;
      return (a.slipIndex || 0) - (b.slipIndex || 0);
    });

    return apiResponse(res, 200, { startDate, endDate, rows });
  } catch (error) {
    console.error('Admin zero-points-history-orders error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
