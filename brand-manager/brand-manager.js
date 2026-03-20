/**
 * 브랜드관리 페이지 - 주문관리(1탭) + 정산관리(2탭). 어드민 주문관리와 동일 UI, 권한 있는 데이터만 조회.
 * 모바일에서는 이 페이지 접근 시 주문 페이지(/)로 자동 이동.
 */

const TOKEN_KEY = 'bzcat_token';
const API_BASE = '';
const FETCH_TIMEOUT_MS = 15000;
const BRAND_ORDERS_FULL_LOAD_LIMIT = 2000;

let brandManagerOrders = [];
let brandManagerOrdersTotal = 0;
let brandManagerStoresMap = {};
let brandManagerStoreOrder = [];
let brandManagerSubFilter = 'delivery_wait';
/** 주문관리 기간: 'this_month' | '1_month' | '3_months' */
let brandManagerPeriod = 'this_month';

function getBrandManagerLoadingHtml() {
  return '<div class="admin-loading" role="status" aria-label="로딩 중" data-loading-start="' + Date.now() + '"><div class="admin-loading-progress"><div class="admin-loading-progress-bar"></div></div><span class="admin-loading-progress-pct">0%</span></div>';
}

function getBrandManagerPeriodBarOnlyHtml() {
  const periodStartDate = getBrandManagerStartDateForPeriod(brandManagerPeriod);
  return (
    '<div class="admin-payment-sort">' +
    '<div class="admin-payment-period-btns">' +
    '<button type="button" class="admin-payment-sort-btn admin-payment-period-btn ' + (brandManagerPeriod === 'this_month' ? 'active' : '') + '" data-period="this_month">이번달</button><span class="admin-payment-period-gap">&nbsp;</span>' +
    '<button type="button" class="admin-payment-sort-btn admin-payment-period-btn ' + (brandManagerPeriod === '1_month' ? 'active' : '') + '" data-period="1_month">1개월전부터</button><span class="admin-payment-period-gap">&nbsp;</span>' +
    '<button type="button" class="admin-payment-sort-btn admin-payment-period-btn ' + (brandManagerPeriod === '3_months' ? 'active' : '') + '" data-period="3_months">3개월전부터</button>' +
    '</div>' +
    '<div class="admin-payment-period-range">>> ' + escapeHtml(periodStartDate) + ' ~ 현재</div>' +
    '</div>'
  );
}

function attachBrandManagerPeriodListeners(container) {
  if (!container) return;
  container.querySelectorAll('[data-period]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const period = btn.dataset.period;
      if (period && brandManagerPeriod !== period) {
        brandManagerPeriod = period;
        loadOrdersView();
      }
    });
  });
}

function isMobileView() {
  return window.matchMedia ? window.matchMedia('(max-width: 768px)').matches : window.innerWidth <= 768;
}

