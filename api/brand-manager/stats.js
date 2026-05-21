/**
 * GET /api/brand-manager/stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * 통계 집계 (브랜드 매니저 전용) — 담당 브랜드 품목이 포함된 주문만 대상으로,
 * 매출은 어드민과 같이 order.total_amount를 품목 금액 비율로 배분해 집계.
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrdersForAdmin, getStores } = require('../_redis');
const { getOrderItemStoreKey } = require('../orders/_order-email');
const { toKSTDateKey, getKSTDayRange } = require('../_kst');
const {
  getAllowedStoresForManager,
  getAllowedStoresForManagerExpanded,
  getAllowedSlugSet,
} = require('./_helpers');

const PAYMENT_CANCEL_WINDOW_MS = 45 * 60 * 1000;
function isWithinPaymentCancelWindow(o) {
  const at = o.payment_completed_at;
  if (!at) return false;
  const ts = new Date(at).getTime();
  return !Number.isNaN(ts) && Date.now() - ts < PAYMENT_CANCEL_WINDOW_MS;
}

function sumItemsGross(items) {
  let s = 0;
  for (const it of items || []) {
    s += (Number(it.price) || 0) * Math.max(0, Number(it.quantity) || 0);
  }
  return s;
}

function grossBySlugFromItems(items) {
  const bySlug = {};
  for (const item of items || []) {
    const slug = getOrderItemStoreKey(item.id);
    if (!slug || slug === 'unknown') continue;
    const amt = (Number(item.price) || 0) * Math.max(0, Number(item.quantity) || 0);
    bySlug[slug] = (bySlug[slug] || 0) + amt;
  }
  return bySlug;
}

/** 주문 total_amount(또는 기대 금액)를 품목 정가 비율로 담당 slug에 배분. 복수 브랜드 주문 시 담당 몫만 반환 */
function allocateOrderAmountByItemGross(order, allowedSlugs, amount) {
  const items = order.order_items || order.orderItems || [];
  const grossAll = sumItemsGross(items);
  if (grossAll <= 0) return {};

  const grossBySlug = grossBySlugFromItems(items);
  const entries = [];
  for (const [slug, gross] of Object.entries(grossBySlug)) {
    if (!allowedSlugs.has(slug) || gross <= 0) continue;
    entries.push({ slug, gross });
  }
  if (entries.length === 0) return {};

  const paid = Math.max(0, Math.floor(Number(amount) || 0));
  const out = {};
  let assigned = 0;
  for (let i = 0; i < entries.length; i++) {
    const { slug, gross } = entries[i];
    let share;
    if (i === entries.length - 1) {
      share = paid - assigned;
    } else {
      share = Math.floor((paid * gross) / grossAll);
      assigned += share;
    }
    if (share > 0) out[slug] = (out[slug] || 0) + share;
  }
  return out;
}

/** 담당 브랜드 메뉴만 대상으로 total_amount를 품목별 정가 비율 배분 (주문 전체 품목 합 기준) */
function allocateOrderAmountByMenuLine(order, allowedSlugs, amount) {
  const items = order.order_items || order.orderItems || [];
  const grossAll = sumItemsGross(items);
  if (grossAll <= 0) return { shares: {}, names: {} };

  const entries = [];
  for (const item of items) {
    const slug = getOrderItemStoreKey(item.id);
    if (!allowedSlugs.has(slug)) continue;
    const id = item.id || '';
    const gross = (Number(item.price) || 0) * Math.max(0, Number(item.quantity) || 0);
    if (gross <= 0) continue;
    entries.push({ key: slug + ':' + id, name: item.name || id, gross });
  }
  if (!entries.length) return { shares: {}, names: {} };

  const paid = Math.max(0, Math.floor(Number(amount) || 0));
  const shares = {};
  const names = {};
  let assigned = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let share;
    if (i === entries.length - 1) share = paid - assigned;
    else {
      share = Math.floor((paid * e.gross) / grossAll);
      assigned += share;
    }
    if (share > 0) {
      shares[e.key] = (shares[e.key] || 0) + share;
      names[e.key] = e.name;
    }
  }
  return { shares, names };
}

function orderHasAllowedBrandItems(order, allowedSlugs) {
  const items = order.order_items || order.orderItems || [];
  return items.some((item) => allowedSlugs.has(getOrderItemStoreKey(item.id)));
}

