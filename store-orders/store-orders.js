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
let storeOrdersSortDir = { created_at: 'desc' };
let storeOrdersSubFilter = 'delivery_wait';
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

function getOrderNumberDisplay(order) {
  const id = order?.id ?? '';
  if (order?.orderSlipNumbers && order.orderSlipNumbers.length > 0) {
    return order.orderSlipNumbers.map((n) => `#${id}-${n}`).join(', ');
  }
  const items = order?.order_items || order?.orderItems || [];
  const slugs = [...new Set(items.map((i) => ((i.id || '').toString().split('-')[0] || '').toLowerCase()).filter(Boolean))];
  slugs.sort();
  const n = slugs.length || 1;
  if (n <= 1) return `#${id}-1`;
  return slugs.map((_, i) => `#${id}-${i + 1}`).join(', ');
}

function getStatusLabel(status, cancelReason) {
  const s = (status || '').trim();
  const labels = {
    submitted: '주문 대기',
    order_accepted: '주문 대기',
    payment_link_issued: '주문 대기',
    payment_completed: '결제 완료',
    shipping: '발송 완료',
    delivery_completed: '발송 완료',
    cancelled: '주문취소',
  };
  const base = labels[s] || s || '—';
  return s === 'cancelled' && cancelReason ? `${base}(${cancelReason})` : base;
}

function formatAdminOrderDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = formatter.formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

function formatAdminPrice(price) {
  return Number(price || 0).toLocaleString() + '원';
}