if (isMobileView()) {
  window.location.replace('/');
} else {

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function escapeHtml(s) {
  if (s == null || s === '') return '';
  const t = String(s);
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getTodayKST() {
  const d = new Date();
  const kst = new Date(d.getTime() + (d.getTimezoneOffset() * 60000) + (9 * 3600000));
  return kst.toISOString().slice(0, 10);
}

function getBrandManagerStartDateForPeriod(period) {
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

function getOrderNumberDisplay(order) {
  const id = order?.id ?? '';
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

function toDateKeyKST(ms) {
  const d = new Date(ms);
  const kst = new Date(d.getTime() + (d.getTimezoneOffset() * 60000) + (9 * 3600000));
  return kst.toISOString().slice(0, 10);
}

function getSettlementDateOptions() {
  const today = getTodayKST();
  const [tY, tM] = today.split('-').map(Number);
  const list = [];
  for (let y = 2026; y <= tY; y++) {
    const mEnd = y === tY ? tM : 12;
    for (let m = 1; m <= mEnd; m++) {
      const lastDay = new Date(y, m, 0).getDate();
      const pad = (n) => String(n).padStart(2, '0');
      const d10 = `${y}-${pad(m)}-10`;
      const d20 = `${y}-${pad(m)}-20`;
      const dLast = `${y}-${pad(m)}-${pad(lastDay)}`;
      if (d10 <= today) list.push(d10);
      if (d20 <= today && d20 !== d10) list.push(d20);
      if (dLast <= today && dLast !== d10 && dLast !== d20) list.push(dLast);
    }
  }
  list.sort((a, b) => b.localeCompare(a));
  return list;
}

function getSettlementPeriodFromBaseDate(baseDateStr) {
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = new Date(y, m, 0).getDate();
  if (d === 10) {
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    const prevLast = new Date(prev.y, prev.m, 0).getDate();
    return { startDate: `${prev.y}-${pad(prev.m)}-21`, endDate: `${prev.y}-${pad(prev.m)}-${pad(prevLast)}` };
  }
  if (d === 20) return { startDate: `${y}-${pad(m)}-01`, endDate: `${y}-${pad(m)}-10` };
  return { startDate: `${y}-${pad(m)}-11`, endDate: `${y}-${pad(m)}-20` };
}

function renderSettlementTable(byBrand) {
  const heading = '<br><h4 class="admin-settlement-list-heading">발송 완료 목록</h4>';
  if (!byBrand || byBrand.length === 0) {
    return heading + '<p class="admin-settlement-empty">해당 기간에 발송 완료된 주문이 없습니다.</p>';
  }
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  let totalSales = 0;
  let totalFee = 0;
  let totalSettlement = 0;
  let html = heading + '<table class="admin-stats-table admin-settlement-table-cols5"><thead><tr><th>브랜드</th><th>주문 수</th><th>판매금액</th><th>수수료</th><th>정산금액</th></tr></thead><tbody>';
  byBrand.forEach((b) => {
    const sales = Number(b.totalAmount) || 0;
    const fee = Math.round(sales * 0.048);
    const settlement = sales - fee;
    totalSales += sales;
    totalFee += fee;
    totalSettlement += settlement;
    html += '<tr><td>' + escapeHtml(b.brandTitle || b.slug || '') + '</td><td>' + (b.orderCount || 0) + '</td><td>' + formatMoney(sales) + '</td><td>' + formatMoney(fee) + '</td><td>' + formatMoney(settlement) + '</td></tr>';
  });
  html += '<tr class="admin-settlement-total-row"><td></td><td></td><td>' + formatMoney(totalSales) + '</td><td>' + formatMoney(totalFee) + '</td><td>' + formatMoney(totalSettlement) + '</td></tr>';
  html += '</tbody></table>';
  return html;
}

function renderSettlementPendingList(pendingShipment) {
  const heading = '<h4 class="admin-settlement-pending-heading">주문 완료 (발송 완료 미처리) 목록</h4>';
  if (!pendingShipment || pendingShipment.length === 0) {
    return heading + '<p class="admin-settlement-empty">정산 구간 내 발송 완료 미처리 주문이 없습니다.</p>';
  }
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  const statusLabel = (s) => (s === 'shipping' ? '배송중' : '결제완료');
  let totalAmount = 0;
  let html = heading;
  html += '<table class="admin-stats-table admin-settlement-table-cols5"><thead><tr><th>주문일</th><th>브랜드</th><th>주문번호</th><th>금액</th><th>상태</th></tr></thead><tbody>';
  pendingShipment.forEach((o) => {
    const amt = Number(o.total_amount) || 0;
    totalAmount += amt;
    html += '<tr><td>' + escapeHtml(o.orderDate || '') + '</td><td>' + escapeHtml(o.brandTitle || o.slug || '') + '</td><td>' + escapeHtml(String(o.id || '')) + '</td><td>' + formatMoney(amt) + '</td><td>' + escapeHtml(statusLabel(o.status)) + '</td></tr>';
  });
  html += '<tr class="admin-settlement-total-row"><td></td><td></td><td></td><td>' + formatMoney(totalAmount) + '</td><td></td></tr>';
  html += '</tbody></table>';
  return html;
}

function renderSettlementStatementContent(data) {
  if (!data || !data.days) return '';
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  const brandName = escapeHtml(data.brandTitle || data.slug || '');
  const periodText = (data.startDate || '') + ' ~ ' + (data.endDate || '');
  const contactEmail = escapeHtml(data.storeContactEmail || '');
  const repName = escapeHtml(data.representative || '');
  const issueDate = getTodayKST();
  let html = '<div class="admin-settlement-statement-print">';
  html += '<div class="admin-settlement-statement-print-inner">';
  html += '<div class="admin-settlement-statement-header">';
  html += '<p class="admin-settlement-statement-logo">Zero Mart</p>';
  html += '<p class="admin-settlement-statement-title">정산서</p>';
  html += '<p class="admin-settlement-statement-period">' + escapeHtml(periodText) + '</p>';
  html += '<hr class="admin-settlement-statement-hr">';
  html += '</div>';
  html += '<div class="admin-settlement-statement-brand">';
  html += '<br><p><strong>정산 브랜드 정보</strong></p><br>';
  html += '<p class="admin-settlement-statement-bullet">• 매장명: ' + brandName + '</p>';
  html += '<p class="admin-settlement-statement-bullet">• 담당자이메일: ' + contactEmail + '</p>';
  html += '<p class="admin-settlement-statement-bullet">• 대표자이름: ' + repName + '</p>';
  html += '</div>';
  html += '<div class="admin-settlement-statement-body">';
  html += '<br><p><strong>정산 내역</strong></p><br>';
  html += '<table class="admin-stats-table admin-settlement-statement-table"><thead><tr><th>일자</th><th>주문 수</th><th>판매금액</th><th>수수료</th><th>정산금액</th></tr></thead><tbody>';
  (data.days || []).forEach((row) => {
    html += '<tr><td>' + escapeHtml(row.date) + '</td><td>' + (row.orderCount || 0) + '</td><td>' + formatMoney(row.totalAmount) + '</td><td>' + formatMoney(row.fee) + '</td><td>' + formatMoney(row.settlement) + '</td></tr>';
  });
  html += '<tr class="admin-settlement-statement-total"><td>합계</td><td>' + (data.totalOrderCount || 0) + '</td><td>' + formatMoney(data.totalSales) + '</td><td>' + formatMoney(data.totalFee) + '</td><td>' + formatMoney(data.totalSettlement) + '</td></tr>';
  html += '</tbody></table>';
  html += '<br><hr class="admin-settlement-statement-hr admin-settlement-statement-hr--footer"><br>';
  html += '<div class="admin-settlement-statement-footer">';
  html += '<p>* 수수료는 상품 판매가액(부가세 포함)의 4.8%이며, 정산금액 = 판매금액 − 수수료입니다.</p>';
  html += '<p>* 정산서 확인 후, 본사의 지정된 이메일 주소로 전자세금계산서 발행 부탁드립니다.</p>';
  html += '<p>* 정산금액은 귀사의 지정된 입금 계좌로 현금 지급됩니다.</p><br><br><br>';
  html += '<div class="admin-settlement-statement-issuer">';
  html += '<p>정산서 발행일: ' + escapeHtml(issueDate) + '</p>';
  html += '<p>정산서 발행처: (주)플라토스호스피탈리티그룹</p>';
  html += '</div></div></div></div>';
  return html;
}

function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

function buildSlugToSuburl(stores) {
  const map = {};
  (stores || []).forEach((s) => {
    const slug = (s.slug || s.id || '').toString().toLowerCase();
    if (slug) map[slug] = getStoreGroup(s) || '';
  });
  return map;
}

function filterSettlementByGroup(data, selectedGroup, slugToSuburl) {
  if (!selectedGroup) return data;
  const byBrand = (data.byBrand || []).filter((b) => slugToSuburl[b.slug] === selectedGroup);
  const pendingShipment = (data.pendingShipment || []).filter((p) => slugToSuburl[p.slug] === selectedGroup);
  return { ...data, byBrand, pendingShipment };
}

function normalizeGroup(g) {
  return (g == null ? '' : String(g)).trim().replace(/\s+/g, ' ') || '';
}

function getStoreGroup(store) {
  if (!store || typeof store !== 'object') return '';
  const raw = store.suburl ?? store.group ?? '';
  return normalizeGroup(raw);
}

function populateBrandSelect(stores, selectedGroup) {
  const selectEl = document.getElementById('brandManagerBrandSelect');
  if (!selectEl) return;
  while (selectEl.options.length) selectEl.remove(0);
  selectEl.appendChild(new Option('매장 선택', ''));
  const groupNorm = normalizeGroup(selectedGroup);
  let list = (stores || []).slice();
  if (groupNorm) {
    list = list.filter((s) => getStoreGroup(s) === groupNorm);
  }
  list.sort((a, b) => {
    const ga = getStoreGroup(a) || (a.id || '').toString().trim() || '';
    const gb = getStoreGroup(b) || (b.id || '').toString().trim() || '';
    const c = ga.localeCompare(gb, 'ko');
    if (c !== 0) return c;
    const ba = (a.brand || a.title || a.id || '').toString().trim() || '';
    const bb = (b.brand || b.title || b.id || '').toString().trim() || '';
    return ba.localeCompare(bb, 'ko');
  });
  list.forEach((s) => {
    const sid = (s.slug || s.id || '').toString().toLowerCase();
    const groupName = getStoreGroup(s) || sid;
    const brandName = (s.brand || s.title || s.id || sid).toString().trim() || sid;
    const label = groupName + '/ ' + brandName;
    if (sid) selectEl.appendChild(new Option(label, sid));
  });
  selectEl.selectedIndex = 0;
}

async function fetchAndRenderSettlement(baseDateStr, stores, slugToSuburl) {
  const period = getSettlementPeriodFromBaseDate(baseDateStr);
  const box = document.getElementById('brandManagerByDate');
  const pendingBox = document.getElementById('brandManagerPending');
  const caption = document.querySelector('.brand-manager-settlement-caption');
  const groupSelect = document.getElementById('brandManagerGroupSelect');
  const selectedGroup = (groupSelect && groupSelect.value) ? groupSelect.value : '';
  if (caption) caption.textContent = '>> 정산구간 : ' + period.startDate + ' ~ ' + period.endDate;
  if (box) box.innerHTML = getBrandManagerLoadingHtml();
  if (pendingBox) pendingBox.innerHTML = '';
  const token = getToken();
  try {
    const url = `${API_BASE}/api/brand-manager/settlement?startDate=${encodeURIComponent(period.startDate)}&endDate=${encodeURIComponent(period.endDate)}`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
    let data = res.ok ? await res.json() : { byBrand: [], pendingShipment: [] };
    if (slugToSuburl && selectedGroup) data = filterSettlementByGroup(data, selectedGroup, slugToSuburl);
    if (box) box.innerHTML = renderSettlementTable(data.byBrand || []);
    if (pendingBox) pendingBox.innerHTML = renderSettlementPendingList(data.pendingShipment || []);
  } catch (e) {
    if (box) box.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '정산 내역을 불러올 수 없습니다.') + '</p>';
    if (pendingBox) pendingBox.innerHTML = '';
  }
}

async function runStatementSearch() {
  const dateSelectEl = document.getElementById('brandManagerDateSelect');
  const slugEl = document.getElementById('brandManagerBrandSelect');
  const resultBox = document.getElementById('brandManagerStatementResult');
  if (!dateSelectEl || !slugEl || !resultBox) return;
  const baseDate = (dateSelectEl.value || '').trim();
  if (!baseDate) {
    resultBox.innerHTML = '<p class="admin-stats-error">기준 정산일을 선택해 주세요.</p>';
    return;
  }
  const period = getSettlementPeriodFromBaseDate(baseDate);
  const slug = (slugEl.value || '').trim().toLowerCase();
  if (!slug) {
    resultBox.innerHTML = '<p class="admin-stats-error">브랜드를 선택해 주세요.</p>';
    return;
  }
  resultBox.innerHTML = getBrandManagerLoadingHtml();
  const token = getToken();
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/brand-manager/settlement-statement?startDate=${encodeURIComponent(period.startDate)}&endDate=${encodeURIComponent(period.endDate)}&slug=${encodeURIComponent(slug)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      resultBox.innerHTML = '<p class="admin-stats-error">' + escapeHtml(err.error || '정산서를 불러올 수 없습니다.') + '</p>';
      return;
    }
    const data = await res.json();
    resultBox.innerHTML = renderSettlementStatementContent(data);
  } catch (e) {
    resultBox.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '정산서를 불러올 수 없습니다.') + '</p>';
  }
}

function printStatement() {
  const wrap = document.getElementById('brandManagerStatementResult');
  const printEl = wrap?.querySelector('.admin-settlement-statement-print');
  if (!printEl || !printEl.innerHTML.trim()) {
    alert('브랜드를 선택하여 정산서 내용을 불러온 뒤 PDF 출력해 주세요.');
    return;
  }
  const win = window.open('', '_blank');
  if (!win) {
    alert('팝업이 차단되었을 수 있습니다. 브라우저에서 팝업을 허용해 주세요.');
    return;
  }
  win.document.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>정산서</title><style>' +
    'body{font-family:inherit;padding:24px;color:#333;font-size:14px;max-width:640px;margin:0 auto;}' +
    '.admin-settlement-statement-print{}' +
    '.admin-settlement-statement-header{text-align:center;margin-bottom:20px;}' +
    '.admin-settlement-statement-logo{margin:0 0 4px;font-size:1.25rem;font-weight:600;}' +
    '.admin-settlement-statement-title{margin:0 0 4px;font-size:0.875rem;color:#000;}' +
    '.admin-settlement-statement-period{margin:0 0 12px;font-size:0.875rem;color:#666;}' +
    '.admin-settlement-statement-hr{border:none;border-top:1px solid #ddd;margin:12px 0;}' +
    '.admin-settlement-statement-hr--footer{margin:20px 0 12px;}' +
    '.admin-settlement-statement-brand{margin-bottom:20px;font-size:0.875rem;}.admin-settlement-statement-brand p{margin:4px 0;}' +
    '.admin-settlement-statement-body{margin-bottom:12px;}.admin-settlement-statement-body>p{margin:0 0 8px;font-size:0.875rem;}' +
    'table{width:100%;border-collapse:collapse;}th,td{padding:10px 12px;text-align:left;border:1px solid #ddd;}' +
    'th{font-weight:600;background:#f5f5f5;}.admin-settlement-statement-total{font-weight:600;background:#f9f9f9;}' +
    '.admin-settlement-statement-footer{font-size:12px;color:#666;text-align:left;}.admin-settlement-statement-footer p{margin:4px 0;}' +
    '.admin-settlement-statement-issuer{text-align:left;font-size:13px;}.admin-settlement-statement-issuer p{margin:2px 0;}' +
    '</style></head><body>' + printEl.outerHTML + '</body></html>'
  );
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 300);
}

