/**
 * 주문 접수 목록 - 매장 담당자 전용 (담당자 이메일로 등록된 매장의 주문만 표시)
 */

const TOKEN_KEY = 'bzcat_token_session';
const LEGACY_TOKEN_KEY = 'bzcat_token';
const API_BASE = '';

let storeOrdersData = [];
let storeOrdersTotal = 0;
let storeOrdersStores = [];
let storeOrdersStoreOrder = [];
let storeOrdersSortBy = 'created_at';
let storeOrdersSortDir = { created_at: 'desc' };
let storeOrdersSubFilter = 'delivery_wait';
/** 주문관리 기간: 'this_month' | '1_month' | '3_months' */
let storeOrdersPeriod = 'this_month';
let storeOrdersFlashIntervals = [];

const STORE_ORDERS_IDLE_MS = 180000; // 180초 무활동 시 주문 목록 리프레시
const STORE_ORDERS_FULL_LOAD_LIMIT = 2000;
let storeOrdersIdleTimerId = null;
let storeOrdersIdleListenersAttached = false;

function getStoreOrdersLoadingHtml() {
  return '<div class="admin-loading" role="status" aria-label="로딩 중" data-loading-start="' + Date.now() + '"><div class="admin-loading-progress"><div class="admin-loading-progress-bar"></div></div><span class="admin-loading-progress-pct">0%</span></div>';
}

function getStoreOrdersPeriodBarOnlyHtml() {
  const periodStartDate = getStoreOrdersStartDateForPeriod(storeOrdersPeriod);
  return (
    '<div class="admin-payment-sort">' +
    '<div class="admin-payment-period-btns">' +
    '<button type="button" class="admin-payment-sort-btn admin-payment-period-btn ' + (storeOrdersPeriod === 'this_month' ? 'active' : '') + '" data-period="this_month">이번달</button><span class="admin-payment-period-gap">&nbsp;</span>' +
    '<button type="button" class="admin-payment-sort-btn admin-payment-period-btn ' + (storeOrdersPeriod === '1_month' ? 'active' : '') + '" data-period="1_month">1개월전부터</button><span class="admin-payment-period-gap">&nbsp;</span>' +
    '<button type="button" class="admin-payment-sort-btn admin-payment-period-btn ' + (storeOrdersPeriod === '3_months' ? 'active' : '') + '" data-period="3_months">3개월전부터</button>' +
    '</div>' +
    '<div class="admin-payment-period-range">>> ' + escapeHtml(periodStartDate) + ' ~ 현재</div>' +
    '</div>'
  );
}

function attachStoreOrdersPeriodListeners(container) {
  if (!container) return;
  container.querySelectorAll('[data-period]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const period = btn.dataset.period;
      if (period && storeOrdersPeriod !== period) {
        storeOrdersPeriod = period;
        loadStoreOrders();
      }
    });
  });
}

function getToken() {
  let current = localStorage.getItem(TOKEN_KEY);
  if (!current) {
    current = sessionStorage.getItem(TOKEN_KEY);
    if (current) {
      localStorage.setItem(TOKEN_KEY, current);
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }
  if (current) return current;
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!legacy) return null;
  localStorage.setItem(TOKEN_KEY, legacy);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  return legacy;
}

function findStoreOrderById(orderId) {
  if (orderId == null || orderId === '') return null;
  const want = String(orderId);
  return storeOrdersData.find((o) => String(o.id) === want) || null;
}