function getTodayKST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
function toDateKeyKST(d) {
  if (d == null) return '';
  return new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
function getStatsDateStr(d) {
  return toDateKeyKST(d);
}
function getThisWeekMondayKST(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+09:00');
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(d.getTime() - diff * 86400000);
  return monday.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
function getDefaultStatsRange() {
  const end = getTodayKST();
  const start = getThisWeekMondayKST(end);
  return { start, end };
}
function getPresetStatsRange(preset) {
  const today = getTodayKST();
  if (preset === 'today') return { start: today, end: today };
  if (preset === 'this_week') {
    const start = getThisWeekMondayKST(today);
    return { start, end: today };
  }
  if (preset === 'last_week') {
    const thisMon = getThisWeekMondayKST(today);
    const thisMonD = new Date(thisMon + 'T12:00:00+09:00');
    const lastSun = new Date(thisMonD.getTime() - 86400000);
    const lastMon = new Date(thisMonD.getTime() - 7 * 86400000);
    return { start: toDateKeyKST(lastMon.getTime()), end: toDateKeyKST(lastSun.getTime()) };
  }
  if (preset === 'this_month') {
    const d = new Date(today + 'T12:00:00+09:00');
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    return { start: toDateKeyKST(first.getTime() + 9 * 3600000), end: today };
  }
  if (preset === 'last_month') {
    const [y, m] = today.split('-').map(Number);
    const lastMonthYear = m === 1 ? y - 1 : y;
    const lastMonthNum = m === 1 ? 12 : m - 1;
    const lastDayNum = new Date(lastMonthYear, lastMonthNum, 0).getDate();
    const start = `${lastMonthYear}-${String(lastMonthNum).padStart(2, '0')}-01`;
    const end = `${lastMonthYear}-${String(lastMonthNum).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;
    return { start, end };
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

function sortPaymentOrders(orders, sortBy, dir) {
  const copy = orders.slice();
  const asc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  copy.sort((a, b) => asc(new Date(a.created_at), new Date(b.created_at)));
  if ((dir || 'desc') === 'desc') copy.reverse();
  return copy;
}

const PAYMENT_CANCEL_WINDOW_MS = 45 * 60 * 1000;

function isWithinPaymentCancelWindow(order) {
  if (order.status !== 'payment_completed') return false;
  const at = order.payment_completed_at || order.paymentCompletedAt;
  if (!at) return false;
  const ts = new Date(at).getTime();
  return !Number.isNaN(ts) && Date.now() - ts < PAYMENT_CANCEL_WINDOW_MS;
}

function getPaymentCompletedRemainingMmSs(order) {
  if (order.status !== 'payment_completed') return null;
  const at = order.payment_completed_at || order.paymentCompletedAt;
  if (!at) return null;
  const ts = new Date(at).getTime();
  if (Number.isNaN(ts)) return null;
  const remainingMs = PAYMENT_CANCEL_WINDOW_MS - (Date.now() - ts);
  if (remainingMs <= 0) return null;
  const totalSeconds = Math.min(45 * 60 - 1, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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

function openOrderDetail(order) {
  const content = document.getElementById('storeOrderDetailContent');
  const totalEl = document.getElementById('storeOrderDetailTotal');
  const overlay = document.getElementById('storeOrderDetailOverlay');
  const panel = overlay?.querySelector('.admin-order-detail-panel');
  if (!content || !overlay) return;
  const html = renderOrderDetailHtml(order);
  content.innerHTML = `<div class="order-detail-list order-detail-cart-style">${html}</div>`;
  if (totalEl) totalEl.textContent = formatAdminPrice(order.total_amount || 0);
  if (panel) panel.classList.toggle('admin-order-detail-cancelled', order.status === 'cancelled');

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

let storeDeliveryModalOrderId = null;

function openDeliveryCompleteModal(orderId) {
  storeDeliveryModalOrderId = orderId;
  const modal = document.getElementById('storeDeliveryCompleteModal');
  if (!modal) return;
  const courierSelect = document.getElementById('storeDeliveryCourierSelect');
  const trackingInput = document.getElementById('storeDeliveryTrackingInput');
  if (courierSelect) courierSelect.value = '';
  if (trackingInput) trackingInput.value = '';
  modal.classList.add('admin-modal-visible');
  modal.setAttribute('aria-hidden', 'false');
}

function closeDeliveryCompleteModal() {
  const modal = document.getElementById('storeDeliveryCompleteModal');
  if (modal) {
    modal.classList.remove('admin-modal-visible');
    modal.setAttribute('aria-hidden', 'true');
  }
  storeDeliveryModalOrderId = null;
}

async function submitStoreDeliveryCompleteDirect() {
  const orderId = storeDeliveryModalOrderId;
  if (!orderId) return;
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/api/manager/delivery-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orderId, code: orderId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '처리에 실패했습니다.');
    const order = storeOrdersData.find(o => o.id === orderId);
    if (order) order.status = 'delivery_completed';
    alert('직접 배송 완료 처리되었습니다.');
    closeDeliveryCompleteModal();
    renderList();
  } catch (e) {
    alert(e.message || '처리에 실패했습니다.');
  }
}

async function submitStoreDeliveryCompleteParcel() {
  const orderId = storeDeliveryModalOrderId;
  if (!orderId) return;
  const courierSelect = document.getElementById('storeDeliveryCourierSelect');
  const trackingInput = document.getElementById('storeDeliveryTrackingInput');
  const courierCompany = courierSelect?.value?.trim() || '';
  const trackingNumber = (trackingInput?.value || '').trim();
  if (!trackingNumber) {
    alert('송장 번호를 입력해 주세요.');
    return;
  }
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/api/manager/delivery-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orderId, courierCompany, trackingNumber }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
    const order = storeOrdersData.find(o => o.id === orderId);
    if (order) order.status = 'delivery_completed';
    alert('저장되었습니다.');
    closeDeliveryCompleteModal();
    renderList();
  } catch (e) {
    alert(e.message || '저장에 실패했습니다.');
  }
}

(function bindStoreDeliveryCompleteModal() {
  const modal = document.getElementById('storeDeliveryCompleteModal');
  if (!modal) return;
  document.getElementById('storeDeliveryCompleteModalClose')?.addEventListener('click', closeDeliveryCompleteModal);
  document.getElementById('storeDeliveryCompleteDirectBtn')?.addEventListener('click', submitStoreDeliveryCompleteDirect);
  document.getElementById('storeDeliveryParcelSaveBtn')?.addEventListener('click', submitStoreDeliveryCompleteParcel);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDeliveryCompleteModal();
  });
})();

let storePaymentCountdownIntervalId = null;

function renderList() {
  if (storePaymentCountdownIntervalId) {
    clearInterval(storePaymentCountdownIntervalId);
    storePaymentCountdownIntervalId = null;
  }
  const content = document.getElementById('storeOrdersContent');
  const allOrders = storeOrdersData;
  const cancelled = (o) => o.status === 'cancelled';

  const orderWaitStatuses = ['submitted', 'order_accepted', 'payment_link_issued'];
  const isOrderWait = (o) => !cancelled(o) && (orderWaitStatuses.includes(o.status) || isWithinPaymentCancelWindow(o));
  const isDeliveryWait = (o) => !cancelled(o) && o.status === 'payment_completed' && !isWithinPaymentCancelWindow(o);
  const newCount = allOrders.filter(isOrderWait).length;
  const deliveryWaitCount = allOrders.filter(isDeliveryWait).length;
  const deliveryCompletedCount = allOrders.filter(o => !cancelled(o) && o.status === 'delivery_completed').length;
  const cancelledCount = allOrders.filter(o => o.status === 'cancelled').length;

  const effectiveFilter = storeOrdersSubFilter === 'all' ? 'delivery_wait' : storeOrdersSubFilter;
  let filtered;
  if (effectiveFilter === 'new') {
    filtered = allOrders.filter(o => !cancelled(o) && (orderWaitStatuses.includes(o.status) || isWithinPaymentCancelWindow(o)));
  } else if (effectiveFilter === 'delivery_wait') {
    filtered = allOrders.filter(o => o.status === 'payment_completed' && !isWithinPaymentCancelWindow(o));
  } else if (effectiveFilter === 'delivery_completed') {
    filtered = allOrders.filter(o => o.status === 'delivery_completed');
  } else if (effectiveFilter === 'cancelled') {
    filtered = allOrders.filter(o => o.status === 'cancelled');
  } else {
    filtered = allOrders.filter(o => o.status === 'payment_completed');
  }

  const sortBy = storeOrdersSortBy;
  const dir = storeOrdersSortDir[sortBy] || 'desc';
  const sorted = sortPaymentOrders(filtered, sortBy, dir);

  const arrow = (key) => (storeOrdersSortDir[key] === 'asc' ? ' ↑' : ' ↓');
  const sortBar = `
    <div class="admin-payment-sort">
      <div class="admin-payment-sort-btns">
        <button type="button" class="admin-payment-sort-btn active" data-sort="created_at">주문시간${arrow('created_at')}</button>
      </div>
    </div>
    <div class="admin-payment-subfilter">
      <div class="admin-payment-subfilter-row">
        <span class="admin-payment-subfilter-item ${storeOrdersSubFilter === 'new' ? 'active' : ''}" data-subfilter="new" role="button" tabindex="0">주문대기 ${newCount}개</span>
        <span class="admin-payment-subfilter-item ${storeOrdersSubFilter === 'delivery_wait' ? 'active' : ''}" data-subfilter="delivery_wait" role="button" tabindex="0">주문완료 ${deliveryWaitCount}개</span>
        <span class="admin-payment-subfilter-item ${storeOrdersSubFilter === 'delivery_completed' ? 'active' : ''}" data-subfilter="delivery_completed" role="button" tabindex="0">발송완료 ${deliveryCompletedCount}개</span>
        <span class="admin-payment-subfilter-item ${storeOrdersSubFilter === 'cancelled' ? 'active' : ''}" data-subfilter="cancelled" role="button" tabindex="0">취소주문 ${cancelledCount}개</span>
      </div>
    </div>
  `;

  const ordersHtml = sorted.map(order => {
    const isCancelled = order.status === 'cancelled';

    const orderIdEsc = escapeHtml(String(order.id));
    const orderNumberDisplay = escapeHtml(getOrderNumberDisplay(order)).replace(/, /g, '<br>');
    const orderIdEl = `<span class="admin-payment-order-id admin-payment-order-id-link" data-order-detail="${orderIdEsc}" role="button" tabindex="0">${orderNumberDisplay}</span>`;

    const isCountdownOrder = order.status === 'payment_completed' && isWithinPaymentCancelWindow(order);
    const paymentCompletedAt = order.payment_completed_at || order.paymentCompletedAt;
    const initialRemaining = isCountdownOrder ? getPaymentCompletedRemainingMmSs(order) : null;
    const statusLabel = initialRemaining != null
      ? `결제 완료 ${initialRemaining} 남음`
      : getStatusLabel(order.status, order.cancel_reason);
    const statusLabelEsc = escapeHtml(statusLabel);
    const statusCountdownAttr = isCountdownOrder && paymentCompletedAt
      ? ` data-payment-completed-at="${escapeHtml(String(paymentCompletedAt))}"`
      : '';

    const deliveryAddressEsc = escapeHtml([(order.delivery_address || '').trim(), (order.detail_address || '').trim()].filter(Boolean).join(' ') || '—');
    const hideDeliveryBtn = effectiveFilter === 'new';
    const isDeliveryCompletedFilter = effectiveFilter === 'delivery_completed';
    const showDeliveryInfo = isDeliveryCompletedFilter && order.status === 'delivery_completed';
    const deliveryInfoText = showDeliveryInfo
      ? (() => {
          const cc = (order.courier_company || '').trim();
          const tn = (order.tracking_number || '').trim();
          const hasParcel = !!cc || !!tn;
          if (order.delivery_type === 'direct') return '직접 배송 완료';
          if (hasParcel) return `${cc || '—'} / ${tn}`;
          return '배송 정보 없음';
        })()
      : '';
    const ordererDisplay = effectiveFilter === 'delivery_wait'
      ? `${escapeHtml((order.depositor || '').trim() || '—')} / ${escapeHtml(order.contact || '—')}`
      : escapeHtml((order.depositor || '').trim() || '—');

    return `
      <div class="admin-payment-order ${isCancelled ? 'admin-payment-order-cancelled' : ''}" data-order-id="${orderIdEsc}">
        <div class="admin-payment-order-header">
          ${orderIdEl}
          <span class="admin-payment-order-status ${order.status}"${statusCountdownAttr}>${statusLabelEsc}</span>
        </div>
        <div class="admin-payment-order-info">
          <div>주문시간: ${formatAdminOrderDate(order.created_at)}</div>
          <div>배송주소: ${deliveryAddressEsc}</div>
          <div>주문자: ${ordererDisplay}</div>
          <div>이메일: ${escapeHtml(order.user_email || '—')}</div>
        </div>
        <div class="admin-payment-link-row">
          ${effectiveFilter === 'cancelled'
            ? ''
            : hideDeliveryBtn
            ? '<span class="admin-payment-order-id admin-payment-order-notice">주문 완료 전입니다. 아직 발송하지 마세요.</span>'
            : showDeliveryInfo
            ? `<span class="admin-payment-delivery-info">${escapeHtml(deliveryInfoText)}</span>`
            : `<button type="button" class="admin-btn admin-btn-primary admin-payment-link-btn" data-open-delivery-modal="${orderIdEsc}" ${(order.status !== 'payment_completed' && order.status !== 'shipping') ? 'disabled' : ''}>발송 완료</button>${effectiveFilter === 'delivery_wait' ? '<span class="admin-payment-delivery-complete-hint">발송 후 발송 완료 처리해주세요.</span>' : ''}`}
        </div>
      </div>
    `;
  }).join('');

  const showLoadMore = storeOrdersData.length < storeOrdersTotal;
  const loadMoreHtml = showLoadMore
    ? `<div class="admin-payment-load-more-wrap"><button type="button" class="admin-btn admin-payment-load-more-btn" data-store-orders-load-more>더 보기</button></div>`
    : '';
  content.innerHTML = sortBar + ordersHtml + loadMoreHtml;

  storeOrdersFlashIntervals.forEach(id => clearInterval(id));
  storeOrdersFlashIntervals = [];

  function tickPaymentCountdown() {
    content.querySelectorAll('[data-payment-completed-at]').forEach(el => {
      const at = el.getAttribute('data-payment-completed-at');
      if (!at) return;
      const ts = new Date(at).getTime();
      if (Number.isNaN(ts)) return;
      const remainingMs = PAYMENT_CANCEL_WINDOW_MS - (Date.now() - ts);
      if (remainingMs <= 0) {
        el.textContent = '결제 완료';
        el.removeAttribute('data-payment-completed-at');
        return;
      }
      const totalSeconds = Math.floor(remainingMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      el.textContent = `결제 완료 ${mmss} 남음`;
    });
  }
  tickPaymentCountdown();
  storePaymentCountdownIntervalId = setInterval(tickPaymentCountdown, 1000);

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

  content.querySelectorAll('[data-open-delivery-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.openDeliveryModal;
      openDeliveryCompleteModal(orderId);
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
    const paymentCompleted = (v && v.paymentCompletedCount) ?? 0;
    const deliveryCompleted = (v && v.deliveryCompletedCount) ?? 0;
    html += '<li>' + escapeHtml((v && v.title) || e[0]) + ' : 주문완료 <strong>' + paymentCompleted + '</strong>건, 발송완료 <strong>' + deliveryCompleted + '</strong>건</li>';
  });
  html += '</ul></div>';
  const revTotal = Number(revenue.total) || 0;
  const totalRevText = formatMoney(revTotal);
  html += '<div class="admin-stats-section"><h3>매출</h3><p class="admin-stats-big">총 매출 <strong>' + totalRevText + '</strong></p><br><h4 class="admin-stats-brand-heading">브랜드별 매출</h4><ul class="admin-stats-list">';
  const revByStore = revenue.byStore || {};
  Object.entries(revByStore).forEach(function (e) {
    const v = e[1];
    const amt = Number(v && v.amount) || 0;
    html += '<li>' + escapeHtml((v && v.title) || e[0]) + ' : ' + formatMoney(amt) + '</li>';
  });
  html += '</ul></div>';
  html += '<div class="admin-stats-section"><h3 class="admin-stats-section-title-with-hint">일 매출</h3><table class="admin-stats-table admin-stats-table-cols3"><thead><tr><th>날짜</th><th>진행주문</th><th>매출</th></tr></thead><tbody>';
  timeSeries.slice(-14).reverse().forEach(function (d) {
    html += '<tr><td>' + escapeHtml(d.date) + '</td><td>' + d.orders + '</td><td>' + formatMoney(d.revenue) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  const menuFilterLimit = storeOrdersStatsMenuFilter === 'top10' ? 10 : (topMenus.length || 20);
  const menuList = topMenus.slice(0, menuFilterLimit);
  const menuFilterLabel = storeOrdersStatsMenuFilter === 'top10' ? 'top10' : 'all';
  html += '<div class="admin-stats-section"><div class="admin-stats-section-title-row"><h3 class="admin-stats-section-title">메뉴 매출</h3><span class="admin-stats-menu-filter"><button type="button" class="admin-stats-menu-filter-btn active" data-menu-filter-toggle>' + menuFilterLabel + '</button></span></div><table class="admin-stats-table admin-stats-table-cols3 admin-stats-table-menu"><thead><tr><th>메뉴</th><th>진행주문</th><th>매출</th></tr></thead><tbody>';
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
  html += '<li>결제완료 <strong>' + n2 + '</strong> → 발송완료 <strong>' + n5 + '</strong> (' + pct(n5, n2) + '%)</li>';
  html += '</ul></div>';
  html += '<div class="admin-stats-section admin-stats-section-crm"><h3>고객 분석</h3><table class="admin-stats-table"><thead><tr><th>이메일</th><th>진행주문</th><th>매출</th><th>마지막 주문일</th><th>고객 클러스터</th></tr></thead><tbody>';
  (crm.byCustomer || []).forEach(function (c) {
    const lastDate = c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—';
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

/** YYYY-MM-DD (KST) */
function toDateKey(d) {
  return toDateKeyKST(d);
}

/** yy/mm/dd hh:mm:ss KST (실시간 시계용) */
function formatSettlementClock() {
  const x = new Date();
  const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const parts = formatter.formatToParts(x);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function renderStoreSettlementTable(byBrand) {
  if (!byBrand || byBrand.length === 0) {
    return '<p class="admin-settlement-empty">해당 날짜에 발송 완료된 주문이 없습니다.</p>';
  }
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  let html = '<table class="admin-stats-table"><thead><tr><th>브랜드</th><th>주문 수</th><th>판매금액</th><th>수수료</th><th>정산금액</th></tr></thead><tbody>';
  byBrand.forEach((b) => {
    const sales = Number(b.totalAmount) || 0;
    const fee = Math.round(sales * 0.04);
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

  const today = getTodayKST();
  const todayD = new Date(today + 'T12:00:00+09:00');
  const tomorrowD = new Date(todayD.getTime() + 86400000);
  const todayMinus7D = new Date(todayD.getTime() - 7 * 86400000);

  const dateToday = toDateKeyKST(todayMinus7D.getTime());
  const dateTomorrow = toDateKeyKST(tomorrowD.getTime());

  container.innerHTML =
    '<div class="admin-settlement-clock" id="storeSettlementClock">' + escapeHtml(formatSettlementClock()) + '</div>' +
    '<section class="admin-stats-section"><h3>오늘 정산 내역</h3><p class="admin-settlement-caption">발송완료일 ' + escapeHtml(dateToday) + ' 기준</p><div id="storeSettlementToday"></div></section>' +
    '<section class="admin-stats-section"><h3>내일 정산 예정</h3><p class="admin-settlement-caption">발송완료일 ' + escapeHtml(dateTomorrow) + ' 기준</p><div id="storeSettlementTomorrow"></div></section>';

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

  function activateTab(targetTab) {
    tabs.forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    listView?.classList.remove('active');
    statsView?.classList.remove('active');
    const tabEl = document.querySelector(`.store-orders-tab[data-store-tab="${targetTab}"]`);
    if (tabEl) {
      tabEl.classList.add('active');
      tabEl.setAttribute('aria-selected', 'true');
    }
    if (targetTab === 'list') {
      listView?.classList.add('active');
      storeOrdersSubFilter = 'delivery_wait';
      renderList();
    } else if (targetTab === 'stats') {
      statsView?.classList.add('active');
      loadStoreOrdersStats();
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
  const tabToActivate = (saved && ['list', 'stats'].includes(saved)) ? saved : 'list';
  if (isReload && saved) {
    activateTab(tabToActivate);
  }
}

setupStoreOrdersTabs();
loadStoreOrders();