function renderBrandManagerOrderDetailHtml(order) {
  const orderItems = order.order_items || order.orderItems || [];
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
  const byCategorySlugs = Object.keys(byCategory);
  const categoryOrder = brandManagerStoreOrder.length
    ? [...brandManagerStoreOrder, ...byCategorySlugs.filter((s) => !brandManagerStoreOrder.includes(s))]
    : byCategorySlugs.sort();
  for (const slug of Object.keys(byCategory)) {
    byCategory[slug].sort((a, b) => (a.item.name || '').localeCompare(b.item.name || '', 'ko'));
  }
  const categoryTotals = {};
  for (const slug of Object.keys(byCategory)) {
    categoryTotals[slug] = byCategory[slug].reduce((sum, { item, qty }) => sum + item.price * qty, 0);
  }
  const storeDisplayNames = order.store_display_names || {};
  const renderItem = ({ item, qty }) => `
    <div class="admin-order-detail-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name || '')}</div>
        <div class="cart-item-price">${formatAdminPrice(item.price)} × ${qty}</div>
      </div>
    </div>
  `;
  return categoryOrder
    .filter((slug) => byCategory[slug]?.length)
    .map((slug) => {
      const title = storeDisplayNames[slug] || brandManagerStoresMap[slug] || slug;
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

function openBrandManagerOrderDetail(order) {
  const content = document.getElementById('brandManagerOrderDetailContent');
  const totalEl = document.getElementById('brandManagerOrderDetailTotal');
  const overlay = document.getElementById('brandManagerOrderDetailOverlay');
  const panel = overlay?.querySelector('.admin-order-detail-panel');
  if (!content || !overlay) return;
  const html = renderBrandManagerOrderDetailHtml(order);
  content.innerHTML = `<div class="order-detail-list order-detail-cart-style">${html}</div>`;
  if (totalEl) totalEl.textContent = formatAdminPrice(order.total_amount || 0);
  if (panel) panel.classList.toggle('admin-order-detail-cancelled', order.status === 'cancelled');
  overlay.classList.add('visible');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeBrandManagerOrderDetail() {
  const overlay = document.getElementById('brandManagerOrderDetailOverlay');
  if (overlay) {
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

function sortBrandManagerOrders(orders, sortBy, dir) {
  const copy = orders.slice();
  copy.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if ((dir || 'desc') === 'desc') copy.reverse();
  return copy;
}

function renderBrandManagerOrderList() {
  const content = document.getElementById('brandManagerOrdersContent');
  if (!content) return;
  const allOrders = brandManagerOrders;
  const cancelled = (o) => o.status === 'cancelled';
  const orderWaitStatuses = ['submitted', 'order_accepted', 'payment_link_issued'];
  const isOrderWait = (o) => !cancelled(o) && orderWaitStatuses.includes(o.status);
  const isDeliveryWait = (o) => !cancelled(o) && o.status === 'payment_completed';
  const newCount = allOrders.filter(isOrderWait).length;
  const deliveryWaitCount = allOrders.filter(isDeliveryWait).length;
  const deliveryCompletedCount = allOrders.filter((o) => !cancelled(o) && o.status === 'delivery_completed').length;
  const cancelledCount = allOrders.filter((o) => o.status === 'cancelled').length;

  const effectiveFilter = brandManagerSubFilter === 'all' ? 'delivery_wait' : brandManagerSubFilter;
  let filtered;
  if (effectiveFilter === 'new') {
    filtered = allOrders.filter((o) => !cancelled(o) && orderWaitStatuses.includes(o.status));
  } else if (effectiveFilter === 'delivery_wait') {
    filtered = allOrders.filter((o) => o.status === 'payment_completed');
  } else if (effectiveFilter === 'delivery_completed') {
    filtered = allOrders.filter((o) => o.status === 'delivery_completed');
  } else if (effectiveFilter === 'cancelled') {
    filtered = allOrders.filter((o) => o.status === 'cancelled');
  } else {
    filtered = allOrders.filter((o) => o.status === 'payment_completed');
  }

  const sorted = sortBrandManagerOrders(filtered, 'created_at', 'desc');
  const periodStartDate = getBrandManagerStartDateForPeriod(brandManagerPeriod);
  const periodBar = `
    <div class="admin-payment-sort">
      <div class="admin-payment-period-btns">
        <button type="button" class="admin-payment-sort-btn admin-payment-period-btn ${brandManagerPeriod === 'this_month' ? 'active' : ''}" data-period="this_month">이번달</button><span class="admin-payment-period-gap">&nbsp;</span><button type="button" class="admin-payment-sort-btn admin-payment-period-btn ${brandManagerPeriod === '1_month' ? 'active' : ''}" data-period="1_month">1개월전부터</button><span class="admin-payment-period-gap">&nbsp;</span><button type="button" class="admin-payment-sort-btn admin-payment-period-btn ${brandManagerPeriod === '3_months' ? 'active' : ''}" data-period="3_months">3개월전부터</button>
      </div>
      <div class="admin-payment-period-range">>> ${escapeHtml(periodStartDate)} ~ 현재</div>
    </div>
    <div class="admin-payment-subfilter">
      <div class="admin-payment-subfilter-row">
        <span class="admin-payment-subfilter-item ${brandManagerSubFilter === 'new' ? 'active' : ''}" data-subfilter="new" role="button" tabindex="0">주문대기 ${newCount}개</span>
        <span class="admin-payment-subfilter-item ${brandManagerSubFilter === 'delivery_wait' ? 'active' : ''}" data-subfilter="delivery_wait" role="button" tabindex="0">주문완료 ${deliveryWaitCount}개</span>
        <span class="admin-payment-subfilter-item ${brandManagerSubFilter === 'delivery_completed' ? 'active' : ''}" data-subfilter="delivery_completed" role="button" tabindex="0">발송완료 ${deliveryCompletedCount}개</span>
        <span class="admin-payment-subfilter-item ${brandManagerSubFilter === 'cancelled' ? 'active' : ''}" data-subfilter="cancelled" role="button" tabindex="0">취소주문 ${cancelledCount}개</span>
      </div>
    </div>
  `;

  const ordersHtml = sorted.map((order) => {
    const isCancelled = order.status === 'cancelled';
    const orderIdEsc = escapeHtml(String(order.id));
    const orderNumberDisplay = escapeHtml(getOrderNumberDisplay(order)).replace(/, /g, '<br>');
    const orderIdEl = `<span class="admin-payment-order-id admin-payment-order-id-link" data-order-detail="${orderIdEsc}" role="button" tabindex="0">${orderNumberDisplay}</span>`;
    const statusLabel = getStatusLabel(order.status, order.cancel_reason);
    const deliveryAddressEsc = escapeHtml([(order.delivery_address || '').trim(), (order.detail_address || '').trim()].filter(Boolean).join(' ') || '—');
    const storeName = order.profileStoreName || '—';
    const ordererDisplay = `${escapeHtml(storeName)} / ${escapeHtml(order.depositor || '—')}`;
    const isDeliveryCompletedFilter = effectiveFilter === 'delivery_completed';
    const showDeliveryInfo = isDeliveryCompletedFilter && order.status === 'delivery_completed';
    const deliveryInfoText = showDeliveryInfo
      ? (order.delivery_type === 'direct' ? '직접 배송 완료' : (order.courier_company || '—') + ' / ' + (order.tracking_number || ''))
      : '';
    return `
      <div class="admin-payment-order ${isCancelled ? 'admin-payment-order-cancelled' : ''}" data-order-id="${orderIdEsc}">
        <div class="admin-payment-order-header">
          ${orderIdEl}
          <span class="admin-payment-order-status ${order.status}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="admin-payment-order-info">
          <div>주문시간: ${formatAdminOrderDate(order.created_at)}</div>
          <div>배송주소: ${deliveryAddressEsc}</div>
          <div>주문자: ${ordererDisplay}</div>
          <div>이메일: ${escapeHtml(order.user_email || '—')}</div>
        </div>
        ${showDeliveryInfo ? `<div class="admin-payment-link-row"><span class="admin-payment-delivery-info">*배송정보 : ${escapeHtml(deliveryInfoText)}</span></div>` : ''}
      </div>
    `;
  }).join('');

  content.innerHTML = periodBar + ordersHtml;

  content.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period;
      if (period && brandManagerPeriod !== period) {
        brandManagerPeriod = period;
        loadOrdersView();
      }
    });
  });

  content.querySelectorAll('[data-subfilter]').forEach((el) => {
    const handler = () => {
      brandManagerSubFilter = el.dataset.subfilter || 'delivery_wait';
      renderBrandManagerOrderList();
    };
    el.addEventListener('click', handler);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
    });
  });

  content.querySelectorAll('[data-order-detail]').forEach((el) => {
    el.addEventListener('click', () => {
      const orderId = el.dataset.orderDetail;
      const order = brandManagerOrders.find((o) => o.id === orderId);
      if (order) openBrandManagerOrderDetail(order);
    });
  });

}

