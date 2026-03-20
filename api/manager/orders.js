/**
 * GET /api/manager/orders
 * 매장 담당자 이메일로 등록된 매장의 주문만 조회 (담당자 전용).
 * 복수 카테고리 주문 시 해당 담당자 매장에 해당하는 주문서(슬립)만 반환: order_items와 total_amount를 해당 매장 분만으로 한정.
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrdersForAdmin, getStores } = require('../_redis');
const { getStoresWithItemsInOrder, getOrderItemStoreKey } = require('../orders/_order-email');

function scopeOrderToManagerStores(order, managerEmail, stores) {
  const entries = getStoresWithItemsInOrder(order, stores);
  const managerSlugs = new Set();
  for (const { store, slug } of entries) {
    const email = (store?.storeContactEmail || '').trim().toLowerCase();
    if (email === managerEmail) managerSlugs.add(slug);
  }
  if (managerSlugs.size === 0) return null;

  const items = order.order_items || order.orderItems || [];
  const scopedItems = items.filter((item) => {
    return managerSlugs.has(getOrderItemStoreKey(item.id));
  });
  if (scopedItems.length === 0) return null;

  let scopedTotal = 0;
  for (const item of scopedItems) {
    scopedTotal += Number(item.price || 0) * Math.max(0, Number(item.quantity) || 0);
  }

  // 원본 주문의 슬립 순서(-1, -2, ...)와 일치시키기: entries는 slug 오름차순이므로 index+1이 슬립 번호
  const orderSlipNumbers = [];
  for (let i = 0; i < entries.length; i++) {
    if (managerSlugs.has(entries[i].slug)) orderSlipNumbers.push(i + 1);
  }
  orderSlipNumbers.sort((a, b) => a - b);

  return {
    ...order,
    order_items: scopedItems,
    orderItems: scopedItems,
    total_amount: scopedTotal,
    orderSlipNumbers,
  };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'GET') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const token = authHeader.substring(7);
    const user = verifyToken(token);
    if (!user) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const stores = await getStores();
    const managerEmail = (user.email || '').trim().toLowerCase();
    if (!managerEmail) {
      return apiResponse(res, 403, { error: '담당자로 등록된 매장이 없습니다.' });
    }

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
    const scopedList = [];
    for (const order of allOrders) {
      const scoped = scopeOrderToManagerStores(order, managerEmail, stores);
      if (scoped) scopedList.push(scoped);
    }
    const sorted = scopedList.sort((a, b) =>
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' })
    );
    const total = sorted.length;
    const orders = sorted.slice(offset, offset + limit);

    return apiResponse(res, 200, { orders, total, stores: stores || [] });
  } catch (error) {
    console.error('Manager orders error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
