/**
 * GET /api/manager/stats
 * 통계 집계 (매장 담당자 전용) - 로그인한 담당자 매장에 해당하는 주문만 집계
 * 응답 구조는 /api/admin/stats 와 동일
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getAllOrders, getStores } = require('../_redis');
const { getStoresWithItemsInOrder } = require('../orders/_order-email');

const PAYMENT_CANCEL_WINDOW_MS = 45 * 60 * 1000;
function isWithinPaymentCancelWindow(o) {
  const at = o.payment_completed_at;
  if (!at) return false;
  const ts = new Date(at).getTime();
  return !Number.isNaN(ts) && Date.now() - ts < PAYMENT_CANCEL_WINDOW_MS;
}

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
    const id = (item.id || '').toString();
    const slug = (id.split('-')[0] || '').toLowerCase();
    return managerSlugs.has(slug);
  });
  if (scopedItems.length === 0) return null;

  let scopedTotal = 0;
  for (const item of scopedItems) {
    scopedTotal += Number(item.price || 0) * Math.max(0, Number(item.quantity) || 0);
  }

  return {
    ...order,
    order_items: scopedItems,
    orderItems: scopedItems,
    total_amount: scopedTotal,
  };
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function toDateKey(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getStoreSlugFromOrder(order) {
  const items = order.order_items || order.orderItems || [];
  const firstId = items[0]?.id || '';
  const slug = (firstId.split('-')[0] || '').toLowerCase();
  return slug || 'unknown';
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

    const stores = await getStores() || [];
    const managerEmail = (user.email || '').trim().toLowerCase();
    if (!managerEmail) {
      return apiResponse(res, 403, { error: '담당자로 등록된 매장이 없습니다.' });
    }

    const startDate = parseDate(req.query.startDate);
    const endDate = parseDate(req.query.endDate);
    const allOrders = await getAllOrders() || [];

    const orders = [];
    for (const o of allOrders) {
      if (startDate || endDate) {
        const t = new Date(o.created_at).getTime();
        if (startDate && t < startDate.getTime()) continue;
        if (endDate && t > endDate.getTime() + 86400000) continue;
      }
      const scoped = scopeOrderToManagerStores(o, managerEmail, stores);
      if (scoped) orders.push(scoped);
    }

    const storeTitles = {};
    const storeBrands = {};
    stores.forEach((s) => {
      storeTitles[s.id] = s.title || s.id;
      storeTitles[s.slug] = s.title || s.id;
      storeBrands[s.id] = (s.brand || s.title || s.id).trim() || s.title || s.id;
      storeBrands[s.slug] = storeBrands[s.id];
    });

    const byStatus = {};
    const byStore = {};
    const byStoreCancelled = {};
    const byStorePaymentCompleted = {};
    const byStoreDeliveryCompleted = {};
    let revenueTotal = 0;
    let revenueExpectedTotal = 0;
    const revenueByStore = {};
    const revenueExpectedByStore = {};
    const byDeliveryDate = {};
    const menuOrderCount = {};
    const menuRevenue = {};
    const menuExpectedRevenue = {};
    const dailyOrders = {};
    const dailyRevenue = {};
    const customerOrders = {};
    const customerFirstOrder = {};
    const customerLastOrder = {};

    let submittedCount = 0;
    let paymentCompletedCount = 0;
    let cancelledCount = 0;
    let cancelledBeforePaymentCount = 0;
    let cancelledAfterPaymentCount = 0;
    let deliveryCompletedCount = 0;
    let unacceptedCount = 0;
    let unpaidCount = 0;

    orders.forEach((o) => {
      const status = o.status || 'submitted';
      byStatus[status] = (byStatus[status] || 0) + 1;
      const slug = getStoreSlugFromOrder(o);
      byStore[slug] = (byStore[slug] || 0) + 1;
      if (status === 'payment_completed' && !isWithinPaymentCancelWindow(o)) {
        byStorePaymentCompleted[slug] = (byStorePaymentCompleted[slug] || 0) + 1;
      }
      if (status === 'delivery_completed') {
        byStoreDeliveryCompleted[slug] = (byStoreDeliveryCompleted[slug] || 0) + 1;
      }
      if (status === 'cancelled') {
        byStoreCancelled[slug] = (byStoreCancelled[slug] || 0) + 1;
        const reason = (o.cancel_reason || '').trim();
        if (reason === '결제취소') cancelledAfterPaymentCount++;
        else cancelledBeforePaymentCount++;
      }

      if (status === 'payment_completed' || status === 'shipping' || status === 'delivery_completed') {
        const amt = Number(o.total_amount) || 0;
        revenueTotal += amt;
        revenueByStore[slug] = (revenueByStore[slug] || 0) + amt;
      }
      if (status === 'submitted' || status === 'order_accepted' || status === 'payment_link_issued') {
        const amt = Number(o.total_amount) || 0;
        revenueExpectedTotal += amt;
        revenueExpectedByStore[slug] = (revenueExpectedByStore[slug] || 0) + amt;
      }
      if (status === 'submitted') submittedCount++;
      if (status === 'payment_completed' || status === 'shipping' || status === 'delivery_completed') paymentCompletedCount++;
      if (status === 'cancelled') cancelledCount++;
      if (status === 'delivery_completed') deliveryCompletedCount++;
      if (status === 'submitted') unacceptedCount++;
      if (status === 'payment_link_issued') unpaidCount++;

      const orderDate = (o.created_at || '').toString().trim().slice(0, 10);
      if (orderDate) byDeliveryDate[orderDate] = (byDeliveryDate[orderDate] || 0) + 1;

      const items = o.order_items || o.orderItems || [];
      const isPaid = ['payment_completed', 'shipping', 'delivery_completed'].includes(status);
      const isExpected = ['submitted', 'order_accepted', 'payment_link_issued'].includes(status);
      const isCancelled = status === 'cancelled';
      items.forEach((item) => {
        const id = item.id || '';
        const name = item.name || id;
        const qty = Number(item.quantity) || 0;
        const price = Number(item.price) || 0;
        const slugFromItem = (id.split('-')[0] || '').toLowerCase();
        const key = slugFromItem + ':' + id;
        if (!isCancelled) menuOrderCount[key] = (menuOrderCount[key] || 0) + qty;
        if (isPaid) menuRevenue[key] = (menuRevenue[key] || 0) + price * qty;
        if (isExpected) menuExpectedRevenue[key] = (menuExpectedRevenue[key] || 0) + price * qty;
        if (!menuOrderCount[key + ':name']) menuOrderCount[key + ':name'] = name;
      });

      const dateKey = toDateKey(o.created_at);
      if (dateKey) {
        if (status !== 'cancelled') dailyOrders[dateKey] = (dailyOrders[dateKey] || 0) + 1;
        if (['payment_completed', 'shipping', 'delivery_completed'].includes(status)) {
          dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + (Number(o.total_amount) || 0);
        }
        if (['submitted', 'order_accepted', 'payment_link_issued'].includes(status)) {
          dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + (Number(o.total_amount) || 0);
        }
      }

      const email = (o.user_email || '').trim().toLowerCase();
      if (email) {
        customerOrders[email] = (customerOrders[email] || 0) + 1;
        const createdAt = new Date(o.created_at).getTime();
        if (!customerFirstOrder[email] || createdAt < customerFirstOrder[email]) customerFirstOrder[email] = createdAt;
        if (!customerLastOrder[email] || createdAt > customerLastOrder[email]) customerLastOrder[email] = createdAt;
      }
    });

    const totalOrders = orders.length;
    const orderWaitStatuses = ['submitted', 'order_accepted', 'payment_link_issued'];
    const cancelledOrder = (o) => (o.status || '') === 'cancelled';
    const newOrdersCount = orders.filter((o) => !cancelledOrder(o) && (orderWaitStatuses.includes(o.status || '') || (o.status === 'payment_completed' && isWithinPaymentCancelWindow(o)))).length;
    const deliveryWaitCount = orders.filter((o) => o.status === 'payment_completed' && !isWithinPaymentCancelWindow(o)).length;
    const paymentCompletedOrMore = (byStatus.payment_completed || 0) + (byStatus.shipping || 0) + (byStatus.delivery_completed || 0);
    const orderSummaryByStatus = {};
    orderSummaryByStatus.new_orders = { count: newOrdersCount, label: '주문대기' };
    orderSummaryByStatus.payment_completed = { count: deliveryWaitCount, label: '주문완료' };
    orderSummaryByStatus.delivery_completed = { count: byStatus.delivery_completed || 0, label: '발송완료' };
    orderSummaryByStatus.cancelled = { count: byStatus.cancelled || 0, label: '취소' };
    const byStoreWithTitle = {};
    Object.entries(byStore).forEach(([slug, count]) => {
      const cancelled = byStoreCancelled[slug] || 0;
      const paymentCompleted = byStorePaymentCompleted[slug] || 0;
      const deliveryCompleted = byStoreDeliveryCompleted[slug] || 0;
      byStoreWithTitle[slug] = { count: count - cancelled, cancelledCount: cancelled, paymentCompletedCount: paymentCompleted, deliveryCompletedCount: deliveryCompleted, title: storeBrands[slug] || storeTitles[slug] || slug };
    });
    const revenueByStoreWithTitle = {};
    const allRevenueSlugs = new Set([...Object.keys(revenueByStore), ...Object.keys(revenueExpectedByStore)]);
    [...allRevenueSlugs].forEach((slug) => {
      revenueByStoreWithTitle[slug] = {
        amount: revenueByStore[slug] || 0,
        expected: revenueExpectedByStore[slug] || 0,
        title: storeBrands[slug] || storeTitles[slug] || slug,
      };
    });

    const topMenus = Object.entries(menuOrderCount)
      .filter(([k]) => !k.endsWith(':name'))
      .map(([key, count]) => ({
        id: key.split(':')[1] || key,
        name: menuOrderCount[key + ':name'] || key,
        storeSlug: key.split(':')[0] || '',
        orderCount: count,
        revenue: (menuRevenue[key] || 0) + (menuExpectedRevenue[key] || 0),
      }))
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 20);

    const timeSeries = [];
    const allDays = new Set([...Object.keys(dailyOrders), ...Object.keys(dailyRevenue)]);
    [...allDays].sort().forEach((d) => {
      timeSeries.push({
        date: d,
        orders: dailyOrders[d] || 0,
        revenue: dailyRevenue[d] || 0,
      });
    });

    const uniqueCustomers = Object.keys(customerOrders).length;
    const rangeStart = startDate ? startDate.getTime() : null;
    const rangeEnd = endDate ? endDate.getTime() + 86400000 : null;
    let newCustomers = 0;
    if (rangeStart != null && rangeEnd != null) {
      Object.keys(customerFirstOrder).forEach((email) => {
        const first = customerFirstOrder[email];
        if (first >= rangeStart && first <= rangeEnd) newCustomers++;
      });
    } else {
      newCustomers = uniqueCustomers;
    }
    const now = Date.now();
    const ms30 = 30 * 86400000;
    const ms60 = 60 * 86400000;
    const ms90 = 90 * 86400000;
    let repeatWithin30 = 0;
    let repeatWithin60 = 0;
    let repeatWithin90 = 0;
    Object.keys(customerLastOrder).forEach((email) => {
      const last = customerLastOrder[email];
      if (now - last <= ms30) repeatWithin30++;
      if (now - last <= ms60) repeatWithin60++;
      if (now - last <= ms90) repeatWithin90++;
    });

    const byCustomer = Object.entries(customerOrders)
      .map(([email]) => {
        const customerOrdersList = orders.filter((o) => (o.user_email || '').trim().toLowerCase() === email);
        let orderCount = 0;
        let totalAmount = 0;
        customerOrdersList.forEach((o) => {
          if (o.status !== 'cancelled') orderCount += 1;
          if (['payment_completed', 'shipping', 'delivery_completed'].includes(o.status)) {
            totalAmount += Number(o.total_amount) || 0;
          }
          if (['submitted', 'order_accepted', 'payment_link_issued'].includes(o.status)) {
            totalAmount += Number(o.total_amount) || 0;
          }
        });
        return {
          email,
          orderCount,
          totalAmount,
          lastOrderAt: customerLastOrder[email] ? new Date(customerLastOrder[email]).toISOString() : null,
        };
      })
      .sort((a, b) => b.totalAmount - a.totalAmount);

    return apiResponse(res, 200, {
      orderSummary: {
        total: totalOrders,
        byStatus: orderSummaryByStatus,
        byStore: byStoreWithTitle,
      },
      revenue: {
        total: revenueTotal,
        expected: revenueExpectedTotal,
        byStore: revenueByStoreWithTitle,
      },
      conversion: {
        newOrders: newOrdersCount,
        paymentCompleted: paymentCompletedOrMore,
        cancelledBeforePayment: cancelledBeforePaymentCount,
        cancelledAfterPayment: cancelledAfterPaymentCount,
        deliveryCompleted: deliveryCompletedCount,
      },
      delivery: {
        byDeliveryDate,
        deliveryCompletedCount,
      },
      topMenus,
      timeSeries,
      crm: {
        uniqueCustomers,
        newCustomers,
        repeatWithin30,
        repeatWithin60,
        repeatWithin90,
        byCustomer,
      },
      alerts: {
        unacceptedCount,
        unpaidCount,
      },
      dateRange: {
        startDate: req.query.startDate || null,
        endDate: req.query.endDate || null,
      },
    });
  } catch (error) {
    console.error('Manager stats error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