async function loadOrdersView() {
  const content = document.getElementById('brandManagerOrdersContent');
  if (!content) return;
  content.innerHTML = getBrandManagerPeriodBarOnlyHtml() + '<div class="brand-manager-loading-wrap">' + getBrandManagerLoadingHtml() + '</div>';
  attachBrandManagerPeriodListeners(content);

  const token = getToken();
  if (!token) {
    content.innerHTML = '<p class="admin-stats-error">로그인이 필요합니다.</p>';
    return;
  }

  try {
    const startDate = getBrandManagerStartDateForPeriod(brandManagerPeriod);
    const res = await fetchWithTimeout(`${API_BASE}/api/brand-manager/orders?limit=${BRAND_ORDERS_FULL_LOAD_LIMIT}&offset=0&startDate=${encodeURIComponent(startDate)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      content.innerHTML = '<p class="admin-stats-error">' + escapeHtml(err.error || '주문 목록을 불러올 수 없습니다.') + '</p>';
      return;
    }
    const data = await res.json();
    brandManagerOrders = data.orders || [];
    brandManagerOrdersTotal = typeof data.total === 'number' ? data.total : brandManagerOrders.length;

    const storesRes = await fetchWithTimeout(`${API_BASE}/api/brand-manager/stores`, { headers: { Authorization: `Bearer ${token}` } });
    if (storesRes.ok) {
      const storesData = await storesRes.json();
      const rawStores = storesData.stores != null ? storesData.stores : storesData;
      const storeList = Array.isArray(rawStores) ? rawStores.flat().filter((s) => s && typeof s === 'object') : (rawStores && typeof rawStores === 'object' && !Array.isArray(rawStores) ? Object.values(rawStores).flat().filter((s) => s && typeof s === 'object') : []);
      brandManagerStoresMap = {};
      brandManagerStoreOrder = [];
      (storeList || []).forEach((s) => {
        const slug = (s.slug || s.id || '').toString().toLowerCase();
        const title = (s.title || s.brand || slug).toString().trim() || slug;
        if (slug) {
          brandManagerStoresMap[slug] = title;
          if (s.id && s.id !== slug) brandManagerStoresMap[s.id] = title;
          brandManagerStoreOrder.push(slug);
        }
      });
    }

    if (brandManagerOrders.length === 0 && brandManagerOrdersTotal === 0) {
      content.innerHTML = '<div class="admin-loading">주문 내역이 없습니다.</div>';
      return;
    }

    renderBrandManagerOrderList();
  } catch (e) {
    content.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '오류가 발생했습니다.') + '</p>';
  }
}

function setupBrandTabs() {
  const tabs = document.querySelectorAll('.store-orders-tab[data-brand-tab]');
  const ordersView = document.getElementById('brandManagerOrdersView');
  const settlementView = document.getElementById('brandManagerSettlementView');

  function activateTab(targetTab) {
    tabs.forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    if (ordersView) ordersView.classList.remove('active');
    if (settlementView) settlementView.classList.remove('active');

    const tabEl = document.querySelector(`.store-orders-tab[data-brand-tab="${targetTab}"]`);
    if (tabEl) {
      tabEl.classList.add('active');
      tabEl.setAttribute('aria-selected', 'true');
    }
    if (targetTab === 'orders') {
      if (ordersView) ordersView.classList.add('active');
      loadOrdersView();
    } else if (targetTab === 'settlement') {
      if (settlementView) settlementView.classList.add('active');
      loadSettlementView();
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.brandTab;
      if (targetTab) activateTab(targetTab);
    });
  });

  activateTab('orders');
}

document.getElementById('brandManagerOrderDetailClose')?.addEventListener('click', closeBrandManagerOrderDetail);
document.getElementById('brandManagerOrderDetailOverlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'brandManagerOrderDetailOverlay') closeBrandManagerOrderDetail();
});

async function loadSettlementView() {
  const container = document.getElementById('brandManagerSettlementContent');
  if (!container) return;
  container.innerHTML = getBrandManagerLoadingHtml();
  const token = getToken();
  if (!token) {
    container.innerHTML = '<p class="admin-stats-error">로그인이 필요합니다.</p>';
    return;
  }
  try {
    const storesRes = await fetchWithTimeout(`${API_BASE}/api/brand-manager/stores`, { headers: { Authorization: `Bearer ${token}` } });
    if (!storesRes.ok) {
      const err = await storesRes.json().catch(() => ({}));
      container.innerHTML = '<p class="admin-stats-error">' + escapeHtml(err.error || '매장 목록을 불러올 수 없습니다.') + '</p>';
      return;
    }
    const data = await storesRes.json();
    const rawStores = data.stores != null ? data.stores : data;
    const storeList = Array.isArray(rawStores)
      ? rawStores.flat().filter((s) => s && typeof s === 'object')
      : (rawStores && typeof rawStores === 'object' && !Array.isArray(rawStores))
        ? Object.values(rawStores).flat().filter((s) => s && typeof s === 'object')
        : [];
    const settlementDates = getSettlementDateOptions();
    const defaultDate = settlementDates[0] || getTodayKST();
    const defaultPeriod = getSettlementPeriodFromBaseDate(defaultDate);
    const dateSelectOptions = settlementDates.map((d) => '<option value="' + escapeHtml(d) + '"' + (d === defaultDate ? ' selected' : '') + '>' + escapeHtml(d) + '</option>').join('');
    const groupNames = [...new Set(storeList.map((s) => getStoreGroup(s)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    const firstGroup = groupNames[0] || '';
    const groupOptions = groupNames.map((g) => '<option value="' + escapeHtml(g) + '"' + (g === firstGroup ? ' selected' : '') + '>' + escapeHtml(g) + '</option>').join('');
    container.innerHTML =
      '<div class="admin-settlement-statement-area" style="margin-top:0;padding-top:0;border-top:none;">' +
      '<h3 class="admin-settlement-statement-heading">정산</h3>' +
      '<div class="admin-stats-daterange" style="margin-bottom:16px;">' +
      '<select id="brandManagerGroupSelect" class="admin-settlement-brand-select" style="min-width:160px;">' + groupOptions + '</select>' +
      '</div></div>' +
      '<section class="admin-stats-section">' +
      '<div class="admin-stats-daterange" style="margin-bottom:8px;">' +
      '<label for="brandManagerDateSelect" class="admin-settlement-date-label">기준 정산일</label>' +
      '<select id="brandManagerDateSelect" class="admin-settlement-date-select">' + dateSelectOptions + '</select>' +
      '</div>' +
      '<p class="brand-manager-settlement-caption admin-settlement-caption">&gt;&gt; 정산구간 : ' + escapeHtml(defaultPeriod.startDate) + ' ~ ' + escapeHtml(defaultPeriod.endDate) + '</p>' +
      '<div id="brandManagerByDate"></div>' +
      '<div id="brandManagerPending" class="admin-settlement-pending"></div>' +
      '</section>';
    const slugToSuburl = buildSlugToSuburl(storeList);
    await fetchAndRenderSettlement(defaultDate, storeList, slugToSuburl);
    document.getElementById('brandManagerDateSelect')?.addEventListener('change', function () {
      fetchAndRenderSettlement(this.value, storeList, slugToSuburl);
    });
    document.getElementById('brandManagerGroupSelect')?.addEventListener('change', function () {
      const selGroup = this.value || '';
      const dateSelect = document.getElementById('brandManagerDateSelect');
      fetchAndRenderSettlement(dateSelect?.value || defaultDate, storeList, slugToSuburl);
    });
  } catch (e) {
    container.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '로딩에 실패했습니다.') + '</p>';
  }
}

async function checkBrandManagerAccess() {
  const token = getToken();
  if (!token) {
    window.location.href = '/';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      window.location.href = '/';
      return;
    }
    const data = await res.json();
    const user = data.user;
    const isAdmin = user && user.level === 'admin';
    const isBrandManager = user && user.isBrandManager;
    if (!isAdmin && !isBrandManager) {
      window.location.href = '/';
      return;
    }
    setupBrandTabs();
  } catch (_) {
    window.location.href = '/';
  }
}

(function tickBrandManagerLoadingProgress() {
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
  setTimeout(tickBrandManagerLoadingProgress, 150);
})();

  checkBrandManagerAccess();
}
