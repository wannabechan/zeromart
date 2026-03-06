/**
 * 주문 접수 목록 - 매장 담당자 전용 (담당자 이메일로 등록된 매장의 주문만 표시)
 */

const TOKEN_KEY = 'bzcat_token';
const API_BASE = '';
const STORE_ORDERS_TAB_KEY = 'bzcat_store_orders_tab';

let storeOrdersData = [];
let storeOrdersTotal = 0;
let storeOrdersStores = [];
let storeOrdersStoreOrder = [];
let storeOrdersSortBy = 'created_at';
let storeOrdersSortDir = { created_at: 'desc', delivery_date: 'desc' };
let storeOrdersSubFilter = 'new';
let storeOrdersFlashIntervals = [];

const STORE_ORDERS_IDLE_MS = 180000; // 180초 무활동 시 주문 목록 리프레시
const STORE_ORDERS_PAGE_SIZE = 25;
let storeOrdersIdleTimerId = null;
let storeOrdersIdleListenersAttached = false;
let storeOrdersStatsMenuFilter = 'top10';
let storeOrdersStatsLastData = null;

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function escapeHtml(s) {
  if (s == null || s === '') return '';
  const t = String(s);
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getStatusLabel(status, cancelReason) {
  const s = (status || '').trim();
  const labels = {
    submitted: '신청 완료',
    order_accepted: '결제준비중',
    payment_link_issued: '결제 링크 발급',
    payment_completed: '결제 완료',
    shipping: '배송중',
    delivery_completed: '배송 완료',
    cancelled: '주문취소',
  };
  const base = labels[s] || s || '—';
  return s === 'cancelled' && cancelReason ? `${base}(${cancelReason})` : base;
}

function formatAdminOrderDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}. ${m}. ${day} ${h}:${min}`;
}

function formatAdminPrice(price) {
  return Number(price || 0).toLocaleString() + '원';
}

function getStatsDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function getThisWeekMonday(date) {
  const x = new Date(date.getTime());
  const day = x.getDay();
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  return x;
}
function getDefaultStatsRange() {
  const end = new Date();
  const start = getThisWeekMonday(end);
  return { start: getStatsDateStr(start), end: getStatsDateStr(end) };
}
function getPresetStatsRange(preset) {
  const today = new Date();
  if (preset === 'today') {
    const s = getStatsDateStr(today);
    return { start: s, end: s };
  }
  if (preset === 'this_week') {
    const start = getThisWeekMonday(today);
    return { start: getStatsDateStr(start), end: getStatsDateStr(today) };
  }
  if (preset === 'last_week') {
    const thisMon = getThisWeekMonday(today);
    const lastSun = new Date(thisMon.getTime());
    lastSun.setDate(lastSun.getDate() - 1);
    const lastMon = new Date(lastSun.getTime());
    lastMon.setDate(lastMon.getDate() - 6);
    return { start: getStatsDateStr(lastMon), end: getStatsDateStr(lastSun) };
  }
  if (preset === 'this_month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: getStatsDateStr(start), end: getStatsDateStr(today) };
  }
  if (preset === 'last_month') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: getStatsDateStr(start), end: getStatsDateStr(end) };
  }
  return null;
}
function getActiveStatsPreset(startVal, endVal) {
  const presets = ['today', 'this_week', 'last_week', 'this_month', 'last_month'];
  for (const p of presets) {
    const r = getPresetStatsRange(p);
    if (r && r.start === startVal && r.end === endVal) return p;
  }
  return null;
}

/** 신청 완료인데 아직 매장에서 수령/거부를 하지 않은 주문이면 true (목록 연체 강조용) */
function isOverdueForAccept(order) {
  return order.status === 'submitted';
}

/** 배송 희망일 3일 전 00:05 KST를 지났는지 (배송대기 목록에서 '배송 준비' 강조용) */
function isDeliveryPrepareTime(order) {
  const s = (order.delivery_date || '').toString().trim();
  let y, m, d;
  if (/^\d{8}$/.test(s)) {
    y = parseInt(s.slice(0, 4), 10);
    m = parseInt(s.slice(4, 6), 10) - 1;
    d = parseInt(s.slice(6, 8), 10);
  } else {
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return false;
    y = parseInt(match[1], 10);
    m = parseInt(match[2], 10) - 1;
    d = parseInt(match[3], 10);
  }
  // (배송일 - 3일) 00:05 KST = (배송일 - 4일) 15:05 UTC
  const threeDaysBeforeMidnight = new Date(Date.UTC(y, m, d - 3, 0, 0, 0, 0));
  const deadline = new Date(threeDaysBeforeMidnight);
  deadline.setUTCDate(deadline.getUTCDate() - 1);
  deadline.setUTCHours(15, 5, 0, 0);
  return Date.now() >= deadline.getTime();
}

function sortPaymentOrders(orders, sortBy, dir) {
  const copy = orders.slice();
  const asc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  if (sortBy === 'created_at') {
    copy.sort((a, b) => asc(new Date(a.created_at), new Date(b.created_at)));
  } else {
    copy.sort((a, b) => {
      const da = (a.delivery_date || '') + ' ' + (a.delivery_time || '00:00');
      const db = (b.delivery_date || '') + ' ' + (b.delivery_time || '00:00');
      return asc(new Date(da), new Date(db));
    });
  }
  if (dir === 'desc') copy.reverse();
  return copy;
}

function renderOrderDetailHtml(order) {
  const stores = storeOrdersStores || [];
  const slugToTitle = {};
  for (const s of stores) {
    const id = (s.id || s.slug || '').toString().toLowerCase();
    if (id) slugToTitle[id] = s.title || s.id || s.slug || id;
  }
  const orderItems = order.order_items || [];
  const byCategory = {};
  for (const oi of orderItems) {
    const itemId = oi.id || '';
    const slug = (itemId.split('-')[0] || 'default').toLowerCase();
    const item = { name: oi.name || '', price: Number(oi.price) || 0 };
    const qty = Number(oi.quantity) || 0;
    if (qty <= 0) continue;
    if (!byCategory[slug]) byCategory[slug] = [];
    byCategory[slug].push({ item, qty });
  }
  const orderedSlugs = storeOrdersStoreOrder.length
    ? storeOrdersStoreOrder.filter(slug => byCategory[slug])
    : [];
  const restSlugs = Object.keys(byCategory).filter(slug => !orderedSlugs.includes(slug)).sort();
  const categoryOrder = [...orderedSlugs, ...restSlugs];
  for (const slug of Object.keys(byCategory)) {
    byCategory[slug].sort((a, b) => (a.item.name || '').localeCompare(b.item.name || '', 'ko'));
  }
  const categoryTotals = {};
  for (const slug of Object.keys(byCategory)) {
    categoryTotals[slug] = byCategory[slug].reduce((sum, { item, qty }) => sum + item.price * qty, 0);
  }
  const renderItem = ({ item, qty }) => `
    <div class="admin-order-detail-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name || '')}</div>
        <div class="cart-item-price">${formatAdminPrice(item.price)} × ${qty}</div>
      </div>
    </div>
  `;
  return categoryOrder
    .filter(slug => byCategory[slug]?.length)
    .map(slug => {
      const title = slugToTitle[slug] || slug;
      const catTotal = categoryTotals[slug] || 0;
      const itemsHtml = byCategory[slug].map(renderItem).join('');
      return `
        <div class="cart-category-group">
          <div class="cart-category-header">
            <span class="cart-category-title">${escapeHtml(title || '')}</span>
            <span class="cart-category-total met">${formatAdminPrice(catTotal)}</span>
          </div>
          ${itemsHtml}
        </div>
      `;
    })
    .join('');
}

/**
 * @param {object} order
 * @param {{ showButtons?: boolean }} [opts] - showButtons: true면 주문 수령하기 + 거부 3개만 노출 (주문 정보 영역 없음)
 */
function renderOrderAcceptBlock(order, opts = {}) {
  const showButtons = opts.showButtons !== false;
  const orderIdEsc = escapeHtml(String(order.id));
  const buttonsHtml = showButtons
    ? `
      <button type="button" class="store-orders-accept-btn" data-accept-order="${orderIdEsc}">주문 수령하기</button>
      <div class="store-orders-reject-links">
        <span class="store-orders-reject-link" data-order-id="${orderIdEsc}" data-reject-reason="schedule" role="button" tabindex="0">거부:스케줄문제</span><span class="store-orders-reject-sep">&nbsp;&nbsp;|&nbsp;&nbsp;</span><span class="store-orders-reject-link" data-order-id="${orderIdEsc}" data-reject-reason="cooking" role="button" tabindex="0">거부:조리문제</span><span class="store-orders-reject-sep">&nbsp;&nbsp;|&nbsp;&nbsp;</span><span class="store-orders-reject-link" data-order-id="${orderIdEsc}" data-reject-reason="other" role="button" tabindex="0">거부:기타</span>
      </div>`
    : '';
  return showButtons
    ? `<div class="store-orders-accept-block">${buttonsHtml}</div>`
    : '';
}

function openOrderDetail(order) {
  const content = document.getElementById('storeOrderDetailContent');
  const totalEl = document.getElementById('storeOrderDetailTotal');
  const overlay = document.getElementById('storeOrderDetailOverlay');
  const panel = overlay?.querySelector('.admin-order-detail-panel');
  if (!content || !overlay) return;
  const html = renderOrderDetailHtml(order);
  const showAcceptButtons = order.status === 'submitted';
  const acceptBlock = renderOrderAcceptBlock(order, { showButtons: showAcceptButtons });
  content.innerHTML = `<div class="order-detail-list order-detail-cart-style">${html}</div>${acceptBlock}`;
  if (totalEl) totalEl.textContent = formatAdminPrice(order.total_amount || 0);
  if (panel) panel.classList.toggle('admin-order-detail-cancelled', order.status === 'cancelled');

  const acceptBtn = content.querySelector('.store-orders-accept-btn');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', async () => {
      const orderId = acceptBtn.dataset.acceptOrder;
      if (!orderId) return;
      acceptBtn.disabled = true;
      acceptBtn.textContent = '처리 중...';
      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/manager/accept-order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ orderId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || '처리에 실패했습니다.');
          acceptBtn.disabled = false;
          acceptBtn.textContent = '주문 수령하기';
          return;
        }
        const o = storeOrdersData.find(x => x.id === orderId);
        if (o) o.status = 'order_accepted';
        closeOrderDetail();
        renderList();
        alert('주문을 수령했습니다.');
      } catch (e) {
        alert('네트워크 오류가 발생했습니다.');
        acceptBtn.disabled = false;
        acceptBtn.textContent = '주문 수령하기';
      }
    });
  }

  content.querySelectorAll('.store-orders-reject-link[data-order-id][data-reject-reason]').forEach((el) => {
    const orderId = el.dataset.orderId;
    const reason = (el.dataset.rejectReason || '').trim();
    if (!orderId || !reason) return;
    const handleReject = async () => {
      if (!confirm('이 주문을 거부(취소)하시겠습니까?')) return;
      el.style.pointerEvents = 'none';
      const origText = el.textContent;
      el.textContent = '처리 중...';
      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/manager/reject-order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ orderId, reason }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || '거부 처리에 실패했습니다.');
          el.style.pointerEvents = '';
          el.textContent = origText;
          return;
        }
        const o = storeOrdersData.find((x) => x.id === orderId);
        if (o) {
          o.status = 'cancelled';
          o.cancel_reason = { schedule: '매장일정이슈', cooking: '매장준비이슈', other: '매장운영이슈' }[reason];
        }
        closeOrderDetail();
        renderList();
        alert('주문이 거부(취소)되었습니다.');
      } catch (e) {
        alert('네트워크 오류가 발생했습니다.');
        el.style.pointerEvents = '';
        el.textContent = origText;
      }
    };
    el.addEventListener('click', handleReject);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleReject(); } });
  });

  overlay.classList.add('visible');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeOrderDetail() {
  const overlay = document.getElementById('storeOrderDetailOverlay');
  if (overlay) {
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

function renderList() {
  const content = document.getElementById('storeOrdersContent');
  const allOrders = storeOrdersData;
  const cancelled = (o) => o.status === 'cancelled';

  const newCount = allOrders.filter(o => !cancelled(o) && (o.status === 'submitted' || o.status === 'order_accepted')).length;
  const paymentWaitCount = allOrders.filter(o => !cancelled(o) && o.status === 'payment_link_issued').length;
  const deliveryWaitCount = allOrders.filter(o => !cancelled(o) && o.status === 'payment_completed').length;
  const shippingCount = allOrders.filter(o => !cancelled(o) && o.status === 'shipping').length;
  const deliveryCompletedCount = allOrders.filter(o => !cancelled(o) && o.status === 'delivery_completed').length;

  let filtered;
  if (storeOrdersSubFilter === 'new') {
    filtered = allOrders.filter(o => o.status === 'submitted' || o.status === 'order_accepted');
  } else if (storeOrdersSubFilter === 'payment_wait') {
    filtered = allOrders.filter(o => o.status === 'payment_link_issued');
  } else if (storeOrdersSubFilter === 'delivery_wait') {
    filtered = allOrders.filter(o => o.status === 'payment_completed');
  } else if (storeOrdersSubFilter === 'shipping') {
    filtered = allOrders.filter(o => o.status === 'shipping');
  } else if (storeOrdersSubFilter === 'delivery_completed') {
    filtered = allOrders.filter(o => o.status === 'delivery_completed');
  } else {
    filtered = allOrders.slice();
  }

  const sortBy = storeOrdersSortBy;
  const dir = storeOrdersSortDir[sortBy] || 'desc';
  const sorted = sortPaymentOrders(filtered, sortBy, dir);

  const arrow = (key) => (storeOrdersSortDir[key] === 'asc' ? ' ↑' : ' ↓');
  const sortBar = `
    <div class="admin-payment-sort">
      <div class="admin-payment-sort-btns">
        <button type="button" class="admin-payment-sort-btn ${sortBy === 'created_at' ? 'active' : ''}" data-sort="created_at">주문시간${arrow('created_at')}</button>
        <button type="button" class="admin-payment-sort-btn ${sortBy === 'delivery_date' ? 'active' : ''}" data-sort="delivery_date">배송희망일시${arrow('delivery_date')}</button>
      </div>
    </div>
    <div class="admin-payment-subfilter">
      <div class="admin-payment-subfilter-row">
        <span class="admin-payment-subfilter-item ${storeOrdersSubFilter === 'all' ? 'active' : ''}" data-subfilter="all" role="button" tabindex="0">전체보기</span>
        <span class="admin-payment-subfilter-item ${storeOrdersSubFilter === 'new' ? 'active' : ''}" data-subfilter="new" role="button" tabindex="0">신규주문 ${newCount}개</span>
        <span class="admin-payment-subfilter-item ${storeOrdersSubFilter === 'payment_wait' ? 'active' : ''}" data-subfilter="payment_wait" role="button" tabindex="0">결제대기 ${paymentWaitCount}개</span>
      </div>
      <div class="admin-payment-subfilter-row">
        <span class="admin-payment-subfilter-item ${storeOrdersSubFilter === 'delivery_wait' ? 'active' : ''}" data-subfilter="delivery_wait" role="button" tabindex="0">배송대기 ${deliveryWaitCount}개</span>
        <span class="admin-payment-subfilter-item ${storeOrdersSubFilter === 'shipping' ? 'active' : ''}" data-subfilter="shipping" role="button" tabindex="0">배송중 ${shippingCount}개</span>
        <span class="admin-payment-subfilter-item ${storeOrdersSubFilter === 'delivery_completed' ? 'active' : ''}" data-subfilter="delivery_completed" role="button" tabindex="0">배송완료 ${deliveryCompletedCount}개</span>
      </div>
    </div>
  `;

  const ordersHtml = sorted.map(order => {
    const deliveryDate = new Date(order.delivery_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysUntilDelivery = Math.ceil((deliveryDate - today) / (1000 * 60 * 60 * 24));
    const dDayText = daysUntilDelivery < 0 ? 'D+' + Math.abs(daysUntilDelivery) : 'D-' + daysUntilDelivery;
    const dDayClass = daysUntilDelivery < 0 ? 'admin-days-overdue' : (daysUntilDelivery <= 7 ? 'admin-days-urgent' : '');
    const isCancelled = order.status === 'cancelled';
    const overdue = isOverdueForAccept(order);
    const isDeliveryWaitPrepare = storeOrdersSubFilter === 'delivery_wait' && order.status === 'payment_completed' && isDeliveryPrepareTime(order);

    const orderIdEsc = escapeHtml(String(order.id));
    let orderIdEl;
    if (isDeliveryWaitPrepare) {
      orderIdEl = `<span class="admin-payment-order-id store-orders-prepare-flash admin-payment-order-id-link" data-order-detail="${orderIdEsc}" data-prepare-flash role="button" tabindex="0"><span class="store-orders-prepare-id">주문 #${orderIdEsc}</span><span class="store-orders-prepare-msg">배송을 준비해 주세요.</span></span>`;
    } else if (overdue) {
      orderIdEl = `<span class="admin-payment-order-id store-orders-overdue-flash admin-payment-order-id-link" data-order-detail="${orderIdEsc}" data-overdue-flash role="button" tabindex="0"><span class="store-orders-overdue-id">주문 #${orderIdEsc}</span><span class="store-orders-overdue-msg">주문 신청을 승인해 주세요.</span></span>`;
    } else {
      orderIdEl = `<span class="admin-payment-order-id admin-payment-order-id-link" data-order-detail="${orderIdEsc}" role="button" tabindex="0">주문 #${orderIdEsc}</span>`;
    }

    const deliveryAddressFull = escapeHtml([(order.delivery_address || '').trim(), (order.detail_address || '').trim()].filter(Boolean).join(' ') || '—');

    const orderInfoBlock = isDeliveryWaitPrepare
      ? `
        <div class="admin-payment-order-info">
          <div>주문시간: ${formatAdminOrderDate(order.created_at)}</div>
          <div>배송희망: ${escapeHtml(order.delivery_date || '')} ${escapeHtml(order.delivery_time || '')}${isCancelled ? '' : ` <span class="${dDayClass}">(${dDayText})</span>`}</div>
          <div>배송주소: ${deliveryAddressFull}</div>
          <div>주문자: ${escapeHtml((order.depositor || '').trim() || '—')}</div>
          <div>연락처: ${escapeHtml((order.contact || '').trim() || '—')}</div>
          <div>총액: ${formatAdminPrice(order.total_amount)}</div>
        </div>
      `
      : `
        <div class="admin-payment-order-info">
          <div>주문시간: ${formatAdminOrderDate(order.created_at)}</div>
          <div>배송희망: ${escapeHtml(order.delivery_date || '')} ${escapeHtml(order.delivery_time || '')}${isCancelled ? '' : ` <span class="${dDayClass}">(${dDayText})</span>`}</div>
          <div>배송주소: ${escapeHtml((order.delivery_address || '').trim() || '—')}</div>
          <div>총액: ${formatAdminPrice(order.total_amount)}</div>
        </div>
      `;

    const statusLabelEsc = escapeHtml(getStatusLabel(order.status, order.cancel_reason));
    return `
      <div class="admin-payment-order ${isCancelled ? 'admin-payment-order-cancelled' : ''}" data-order-id="${orderIdEsc}">
        <div class="admin-payment-order-header">
          ${orderIdEl}
          <span class="admin-payment-order-status ${order.status}">${statusLabelEsc}</span>
        </div>
        ${orderInfoBlock}
      </div>
    `;
  }).join('');

  const showLoadMore = storeOrdersSubFilter === 'all' && storeOrdersData.length < storeOrdersTotal;
  const loadMoreHtml = showLoadMore
    ? `<div class="store-orders-load-more-wrap"><button type="button" class="store-orders-load-more-btn" data-store-orders-load-more>더 보기</button></div>`
    : '';
  content.innerHTML = sortBar + ordersHtml + loadMoreHtml;

  storeOrdersFlashIntervals.forEach(id => clearInterval(id));
  storeOrdersFlashIntervals = [];
  content.querySelectorAll('[data-overdue-flash]').forEach(el => {
    const id = setInterval(() => {
      el.classList.toggle('store-orders-overdue-show-msg');
    }, 1500);
    storeOrdersFlashIntervals.push(id);
  });
  content.querySelectorAll('[data-prepare-flash]').forEach(el => {
    const id = setInterval(() => {
      el.classList.toggle('store-orders-prepare-show-msg');
    }, 1500);
    storeOrdersFlashIntervals.push(id);
  });

  content.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      if (storeOrdersSortBy === key) {
        storeOrdersSortDir[key] = storeOrdersSortDir[key] === 'asc' ? 'desc' : 'asc';
      } else {
        storeOrdersSortBy = key;
      }
      renderList();
    });
  });

  content.querySelectorAll('[data-subfilter]').forEach(el => {
    const handler = () => {
      storeOrdersSubFilter = el.dataset.subfilter;
      renderList();
    };
    el.addEventListener('click', handler);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
    });
  });

  content.querySelector('[data-store-orders-load-more]')?.addEventListener('click', () => loadMoreStoreOrders());

  content.querySelectorAll('[data-order-detail]').forEach(el => {
    el.addEventListener('click', () => {
      const orderId = el.dataset.orderDetail;
      const order = storeOrdersData.find(o => o.id === orderId);
      if (order) openOrderDetail(order);
    });
  });
}

