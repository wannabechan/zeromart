/**
 * 브랜드관리 페이지 - 정산관리 (어드민 정산관리와 동일, 그룹 콤보에 '전체' 없음)
 * 모바일에서는 이 페이지 접근 시 주문 페이지(/)로 자동 이동.
 */

const TOKEN_KEY = 'bzcat_token';
const API_BASE = '';
const FETCH_TIMEOUT_MS = 15000;

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
  let html = heading + '<table class="admin-stats-table admin-settlement-table-cols5"><thead><tr><th>브랜드</th><th>주문 수</th><th>판매금액</th><th>수수료</th><th>정산금액</th></tr></thead><tbody>';
  byBrand.forEach((b) => {
    const sales = Number(b.totalAmount) || 0;
    const fee = Math.round(sales * 0.048);
    const settlement = sales - fee;
    html += '<tr><td>' + escapeHtml(b.brandTitle || b.slug || '') + '</td><td>' + (b.orderCount || 0) + '</td><td>' + formatMoney(sales) + '</td><td>' + formatMoney(fee) + '</td><td>' + formatMoney(settlement) + '</td></tr>';
  });
  html += '</tbody></table>';
  return html;
}

function renderSettlementPendingList(pendingShipment) {
  const heading = '<h4 class="admin-settlement-pending-heading">주문 완료 (발송 완료 미처리) 목록</h4>';
  if (!pendingShipment || pendingShipment.length === 0) {
    return heading + '<p class="admin-settlement-empty">정산 구간 내 미발송 주문이 없습니다.</p>';
  }
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  const statusLabel = (s) => (s === 'shipping' ? '배송중' : '결제완료');
  let html = heading;
  html += '<table class="admin-stats-table admin-settlement-table-cols5"><thead><tr><th>주문일</th><th>브랜드</th><th>주문번호</th><th>금액</th><th>상태</th></tr></thead><tbody>';
  pendingShipment.forEach((o) => {
    html += '<tr><td>' + escapeHtml(o.orderDate || '') + '</td><td>' + escapeHtml(o.brandTitle || o.slug || '') + '</td><td>' + escapeHtml(String(o.id || '')) + '</td><td>' + formatMoney(Number(o.total_amount) || 0) + '</td><td>' + escapeHtml(statusLabel(o.status)) + '</td></tr>';
  });
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
  html += '<p class="admin-settlement-statement-bullet">• 브랜드명: ' + brandName + '</p>';
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
  html += '<p>* 정산금액은 귀사의 지정된 입금 계좌로 현금 지급됩니다.</p>';
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
    const suburl = (s.suburl || '').toString().trim();
    if (slug) map[slug] = suburl || '';
  });
  return map;
}

function filterSettlementByGroup(data, selectedGroup, slugToSuburl) {
  if (!selectedGroup) return data;
  const byBrand = (data.byBrand || []).filter((b) => slugToSuburl[b.slug] === selectedGroup);
  const pendingShipment = (data.pendingShipment || []).filter((p) => slugToSuburl[p.slug] === selectedGroup);
  return { ...data, byBrand, pendingShipment };
}

function populateBrandSelect(stores, selectedGroup) {
  const selectEl = document.getElementById('brandManagerBrandSelect');
  if (!selectEl) return;
  while (selectEl.options.length) selectEl.remove(0);
  selectEl.appendChild(new Option('브랜드 선택', ''));
  let list = (stores || []).slice();
  if (selectedGroup) {
    list = list.filter((s) => ((s.suburl || '').toString().trim() || '') === selectedGroup);
  }
  list.sort((a, b) => {
    const ga = (a.suburl || a.id || '').toString().trim() || '';
    const gb = (b.suburl || b.id || '').toString().trim() || '';
    const c = ga.localeCompare(gb, 'ko');
    if (c !== 0) return c;
    const ba = (a.brand || a.title || a.id || '').toString().trim() || '';
    const bb = (b.brand || b.title || b.id || '').toString().trim() || '';
    return ba.localeCompare(bb, 'ko');
  });
  list.forEach((s) => {
    const sid = (s.slug || s.id || '').toString().toLowerCase();
    const groupName = (s.suburl || s.id || sid).toString().trim() || sid;
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
  if (box) box.innerHTML = '<div class="admin-loading">로딩 중...</div>';
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
  resultBox.innerHTML = '<div class="admin-loading">로딩 중...</div>';
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

async function loadSettlementView() {
  const container = document.getElementById('brandManagerSettlementContent');
  if (!container) return;
  container.innerHTML = '<div class="admin-loading">로딩 중...</div>';
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
    const { stores } = await storesRes.json();
    const storeList = Array.isArray(stores) ? stores : [];
    const settlementDates = getSettlementDateOptions();
    const defaultDate = settlementDates[0] || getTodayKST();
    const defaultPeriod = getSettlementPeriodFromBaseDate(defaultDate);
    const dateSelectOptions = settlementDates.map((d) => '<option value="' + escapeHtml(d) + '"' + (d === defaultDate ? ' selected' : '') + '>' + escapeHtml(d) + '</option>').join('');
    const groupNames = [...new Set(storeList.map((s) => (s.suburl || '').toString().trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
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
      '</section>' +
      '<div class="admin-settlement-statement-area">' +
      '<h3 class="admin-settlement-statement-heading">정산서 출력</h3>' +
      '<div class="admin-stats-daterange" style="margin-bottom:16px;">' +
      '<select id="brandManagerBrandSelect" class="admin-settlement-brand-select"></select>' +
      '</div>' +
      '<div id="brandManagerStatementResult" class="admin-settlement-statement-result"></div>' +
      '<div style="margin-top:16px;"><button type="button" class="admin-btn admin-settlement-pdf-btn" id="brandManagerPdfBtn">PDF 출력하기</button></div>' +
      '</div>';
    const slugToSuburl = buildSlugToSuburl(storeList);
    populateBrandSelect(storeList, firstGroup);
    await fetchAndRenderSettlement(defaultDate, storeList, slugToSuburl);
    document.getElementById('brandManagerDateSelect')?.addEventListener('change', function () {
      fetchAndRenderSettlement(this.value, storeList, slugToSuburl);
      const resultBox = document.getElementById('brandManagerStatementResult');
      if (resultBox) resultBox.innerHTML = '';
    });
    document.getElementById('brandManagerGroupSelect')?.addEventListener('change', function () {
      const selGroup = this.value || '';
      populateBrandSelect(storeList, selGroup);
      const dateSelect = document.getElementById('brandManagerDateSelect');
      fetchAndRenderSettlement(dateSelect?.value || defaultDate, storeList, slugToSuburl);
      const resultBox = document.getElementById('brandManagerStatementResult');
      if (resultBox) resultBox.innerHTML = '';
    });
    document.getElementById('brandManagerBrandSelect')?.addEventListener('change', runStatementSearch);
    document.getElementById('brandManagerPdfBtn')?.addEventListener('click', printStatement);
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
    loadSettlementView();
  } catch (_) {
    window.location.href = '/';
  }
}

  checkBrandManagerAccess();
}