function getOrderSlugsFromAllowedItems(order, allowedSlugs) {
  const items = order.order_items || order.orderItems || [];
  const slugs = new Set();
  for (const item of items) {
    const slug = getOrderItemStoreKey(item.id);
    if (slug && slug !== 'unknown' && allowedSlugs.has(slug)) slugs.add(slug);
  }
  return slugs.size ? [...slugs] : [];
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

    const startDateStr = (req.query.startDate || '').trim();
    const endDateStr = (req.query.endDate || '').trim();
    const startRange = /^\d{4}-\d{2}-\d{2}$/.test(startDateStr) ? getKSTDayRange(startDateStr) : null;
    const endRange = /^\d{4}-\d{2}-\d{2}$/.test(endDateStr) ? getKSTDayRange(endDateStr) : null;
    const allOrders = await getOrdersForAdmin() || [];

    const orders = [];
    for (const o of allOrders) {
      if (startRange || endRange) {
        const t = new Date(o.created_at).getTime();
        if (Number.isNaN(t)) continue;
        if (startRange && t < startRange.startMs) continue;
        if (endRange && t > endRange.endMs) continue;
      }
      if (orderHasAllowedBrandItems(o, allowedSlugs)) orders.push(o);
    }

    const stores = await getStores() || [];
    const storeTitles = {};
    const storeBrands = {};
    stores.forEach((s) => {
      const slug = (s.slug || s.id || '').toString().toLowerCase();
      if (!allowedSlugs.has(slug)) return;
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

    let cancelledBeforePaymentCount = 0;
    let cancelledAfterPaymentCount = 0;
    let deliveryCompletedCount = 0;
    let unacceptedCount = 0;
    let unpaidCount = 0;

    const isConfirmedPaid = (o) =>
      (o.status === 'payment_completed' && !isWithinPaymentCancelWindow(o)) ||
      o.status === 'shipping' ||
      o.status === 'delivery_completed';

    orders.forEach((o) => {
      const status = o.status || 'submitted';
      const confirmedPaid = isConfirmedPaid(o);
      byStatus[status] = (byStatus[status] || 0) + 1;
      const orderSlugs = getOrderSlugsFromAllowedItems(o, allowedSlugs);
      for (const slug of orderSlugs) {
        byStore[slug] = (byStore[slug] || 0) + 1;
        if (status === 'payment_completed' && !isWithinPaymentCancelWindow(o)) {
          byStorePaymentCompleted[slug] = (byStorePaymentCompleted[slug] || 0) + 1;
        }
        if (status === 'delivery_completed') {
          byStoreDeliveryCompleted[slug] = (byStoreDeliveryCompleted[slug] || 0) + 1;
        }
        if (status === 'cancelled') {
          byStoreCancelled[slug] = (byStoreCancelled[slug] || 0) + 1;
        }
      }
      if (status === 'cancelled') {
        const reason = (o.cancel_reason || '').trim();
        if (reason === '결제취소') cancelledAfterPaymentCount++;
        else cancelledBeforePaymentCount++;
      }

      const items = o.order_items || o.orderItems || [];
      if (confirmedPaid) {
        const paidShares = allocateOrderAmountByItemGross(o, allowedSlugs, o.total_amount);
        for (const [slug, amt] of Object.entries(paidShares)) {
          revenueByStore[slug] = (revenueByStore[slug] || 0) + amt;
          revenueTotal += amt;
        }
      }
      if (status === 'submitted' || status === 'order_accepted' || status === 'payment_link_issued') {
        const expectedShares = allocateOrderAmountByItemGross(o, allowedSlugs, o.total_amount);
        for (const [slug, amt] of Object.entries(expectedShares)) {
          revenueExpectedByStore[slug] = (revenueExpectedByStore[slug] || 0) + amt;
          revenueExpectedTotal += amt;
        }
      }
      if (status === 'delivery_completed') deliveryCompletedCount++;
      if (status === 'submitted') unacceptedCount++;
      if (status === 'payment_link_issued') unpaidCount++;

      const orderDate = toKSTDateKey(o.created_at);
      if (orderDate) byDeliveryDate[orderDate] = (byDeliveryDate[orderDate] || 0) + 1;

      const isExpected = ['submitted', 'order_accepted', 'payment_link_issued'].includes(status);
      const isCancelled = status === 'cancelled';
      if (!isCancelled && confirmedPaid) {
        const menuPaid = allocateOrderAmountByMenuLine(o, allowedSlugs, o.total_amount);
        for (const [key, share] of Object.entries(menuPaid.shares)) {
          menuRevenue[key] = (menuRevenue[key] || 0) + share;
          if (menuPaid.names[key] && !menuOrderCount[key + ':name']) menuOrderCount[key + ':name'] = menuPaid.names[key];
        }
      }
      if (isExpected) {
        const menuExpected = allocateOrderAmountByMenuLine(o, allowedSlugs, o.total_amount);
        for (const [key, share] of Object.entries(menuExpected.shares)) {
          menuExpectedRevenue[key] = (menuExpectedRevenue[key] || 0) + share;
          if (menuExpected.names[key] && !menuOrderCount[key + ':name']) menuOrderCount[key + ':name'] = menuExpected.names[key];
        }
      }
      items.forEach((item) => {
        const slugFromItem = getOrderItemStoreKey(item.id);
        if (!allowedSlugs.has(slugFromItem)) return;
        const id = item.id || '';
        const qty = Number(item.quantity) || 0;
        const key = slugFromItem + ':' + id;
        if (!isCancelled && confirmedPaid) menuOrderCount[key] = (menuOrderCount[key] || 0) + qty;
      });

      const dateKey = toKSTDateKey(o.created_at);
      if (dateKey && confirmedPaid) {
        dailyOrders[dateKey] = (dailyOrders[dateKey] || 0) + 1;
        const dayShares = allocateOrderAmountByItemGross(o, allowedSlugs, o.total_amount);
        dailyRevenue[dateKey] =
          (dailyRevenue[dateKey] || 0) + Object.values(dayShares).reduce((a, b) => a + b, 0);
      }

      const email = (o.user_email || '').trim().toLowerCase();
      if (email && confirmedPaid) {
        customerOrders[email] = (customerOrders[email] || 0) + 1;
        const createdAt = new Date(o.created_at).getTime();
        if (!customerFirstOrder[email] || createdAt < customerFirstOrder[email]) customerFirstOrder[email] = createdAt;
        if (!customerLastOrder[email] || createdAt > customerLastOrder[email]) customerLastOrder[email] = createdAt;
      }
    });

    const totalOrders = orders.length;
    const orderWaitStatuses = ['submitted', 'order_accepted', 'payment_link_issued'];
    const cancelledOrder = (o) => (o.status || '') === 'cancelled';
    const newOrdersCount = orders.filter(
      (o) =>
        !cancelledOrder(o) &&
        (orderWaitStatuses.includes(o.status || '') ||
          (o.status === 'payment_completed' && isWithinPaymentCancelWindow(o)))
    ).length;
    const deliveryWaitCount = orders.filter(
      (o) => (o.status === 'payment_completed' && !isWithinPaymentCancelWindow(o)) || o.status === 'shipping'
    ).length;
    const paymentCompletedOrMore = deliveryWaitCount + (byStatus.delivery_completed || 0);
    const orderSummaryByStatus = {};
    orderSummaryByStatus.new_orders = { count: newOrdersCount, label: '주문대기' };
    orderSummaryByStatus.payment_completed = { count: deliveryWaitCount, label: '주문완료' };
    orderSummaryByStatus.delivery_completed = { count: byStatus.delivery_completed || 0, label: '발송완료' };
    orderSummaryByStatus.cancelled = { count: byStatus.cancelled || 0, label: '취소' };
    const byStoreWithTitle = {};
    Object.entries(byStore).forEach(([slug, count]) => {
      if (!allowedSlugs.has(slug)) return;
      const cancelled = byStoreCancelled[slug] || 0;
      const paymentCompleted = byStorePaymentCompleted[slug] || 0;
      const deliveryCompleted = byStoreDeliveryCompleted[slug] || 0;
      byStoreWithTitle[slug] = {
        count: count - cancelled,
        cancelledCount: cancelled,
        paymentCompletedCount: paymentCompleted,
        deliveryCompletedCount: deliveryCompleted,
        title: storeBrands[slug] || storeTitles[slug] || slug,
      };
    });
    const revenueByStoreWithTitle = {};
    const allRevenueSlugs = new Set([...Object.keys(revenueByStore), ...Object.keys(revenueExpectedByStore)]);
    [...allRevenueSlugs].forEach((slug) => {
      if (!allowedSlugs.has(slug)) return;
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
        revenue: menuRevenue[key] || 0,
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
    const rangeStart = startRange ? startRange.startMs : null;
    const rangeEnd = endRange ? endRange.endMs : null;
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
          if (isConfirmedPaid(o)) {
            orderCount += 1;
            const shares = allocateOrderAmountByItemGross(o, allowedSlugs, o.total_amount);
            totalAmount += Object.values(shares).reduce((a, b) => a + b, 0);
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
        startDate: startDateStr || null,
        endDate: endDateStr || null,
      },
    });
  } catch (error) {
    console.error('Brand manager stats error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