async function loadStoreOrdersStats() {
  const content = document.getElementById('storeOrdersStatsContent');
  if (!content) return;
  const startInput = document.getElementById('storeOrdersStatsStartDate');
  const endInput = document.getElementById('storeOrdersStatsEndDate');
  let startDate = startInput?.value?.trim() || '';
  let endDate = endInput?.value?.trim() || '';
  const defaultRange = getDefaultStatsRange();
  if (!startDate) startDate = defaultRange.start;
  if (!endDate) endDate = defaultRange.end;

  content.innerHTML = '<div class="admin-loading">로딩 중...</div>';
  try {
    const token = getToken();
    if (!token) {
      content.innerHTML = '<div class="admin-stats-error">로그인이 필요합니다.</div>';
      return;
    }
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const res = await fetch(`${API_BASE}/api/manager/stats?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      content.innerHTML = `<div class="admin-stats-error">${escapeHtml(err.error || '통계를 불러올 수 없습니다.')}</div>`;
      return;
    }
    const data = await res.json();
    storeOrdersStatsLastData = data;
    renderStoreOrdersStats(content, data);
  } catch (e) {
    content.innerHTML = `<div class="admin-stats-error">${escapeHtml(e.message || '통계를 불러올 수 없습니다.')}</div>`;
  }
}

function renderStoreOrdersStats(container, data) {
  const orderSummary = data.orderSummary || {};
  const revenue = data.revenue || {};
  const conversion = data.conversion || {};
  const topMenus = data.topMenus || [];
  const timeSeries = data.timeSeries || [];
  const crm = data.crm || {};
  const dateRange = data.dateRange || {};
  const defaultRange = getDefaultStatsRange();
  const startVal = dateRange.startDate || defaultRange.start;
  const endVal = dateRange.endDate || defaultRange.end;
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  let html = '<div class="admin-stats-toolbar"><div class="admin-stats-daterange"><input type="date" id="storeOrdersStatsStartDate" value="' + escapeHtml(startVal) + '"><span>~</span><input type="date" id="storeOrdersStatsEndDate" value="' + escapeHtml(endVal) + '"><button type="button" class="admin-stats-search-btn" id="storeOrdersStatsApplyBtn" title="조회" aria-label="조회"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button></div>';
  const activePreset = getActiveStatsPreset(startVal, endVal);
  const presetClass = (key) => 'admin-stats-preset-btn' + (activePreset === key ? ' active' : '');
  html += '<div class="admin-stats-presets">';
  html += '<div class="admin-stats-preset-row"><button type="button" class="' + presetClass('today') + '" data-preset="today">오늘</button><button type="button" class="' + presetClass('this_week') + '" data-preset="this_week">이번주</button><button type="button" class="' + presetClass('last_week') + '" data-preset="last_week">지난1주일</button><button type="button" class="' + presetClass('this_month') + '" data-preset="this_month">이번달</button><button type="button" class="' + presetClass('last_month') + '" data-preset="last_month">지난1개월</button></div>';
  html += '</div></div>';
  html += '<div class="admin-stats-section"><h3>주문 현황</h3><p class="admin-stats-big">총 주문 <strong>' + (orderSummary.total ?? 0) + '</strong>건</p><div class="admin-stats-grid">';
  const byStatus = orderSummary.byStatus || {};
  Object.entries(byStatus).forEach(function (e) {
    const v = e[1];
    html += '<div class="admin-stats-card"><span class="admin-stats-card-label">' + escapeHtml((v && v.label) || e[0]) + '</span><span class="admin-stats-card-value">' + ((v && v.count) ?? 0) + '</span></div>';
  });
  html += '</div><br><h4 class="admin-stats-brand-heading">브랜드별 주문</h4><ul class="admin-stats-list">';
  const byStore = orderSummary.byStore || {};
  Object.entries(byStore).forEach(function (e) {
    const v = e[1];
    const progress = (v && v.count) ?? 0;
    const cancelled = (v && v.cancelledCount) ?? 0;
    html += '<li>' + escapeHtml((v && v.title) || e[0]) + ' : 진행 <strong>' + progress + '</strong>건 (취소 <strong>' + cancelled + '</strong>건)</li>';
  });
  html += '</ul></div>';
  const revTotal = Number(revenue.total) || 0;
  const revExpected = Number(revenue.expected) || 0;
  const totalRevText = formatMoney(revTotal) + (revExpected > 0 ? ' (+' + formatMoney(revExpected) + ' 예정)' : '');
  html += '<div class="admin-stats-section"><h3>매출</h3><p class="admin-stats-big">총 매출 <strong>' + totalRevText + '</strong></p><br><h4 class="admin-stats-brand-heading">브랜드별 매출</h4><ul class="admin-stats-list">';
  const revByStore = revenue.byStore || {};
  Object.entries(revByStore).forEach(function (e) {
    const v = e[1];
    const amt = Number(v && v.amount) || 0;
    const exp = Number(v && v.expected) || 0;
    const line = formatMoney(amt) + (exp > 0 ? ' (+' + formatMoney(exp) + ' 예정)' : '');
    html += '<li>' + escapeHtml((v && v.title) || e[0]) + ' : ' + line + '</li>';
  });
  html += '</ul></div>';
  html += '<div class="admin-stats-section"><h3 class="admin-stats-section-title-with-hint">일 매출<span class="admin-stats-section-hint">&nbsp;*매출은 예상매출 포함</span></h3><table class="admin-stats-table admin-stats-table-cols3"><thead><tr><th>날짜</th><th>진행주문</th><th>매출</th></tr></thead><tbody>';
  timeSeries.slice(-14).reverse().forEach(function (d) {
    html += '<tr><td>' + escapeHtml(d.date) + '</td><td>' + d.orders + '</td><td>' + formatMoney(d.revenue) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  const menuFilterLimit = storeOrdersStatsMenuFilter === 'top10' ? 10 : (topMenus.length || 20);
  const menuList = topMenus.slice(0, menuFilterLimit);
  const menuFilterLabel = storeOrdersStatsMenuFilter === 'top10' ? 'top10' : 'all';
  html += '<div class="admin-stats-section"><div class="admin-stats-section-title-row"><h3 class="admin-stats-section-title">메뉴 매출<span class="admin-stats-section-hint">&nbsp;*매출은 예상매출 포함</span></h3><span class="admin-stats-menu-filter"><button type="button" class="admin-stats-menu-filter-btn active" data-menu-filter-toggle>' + menuFilterLabel + '</button></span></div><table class="admin-stats-table admin-stats-table-cols3 admin-stats-table-menu"><thead><tr><th>메뉴</th><th>진행주문</th><th>매출</th></tr></thead><tbody>';
  menuList.forEach(function (m) {
    html += '<tr><td>' + escapeHtml(m.name) + '</td><td>' + m.orderCount + '</td><td>' + formatMoney(m.revenue) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  const totalOrders = Number(orderSummary.total) || 0;
  const n2 = Number(conversion.paymentCompleted) || 0;
  const n3 = Number(conversion.cancelledBeforePayment) || 0;
  const n4 = Number(conversion.cancelledAfterPayment) || 0;
  const n5 = Number(conversion.deliveryCompleted) || 0;
  const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) : '0.0');
  html += '<div class="admin-stats-section"><h3>전환율</h3><ul class="admin-stats-list">';
  html += '<li>전체 주문 <strong>' + totalOrders + '</strong> → 결제완료 <strong>' + n2 + '</strong> (' + pct(n2, totalOrders) + '%)</li>';
  html += '<li>전체 주문 <strong>' + totalOrders + '</strong> → 결제전취소 <strong>' + n3 + '</strong> (' + pct(n3, totalOrders) + '%)</li>';
  html += '<li>결제완료 <strong>' + n2 + '</strong> → 결제후취소 <strong>' + n4 + '</strong> (' + pct(n4, n2) + '%)</li>';
  html += '<li>결제완료 <strong>' + n2 + '</strong> → 배송완료 <strong>' + n5 + '</strong> (' + pct(n5, n2) + '%)</li>';
  html += '</ul></div>';
  html += '<div class="admin-stats-section admin-stats-section-crm"><h3>고객 분석<span class="admin-stats-section-hint">&nbsp;*매출은 예상매출 포함</span></h3><table class="admin-stats-table"><thead><tr><th>이메일</th><th>진행주문</th><th>매출</th><th>마지막 주문일</th><th>고객 클러스터</th></tr></thead><tbody>';
  (crm.byCustomer || []).forEach(function (c) {
    const lastDate = c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString('ko-KR') : '—';
    html += '<tr><td>' + escapeHtml(c.email) + '</td><td>' + c.orderCount + '</td><td>' + formatMoney(c.totalAmount) + '</td><td>' + lastDate + '</td><td>n/a</td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
  document.getElementById('storeOrdersStatsApplyBtn')?.addEventListener('click', loadStoreOrdersStats);
  container.querySelectorAll('.admin-stats-preset-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const preset = btn.getAttribute('data-preset');
      const range = getPresetStatsRange(preset);
      if (!range) return;
      const startEl = document.getElementById('storeOrdersStatsStartDate');
      const endEl = document.getElementById('storeOrdersStatsEndDate');
      if (startEl) startEl.value = range.start;
      if (endEl) endEl.value = range.end;
      loadStoreOrdersStats();
    });
  });
  container.querySelectorAll('[data-menu-filter-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      storeOrdersStatsMenuFilter = storeOrdersStatsMenuFilter === 'top10' ? 'all' : 'top10';
      if (storeOrdersStatsLastData) renderStoreOrdersStats(container, storeOrdersStatsLastData);
    });
  });
}

function showStoreOrdersError(msg) {
  const content = document.getElementById('storeOrdersContent');
  if (!content) return;
  content.innerHTML = `
    <div class="admin-loading admin-error">
      <p>${escapeHtml(msg || '접근할 수 없습니다.')}</p>
      <p style="margin-top:12px;font-size:0.875rem;color:var(--color-text-secondary);">
        매장 담당자 이메일로 로그인한 경우에만 주문 접수 목록을 볼 수 있습니다.
      </p>
      <p style="margin-top:8px;font-size:0.875rem;"><a href="/">메인으로 돌아가기</a></p>
    </div>
  `;
}

async function loadStoreOrders() {
  const content = document.getElementById('storeOrdersContent');
  const token = getToken();
  if (!token) {
    showStoreOrdersError('로그인이 필요합니다.');
    return;
  }

  try {
    const sessionRes = await fetch(`${API_BASE}/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!sessionRes.ok) {
      showStoreOrdersError('세션 확인에 실패했습니다. 다시 로그인해 주세요.');
      return;
    }
    const sessionData = await sessionRes.json();
    const user = sessionData.user;
    if (!user || !user.isStoreManager) {
      showStoreOrdersError('담당자로 등록된 매장이 없습니다. 매장·메뉴 관리에서 담당자 이메일이 설정된 매장만 접근할 수 있습니다.');
      return;
    }

    const res = await fetch(`${API_BASE}/api/manager/orders?limit=${STORE_ORDERS_PAGE_SIZE}&offset=0`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        showStoreOrdersError('접근 권한이 없습니다.');
        return;
      }
      content.innerHTML = '<div class="admin-loading">주문 목록을 불러올 수 없습니다.</div>';
      return;
    }

    const data = await res.json();
    storeOrdersData = data.orders || [];
    storeOrdersTotal = typeof data.total === 'number' ? data.total : storeOrdersData.length;
    storeOrdersStores = data.stores || [];
    storeOrdersStoreOrder = storeOrdersStores.map(s => (s.slug || s.id || '').toString().toLowerCase()).filter(Boolean);

    if (storeOrdersData.length === 0 && storeOrdersTotal === 0) {
      content.innerHTML = '<div class="admin-loading">주문 내역이 없습니다.</div>';
      startStoreOrdersIdleRefresh();
      return;
    }

    renderList();
    startStoreOrdersIdleRefresh();
  } catch (e) {
    content.innerHTML = '<div class="admin-loading admin-error">오류가 발생했습니다. 네트워크를 확인해 주세요.</div>';
  }
}