function escapeHtml(s) {
  if (s == null || s === '') return '';
  const t = String(s);
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatOneSlipLineClient(slip, orderId) {
  const id = String(orderId || '');
  const num = slip.slipIndex != null ? slip.slipIndex : 1;
  const st = slip.delivery_status || slip.deliveryStatus;
  if (st !== 'delivery_completed') return `#${id}-${num}: 미입력`;
  const dt = slip.delivery_type || slip.deliveryType;
  if (dt === 'direct') return `#${id}-${num}: 직접 배송 완료`;
  const cc = (slip.courier_company || slip.courierCompany || '').trim();
  const tn = (slip.tracking_number || slip.trackingNumber || '').trim();
  if (cc || tn) return `#${id}-${num}: ${cc || '—'} / ${tn}`;
  return `#${id}-${num}: 미입력`;
}

function formatOrderSlipLinesHtml(order) {
  const id = String(order.id || '');
  const slips = order.order_slips || order.orderSlips;
  if (Array.isArray(slips) && slips.length > 0) {
    return slips.map((s) =>
      '<div class="admin-payment-delivery-slip-line"><span class="admin-payment-delivery-info">*배송정보 : ' +
      escapeHtml(formatOneSlipLineClient(s, id)) +
      '</span></div>'
    ).join('');
  }
  if (order.status === 'delivery_completed') {
    const cc = (order.courier_company || '').trim();
    const tn = (order.tracking_number || '').trim();
    const hasParcel = !!cc || !!tn;
    let text;
    if (order.delivery_type === 'direct') text = '직접 배송 완료';
    else if (hasParcel) text = `${cc || '—'} / ${tn}`;
    else text = '배송 정보 없음';
    return '<div class="admin-payment-delivery-slip-line"><span class="admin-payment-delivery-info">*배송정보 : ' + escapeHtml(text) + '</span></div>';
  }
  return '';
}

function getOrderItemStoreKey(itemId) {
  const raw = (itemId || '').toString().trim();
  if (!raw) return 'unknown';
  const parts = raw.split('-');
  if (parts.length >= 3) {
    const prefix = parts.slice(0, -2).join('-');
    if (prefix) return prefix.toLowerCase();
  }
  return (parts[0] || 'unknown').toLowerCase();
}

function formatStoreSectionLabel(title, brand, slugFallback) {
  const t = (title != null ? String(title) : '').trim();
  const b = (brand != null ? String(brand) : '').trim();
  const fb = (slugFallback != null ? String(slugFallback) : '').trim();
  if (t && b) {
    if (t === b) return t;
    return `${t}(${b})`;
  }
  if (t) return t;
  if (b) return b;
  return fb;
}

function getOrderNumberDisplay(order) {
  const id = order?.id ?? '';
  if (order?.orderSlipNumbers && order.orderSlipNumbers.length > 0) {
    return order.orderSlipNumbers.map((n) => `#${id}-${n}`).join(', ');
  }
  const items = order?.order_items || order?.orderItems || [];
  const slugs = [...new Set(items.map((i) => getOrderItemStoreKey(i.id)).filter((s) => s && s !== 'unknown'))];
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

function getStoreOrdersStartDateForPeriod(period) {
  const today = getTodayKST();
  const [y, m] = today.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  if (period === 'this_month') return `${y}-${pad(m)}-01`;
  if (period === '1_month') {
    if (m <= 1) return `${y - 1}-12-01`;
    return `${y}-${pad(m - 1)}-01`;
  }
  if (period === '3_months') {
    let mm = m - 3;
    let yy = y;
    while (mm <= 0) { mm += 12; yy -= 1; }
    return `${yy}-${pad(mm)}-01`;
  }
  return `${y}-${pad(m)}-01`;
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
    const label = formatStoreSectionLabel(s.title, s.brand, (s.slug || s.id || '').toString());
    if (s.id) slugToTitle[String(s.id).toLowerCase()] = label;
    if (s.slug) slugToTitle[String(s.slug).toLowerCase()] = label;
  }
  const orderItems = order.order_items || [];
  const byCategory = {};
  for (const oi of orderItems) {
    const itemId = oi.id || '';
    const slug = getOrderItemStoreKey(itemId);
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
  const renderItem = ({ item, qty }) => `
    <div class="admin-order-detail-item">
      <div class="cart-item-info" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div class="cart-item-name">${escapeHtml(item.name || '')}</div>
        <div class="cart-item-price">x ${escapeHtml(String(Number(qty) || 0))}</div>
      </div>
    </div>
  `;
  return categoryOrder
    .filter(slug => byCategory[slug]?.length)
    .map(slug => {
      const title = slugToTitle[slug] || slug;
      const itemsHtml = byCategory[slug].map(renderItem).join('');
      return `
        <div class="cart-category-group">
          <div class="cart-category-header">
            <span class="cart-category-title">${escapeHtml(title || '')}</span>
          </div>
          ${itemsHtml}
        </div>
      `;
    })
    .join('');
}

function openOrderDetail(order) {
  const content = document.getElementById('storeOrderDetailContent');
  const overlay = document.getElementById('storeOrderDetailOverlay');
  const panel = overlay?.querySelector('.admin-order-detail-panel');
  if (!content || !overlay) return;
  const html = renderOrderDetailHtml(order);
  content.innerHTML = `<div class="order-detail-list order-detail-cart-style">${html}</div>`;
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
    alert('직접 배송 완료 처리되었습니다.');
    closeDeliveryCompleteModal();
    await loadStoreOrders();
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
    alert('저장되었습니다.');
    closeDeliveryCompleteModal();
    await loadStoreOrders();
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
  const isDeliveryWait = (o) => !cancelled(o) && ((o.status === 'payment_completed' && !isWithinPaymentCancelWindow(o)) || o.status === 'shipping');
  const newCount = allOrders.filter(isOrderWait).length;
  const deliveryWaitCount = allOrders.filter(isDeliveryWait).length;
  const deliveryCompletedCount = allOrders.filter(o => !cancelled(o) && o.status === 'delivery_completed').length;
  const cancelledCount = allOrders.filter(o => o.status === 'cancelled').length;

  const effectiveFilter = storeOrdersSubFilter === 'all' ? 'delivery_wait' : storeOrdersSubFilter;
  let filtered;
  if (effectiveFilter === 'new') {
    filtered = allOrders.filter(o => !cancelled(o) && (orderWaitStatuses.includes(o.status) || isWithinPaymentCancelWindow(o)));
  } else if (effectiveFilter === 'delivery_wait') {
    filtered = allOrders.filter(o => (o.status === 'payment_completed' && !isWithinPaymentCancelWindow(o)) || o.status === 'shipping');
  } else if (effectiveFilter === 'delivery_completed') {
    filtered = allOrders.filter(o => o.status === 'delivery_completed');
  } else if (effectiveFilter === 'cancelled') {
    filtered = allOrders.filter(o => o.status === 'cancelled');
  } else {
    filtered = allOrders.filter(o => o.status === 'payment_completed' || o.status === 'shipping');
  }

  const sortBy = storeOrdersSortBy;
  const dir = storeOrdersSortDir[sortBy] || 'desc';
  const sorted = sortPaymentOrders(filtered, sortBy, dir);

  const periodStartDate = getStoreOrdersStartDateForPeriod(storeOrdersPeriod);
  const periodBar = `
    <div class="admin-payment-sort">
      <div class="admin-payment-period-btns">
        <button type="button" class="admin-payment-sort-btn admin-payment-period-btn ${storeOrdersPeriod === 'this_month' ? 'active' : ''}" data-period="this_month">이번달</button><span class="admin-payment-period-gap">&nbsp;</span><button type="button" class="admin-payment-sort-btn admin-payment-period-btn ${storeOrdersPeriod === '1_month' ? 'active' : ''}" data-period="1_month">1개월전부터</button><span class="admin-payment-period-gap">&nbsp;</span><button type="button" class="admin-payment-sort-btn admin-payment-period-btn ${storeOrdersPeriod === '3_months' ? 'active' : ''}" data-period="3_months">3개월전부터</button>
      </div>
      <div class="admin-payment-period-range">>> ${escapeHtml(periodStartDate)} ~ 현재</div>
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
    const showSlipLinesInWait = effectiveFilter === 'delivery_wait' && (order.status === 'payment_completed' || order.status === 'shipping');
    const showSlipLinesInDoneTab = isDeliveryCompletedFilter && order.status === 'delivery_completed';
    const slipLinesBlock = (showSlipLinesInWait || showSlipLinesInDoneTab) ? `<div class="admin-payment-slip-lines">${formatOrderSlipLinesHtml(order)}</div>` : '';
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
        ${slipLinesBlock}
        <div class="admin-payment-link-row">
          ${effectiveFilter === 'cancelled'
            ? ''
            : hideDeliveryBtn
            ? '<span class="admin-payment-order-id admin-payment-order-notice">주문 완료 전입니다. 아직 발송하지 마세요.</span>'
            : showSlipLinesInDoneTab
            ? ''
            : effectiveFilter === 'delivery_wait'
            ? `<button type="button" class="admin-btn admin-btn-primary admin-payment-link-btn" data-open-delivery-modal="${orderIdEsc}" ${(order.status !== 'payment_completed' && order.status !== 'shipping') ? 'disabled' : ''}>발송 완료</button>${effectiveFilter === 'delivery_wait' ? '<span class="admin-payment-delivery-complete-hint">발송 후 발송 완료 처리해주세요.</span>' : ''}`
            : `<button type="button" class="admin-btn admin-btn-primary admin-payment-link-btn" data-open-delivery-modal="${orderIdEsc}" ${(order.status !== 'payment_completed' && order.status !== 'shipping') ? 'disabled' : ''}>발송 완료</button>`}
        </div>
      </div>
    `;
  }).join('');

  const emptyMessage = sorted.length === 0 ? '<div class="admin-loading">주문 내역이 없습니다.</div>' : '';
  content.innerHTML = periodBar + ordersHtml + emptyMessage;

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

  content.querySelectorAll('[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period;
      if (period && storeOrdersPeriod !== period) {
        storeOrdersPeriod = period;
        loadStoreOrders();
      }
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

  content.querySelectorAll('[data-order-detail]').forEach(el => {
    el.addEventListener('click', () => {
      const order = findStoreOrderById(el.dataset.orderDetail);
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
    window.location.replace('/');
    return;
  }

  content.innerHTML = getStoreOrdersPeriodBarOnlyHtml() + '<div class="store-orders-loading-wrap">' + getStoreOrdersLoadingHtml() + '</div>';
  attachStoreOrdersPeriodListeners(content);

  try {
    const sessionRes = await fetch(`${API_BASE}/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!sessionRes.ok) {
      window.location.replace('/');
      return;
    }
    const sessionData = await sessionRes.json();
    const user = sessionData.user;
    if (!user || !user.isStoreManager) {
      window.location.replace('/');
      return;
    }

    const startDate = getStoreOrdersStartDateForPeriod(storeOrdersPeriod);
    const res = await fetch(`${API_BASE}/api/manager/orders?limit=${STORE_ORDERS_FULL_LOAD_LIMIT}&offset=0&startDate=${encodeURIComponent(startDate)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        window.location.replace('/');
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

    renderList();
    startStoreOrdersIdleRefresh();
  } catch (e) {
    content.innerHTML = '<div class="admin-loading admin-error">오류가 발생했습니다. 네트워크를 확인해 주세요.</div>';
  }
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

function setupStoreOrdersTabs() {
  document.querySelectorAll('.store-orders-tab[data-store-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      storeOrdersSubFilter = 'delivery_wait';
      renderList();
    });
  });
}

(function tickStoreOrdersLoadingProgress() {
  document.querySelectorAll('.admin-loading').forEach(function (el) {
    let start = el.getAttribute('data-loading-start');
    if (!start) {
      start = String(Date.now());
      el.setAttribute('data-loading-start', start);
    }
    const startNum = parseInt(start, 10);
    const p = Math.min(90, ((Date.now() - startNum) / 2000) * 90);
    const bar = el.querySelector('.admin-loading-progress-bar');
    const pct = el.querySelector('.admin-loading-progress-pct');
    if (bar) bar.style.width = p + '%';
    if (pct) pct.textContent = Math.round(p) + '%';
  });
  setTimeout(tickStoreOrdersLoadingProgress, 150);
})();

setupStoreOrdersTabs();
loadStoreOrders();