async function loadMoreStoreOrders() {
  const btn = document.querySelector('[data-store-orders-load-more]');
  if (btn) btn.disabled = true;
  try {
    const token = getToken();
    if (!token) return;
    const offset = storeOrdersData.length;
    const res = await fetch(`${API_BASE}/api/manager/orders?limit=${STORE_ORDERS_PAGE_SIZE}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    const orders = data.orders || [];
    if (orders.length) {
      storeOrdersData = storeOrdersData.concat(orders);
      renderList();
    }
  } catch (_) {}
  if (btn) btn.disabled = false;
}

function resetStoreOrdersIdleTimer() {
  if (storeOrdersIdleTimerId != null) clearTimeout(storeOrdersIdleTimerId);
  storeOrdersIdleTimerId = setTimeout(() => {
    loadStoreOrders().then(() => resetStoreOrdersIdleTimer());
  }, STORE_ORDERS_IDLE_MS);
}

function startStoreOrdersIdleRefresh() {
  if (storeOrdersIdleTimerId != null) clearTimeout(storeOrdersIdleTimerId);
  storeOrdersIdleTimerId = setTimeout(() => {
    loadStoreOrders().then(() => resetStoreOrdersIdleTimer());
  }, STORE_ORDERS_IDLE_MS);
  if (!storeOrdersIdleListenersAttached) {
    storeOrdersIdleListenersAttached = true;
    document.addEventListener('click', resetStoreOrdersIdleTimer);
    document.addEventListener('keydown', resetStoreOrdersIdleTimer);
    document.addEventListener('input', resetStoreOrdersIdleTimer);
  }
}

document.getElementById('storeOrderDetailClose')?.addEventListener('click', closeOrderDetail);
document.getElementById('storeOrderDetailOverlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'storeOrderDetailOverlay') closeOrderDetail();
});

/** YYYY-MM-DD */
function toDateKey(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** yy/mm/dd hh:mm:ss (실시간 시계용) */
function formatSettlementClock() {
  const x = new Date();
  const yy = String(x.getFullYear()).slice(-2);
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  const hh = String(x.getHours()).padStart(2, '0');
  const min = String(x.getMinutes()).padStart(2, '0');
  const ss = String(x.getSeconds()).padStart(2, '0');
  return `${yy}/${mm}/${dd} ${hh}:${min}:${ss}`;
}

function renderStoreSettlementTable(byBrand) {
  if (!byBrand || byBrand.length === 0) {
    return '<p class="admin-settlement-empty">해당 날짜에 배송 완료된 주문이 없습니다.</p>';
  }
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  let html = '<table class="admin-stats-table"><thead><tr><th>브랜드</th><th>주문 수</th><th>판매금액</th><th>수수료</th><th>정산금액</th></tr></thead><tbody>';
  byBrand.forEach((b) => {
    const sales = Number(b.totalAmount) || 0;
    const fee = Math.round(sales * 0.15);
    const settlement = sales - fee;
    html += '<tr><td>' + escapeHtml(b.brandTitle || b.slug || '') + '</td><td>' + (b.orderCount || 0) + '</td><td>' + formatMoney(sales) + '</td><td>' + formatMoney(fee) + '</td><td>' + formatMoney(settlement) + '</td></tr>';
  });
  html += '</tbody></table>';
  return html;
}

let storeSettlementClockIntervalId = null;

async function loadStoreSettlement() {
  const container = document.getElementById('storeOrdersSettlementContent');
  if (!container) return;

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todayMinus7 = new Date(today);
  todayMinus7.setDate(todayMinus7.getDate() - 7);
  const tomorrowMinus7 = new Date(tomorrow);
  tomorrowMinus7.setDate(tomorrowMinus7.getDate() - 7);

  const dateToday = toDateKey(todayMinus7);
  const dateTomorrow = toDateKey(tomorrowMinus7);

  container.innerHTML =
    '<div class="admin-settlement-clock" id="storeSettlementClock">' + escapeHtml(formatSettlementClock()) + '</div>' +
    '<section class="admin-stats-section"><h3>오늘 정산 내역</h3><p class="admin-settlement-caption">배송완료일 ' + escapeHtml(dateToday) + ' 기준</p><div id="storeSettlementToday"></div></section>' +
    '<section class="admin-stats-section"><h3>내일 정산 예정</h3><p class="admin-settlement-caption">배송완료일 ' + escapeHtml(dateTomorrow) + ' 기준</p><div id="storeSettlementTomorrow"></div></section>';

  const clockEl = document.getElementById('storeSettlementClock');
  if (storeSettlementClockIntervalId) clearInterval(storeSettlementClockIntervalId);
  storeSettlementClockIntervalId = setInterval(() => {
    if (clockEl) clockEl.textContent = formatSettlementClock();
  }, 1000);

  const token = getToken();
  const todayBox = document.getElementById('storeSettlementToday');
  const tomorrowBox = document.getElementById('storeSettlementTomorrow');
  if (todayBox) todayBox.innerHTML = '<div class="admin-loading">로딩 중...</div>';
  if (tomorrowBox) tomorrowBox.innerHTML = '<div class="admin-loading">로딩 중...</div>';

  try {
    const [resToday, resTomorrow] = await Promise.all([
      fetch(`${API_BASE}/api/manager/settlement?date=${encodeURIComponent(dateToday)}`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_BASE}/api/manager/settlement?date=${encodeURIComponent(dateTomorrow)}`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const dataToday = resToday.ok ? await resToday.json() : { byBrand: [] };
    const dataTomorrow = resTomorrow.ok ? await resTomorrow.json() : { byBrand: [] };
    if (todayBox) todayBox.innerHTML = renderStoreSettlementTable(dataToday.byBrand || []);
    if (tomorrowBox) tomorrowBox.innerHTML = renderStoreSettlementTable(dataTomorrow.byBrand || []);
  } catch (e) {
    if (todayBox) todayBox.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '오늘 정산을 불러올 수 없습니다.') + '</p>';
    if (tomorrowBox) tomorrowBox.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '내일 정산 예정을 불러올 수 없습니다.') + '</p>';
  }
}

function setupStoreOrdersTabs() {
  const tabs = document.querySelectorAll('.store-orders-tab[data-store-tab]');
  const listView = document.getElementById('storeOrdersListView');
  const statsView = document.getElementById('storeOrdersStatsView');
  const settlementView = document.getElementById('storeOrdersSettlementView');

  function activateTab(targetTab) {
    tabs.forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    listView?.classList.remove('active');
    statsView?.classList.remove('active');
    settlementView?.classList.remove('active');
    const tabEl = document.querySelector(`.store-orders-tab[data-store-tab="${targetTab}"]`);
    if (tabEl) {
      tabEl.classList.add('active');
      tabEl.setAttribute('aria-selected', 'true');
    }
    if (targetTab === 'list') {
      listView?.classList.add('active');
    } else if (targetTab === 'stats') {
      statsView?.classList.add('active');
      loadStoreOrdersStats();
    } else if (targetTab === 'settlement') {
      settlementView?.classList.add('active');
      loadStoreSettlement();
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.storeTab;
      if (targetTab) sessionStorage.setItem(STORE_ORDERS_TAB_KEY, targetTab);
      activateTab(targetTab);
    });
  });

  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const isReload = nav?.type === 'reload' || (typeof performance.navigation !== 'undefined' && performance.navigation.type === 1);
  const saved = sessionStorage.getItem(STORE_ORDERS_TAB_KEY);
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
  const tabToActivate = (saved && ['list', 'stats', 'settlement'].includes(saved) && (saved !== 'settlement' || !isMobile())) ? saved : (isMobile() ? 'list' : 'list');
  if (isReload && saved) {
    activateTab(tabToActivate);
  }
}

setupStoreOrdersTabs();
loadStoreOrders();
