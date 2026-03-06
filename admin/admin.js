/**
 * Admin 페이지 - 매장·메뉴·결제정보 관리
 */

const TOKEN_KEY = 'bzcat_token';
const API_BASE = '';
const FETCH_TIMEOUT_MS = 15000;
const ADMIN_TAB_KEY = 'bzcat_admin_tab';

let adminPaymentOrders = [];
let adminPaymentTotal = 0;
let adminPaymentSortBy = 'created_at'; // 'created_at' | 'delivery_date'
let adminPaymentSortDir = { created_at: 'desc', delivery_date: 'desc' }; // 'asc' = 오래된순(↑), 'desc' = 최신순(↓)
let adminPaymentSubFilter = 'all'; // 'all' | 'new' | 'payment_wait' | 'delivery_wait' | 'shipping' | 'delivery_completed'
let adminStoresMap = {};
let adminStoreOrder = []; // slug order for order detail
let adminStatsLastData = null;
let adminStatsMenuFilter = 'top10'; // 'top10' | 'all'

const PAYMENT_IDLE_MS = 180000; // 180초 무활동 시 주문 목록 리프레시
let paymentIdleTimerId = null;
let paymentIdleListenersAttached = false;
let adminPaymentFlashIntervals = [];

// 이미지 규칙: 1:1 비율, 권장 400x400px
const IMAGE_RULE = '가로·세로 1:1 비율, 권장 400×400px';

const BUSINESS_HOURS_SLOTS = ['09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00'];

/** 정산관리 탭 테스트용 목 데이터 사용. '정산관리 테스트 종료' 요청 시 false로 변경 후 실제 DB 적용 */
const SETTLEMENT_MOCK_FOR_TEST = true;

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function escapeHtml(s) {
  if (s == null || s === '') return '';
  const t = String(s);
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** img src에 쓸 수 있는 URL만 허용 (http/https 또는 / 로 시작) */
function safeImageUrl(url) {
  const u = (url || '').trim();
  if (!u) return '';
  const lower = u.toLowerCase();
  if (lower.startsWith('https://') || lower.startsWith('http://') || u.startsWith('/')) return u;
  return '';
}

function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

async function checkAdmin() {
  const token = getToken();
  if (!token) return { ok: false, error: '로그인이 필요합니다.' };
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/session`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: '세션이 만료되었습니다.' };
    const data = await res.json();
    const isAdmin = data.user?.level === 'admin';
    return { ok: isAdmin, error: isAdmin ? null : '관리자만 접근할 수 있습니다.' };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '요청 시간이 초과되었습니다.' : (e.message || '연결에 실패했습니다.') };
  }
}

async function fetchStores() {
  const token = getToken();
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/stores`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '데이터를 불러올 수 없습니다.');
    }
    return res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('요청 시간이 초과되었습니다. 네트워크를 확인하고 다시 시도해 주세요.');
    throw e;
  }
}

async function saveStores(stores, menus) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/admin/stores`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ stores, menus }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '저장에 실패했습니다.');
  }
}

async function uploadImage(file) {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/admin/upload-image`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '업로드에 실패했습니다.');
  return data.url;
}

function showError(msg) {
  const el = document.getElementById('adminError');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('adminError').style.display = 'none';
}

function generateId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function generateStoreId() {
  return `store-${Date.now().toString(36)}`;
}

function renderStore(store, menus) {
  const payment = store.payment || { apiKeyEnvVar: 'TOSS_SECRET_KEY' };
  const items = menus || [];
  const storeIdEsc = escapeHtml(store.id || '');

  return `
    <div class="admin-store" id="admin-store-${storeIdEsc.replace(/"/g, '')}" data-store-id="${storeIdEsc}">
      <div class="admin-store-header">
        <span class="admin-store-title">${escapeHtml(store.title || store.id || '')}</span>
        <div class="admin-store-header-actions">
          <button type="button" class="admin-btn admin-btn-top" data-scroll-top aria-label="맨 위로">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          </button>
          <button type="button" class="admin-btn admin-btn-danger admin-btn-delete-store" data-delete-store="${storeIdEsc}" title="카테고리 삭제">삭제</button>
        </div>
      </div>
      <div class="admin-store-body">
        <div class="admin-section">
          <div class="admin-section-title-row">
            <span class="admin-section-title">매장 정보</span>
            <button type="button" class="admin-btn admin-btn-icon admin-btn-settings" data-store-settings="${storeIdEsc}" aria-label="API 환경변수 설정" title="API 환경변수 설정">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
          <div class="admin-form-row">
            <div class="admin-form-field">
              <label>대분류</label>
              <input type="text" data-field="title" value="${escapeHtml(store.title || '')}" placeholder="예: 도시락">
            </div>
          </div>
          <input type="hidden" data-field="apiKeyEnvVar" value="${escapeHtml(payment.apiKeyEnvVar || 'TOSS_SECRET_KEY')}">
          <input type="hidden" data-field="businessDays" value="${(store.businessDays && Array.isArray(store.businessDays) ? store.businessDays : [0,1,2,3,4,5,6]).join(',')}">
          <input type="hidden" data-field="businessHours" value="${(store.businessHours && Array.isArray(store.businessHours) ? store.businessHours : BUSINESS_HOURS_SLOTS).join(',')}">
        </div>
        <div class="admin-section">
          <div class="admin-section-title">브랜드</div>
          <div class="admin-form-row">
            <div class="admin-form-field">
              <label>브랜드명</label>
              <input type="text" data-field="brand" value="${escapeHtml(store.brand || '')}" placeholder="예: OO브랜드">
            </div>
            <div class="admin-form-field" style="flex: 2;">
              <label>매장주소</label>
              <input type="text" data-field="storeAddress" value="${escapeHtml(store.storeAddress || '')}" placeholder="예: 서울시 강남구 OO로 123">
            </div>
            <div class="admin-form-field">
              <label>사업자등록번호</label>
              <input type="text" data-field="bizNo" value="${escapeHtml(store.bizNo || '')}" placeholder="예: 000-00-00000">
            </div>
          </div>
          <div class="admin-form-row admin-form-row--brand-row2">
            <div class="admin-form-field admin-form-field--representative">
              <label>대표자</label>
              <input type="text" data-field="representative" value="${escapeHtml(store.representative || '')}" placeholder="대표자명">
        </div>
            <div class="admin-form-field">
              <label>담당자연락처</label>
              <input type="text" data-field="storeContact" value="${escapeHtml(store.storeContact || '')}" placeholder="예: 02-1234-5678">
            </div>
            <div class="admin-form-field admin-form-field--store-contact-email">
              <label>담당자이메일</label>
              <input type="email" data-field="storeContactEmail" value="${escapeHtml(store.storeContactEmail || '')}" placeholder="예: contact@example.com">
          </div>
            <div class="admin-form-field">
              <label>suburl</label>
              <input type="text" data-field="suburl" value="${escapeHtml(store.suburl || '')}" placeholder="영어 소문자" pattern="[a-z]*" autocomplete="off">
            </div>
          </div>
        </div>
        <div class="admin-section">
          <div class="admin-section-title">메뉴</div>
          <div class="admin-menu-list" data-store-id="${storeIdEsc}">
            ${items.map((item, i) => renderMenuItem(store.id, item, i)).join('')}
          </div>
          <button type="button" class="admin-btn admin-btn-secondary admin-btn-add" data-add-menu="${storeIdEsc}">+ 메뉴 추가</button>
        </div>
        <div class="admin-save-bar">
          <button type="button" class="admin-btn admin-btn-primary" data-save>저장</button>
        </div>
      </div>
    </div>
  `;
}

function renderMenuItem(storeId, item, index) {
  const safeUrl = safeImageUrl(item.imageUrl);
  const imgContent = safeUrl
    ? `<img src="${escapeHtml(safeUrl)}" alt="" onerror="this.parentElement.innerHTML='<span class=\\'placeholder\\'>📷</span>'">`
    : '<span class="placeholder">📷</span>';
  return `
    <div class="admin-menu-item" data-menu-index="${index}" data-menu-id="${escapeHtml(item.id || '')}">
      <div class="admin-menu-thumb">${imgContent}</div>
      <div class="admin-menu-fields">
        <div class="admin-form-field">
          <label>메뉴명</label>
          <input type="text" data-field="name" value="${escapeHtml(item.name || '')}" placeholder="메뉴명">
        </div>
        <div class="admin-form-row">
          <div class="admin-form-field">
            <label>가격 (원)</label>
            <input type="number" data-field="price" value="${item.price || 0}" placeholder="0" min="0">
          </div>
          <div class="admin-form-field admin-form-field-image" style="flex: 2;">
            <label>이미지</label>
            <div class="admin-image-input-row">
              <input type="url" data-field="imageUrl" value="${escapeHtml(item.imageUrl || '')}" placeholder="URL 또는 업로드">
              <input type="file" data-upload-input accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
              <button type="button" class="admin-btn admin-btn-upload" data-upload-btn title="파일 업로드">📤 업로드</button>
            </div>
            <div class="admin-image-rule">${IMAGE_RULE}</div>
          </div>
        </div>
        <div class="admin-form-field">
          <label>설명</label>
          <textarea data-field="description" placeholder="메뉴 설명">${escapeHtml(item.description || '')}</textarea>
        </div>
      </div>
      <div class="admin-menu-actions">
        <button type="button" class="admin-btn admin-btn-danger" data-remove-menu data-store-id="${escapeHtml(storeId)}" data-index="${index}">삭제</button>
      </div>
    </div>
  `;
}

/** 담당자연락처: 010으로 시작하는 11자리 휴대폰 번호만 허용 (공백/하이픈 제거 후 판단) */
function isValidKoreanMobile(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return true;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('010');
}

function collectData() {
  const stores = [];
  const menus = {};
  const list = document.getElementById('adminStoresList');
  const storeEls = list ? list.querySelectorAll('.admin-store') : document.querySelectorAll('.admin-store');

  storeEls.forEach((storeEl) => {
    const storeId = storeEl.dataset.storeId;
    const titleInput = storeEl.querySelector('input[data-field="title"]');
    const brandInput = storeEl.querySelector('input[data-field="brand"]');
    const storeAddressInput = storeEl.querySelector('input[data-field="storeAddress"]');
    const storeContactInput = storeEl.querySelector('input[data-field="storeContact"]');
    const storeContactEmailInput = storeEl.querySelector('input[data-field="storeContactEmail"]');
    const representativeInput = storeEl.querySelector('input[data-field="representative"]');
    const bizNoInput = storeEl.querySelector('input[data-field="bizNo"]');
    const suburlInput = storeEl.querySelector('input[data-field="suburl"]');
    const apiKeyEnvVarInput = storeEl.querySelector('input[data-field="apiKeyEnvVar"]');
    const businessDaysInput = storeEl.querySelector('input[data-field="businessDays"]');
    const businessHoursInput = storeEl.querySelector('input[data-field="businessHours"]');
    const businessDaysStr = businessDaysInput?.value?.trim() || '0,1,2,3,4,5,6';
    const businessDays = businessDaysStr.split(',').map((d) => parseInt(d, 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 6);
    const businessHoursStr = businessHoursInput?.value?.trim() || BUSINESS_HOURS_SLOTS.join(',');
    const businessHours = businessHoursStr.split(',').map((s) => s.trim()).filter((s) => BUSINESS_HOURS_SLOTS.includes(s));
    const store = { id: storeId, slug: storeId, title: titleInput?.value?.trim() || storeId, brand: brandInput?.value?.trim() || '', storeAddress: storeAddressInput?.value?.trim() || '', storeContact: storeContactInput?.value?.trim() || '', storeContactEmail: storeContactEmailInput?.value?.trim() || '', representative: representativeInput?.value?.trim() || '', bizNo: bizNoInput?.value?.trim() || '', suburl: (suburlInput?.value?.trim() || '').toLowerCase().replace(/[^a-z]/g, ''), businessDays: businessDays.length ? businessDays.sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6], businessHours: businessHours.length ? businessHours : [...BUSINESS_HOURS_SLOTS], payment: {
      apiKeyEnvVar: apiKeyEnvVarInput?.value?.trim() || 'TOSS_SECRET_KEY',
    } };
    stores.push(store);

    const menuList = storeEl.querySelector('.admin-menu-list');
    const items = [];
    menuList?.querySelectorAll('.admin-menu-item').forEach((itemEl) => {
      const nameInput = itemEl.querySelector('input[data-field="name"]');
      const priceInput = itemEl.querySelector('input[data-field="price"]');
      const descInput = itemEl.querySelector('textarea[data-field="description"]');
      const imageInput = itemEl.querySelector('input[data-field="imageUrl"]');
      const name = nameInput?.value?.trim();
      if (!name) return;
      items.push({
        id: itemEl.dataset.menuId || generateId(storeId),
        name,
        price: parseInt(priceInput?.value || '0', 10) || 0,
        description: descInput?.value?.trim() || '',
        imageUrl: imageInput?.value?.trim() || '',
      });
    });
    menus[storeId] = items;
  });

  return { stores, menus };
}

function showLoadingError(msg, showRetry = false) {
  const content = document.getElementById('adminContent');
  content.innerHTML = `
    <div class="admin-loading admin-error">
      <p>${escapeHtml(msg || '')}</p>
      <p style="margin-top:12px;font-size:0.875rem;color:var(--color-text-secondary);">
        로그인 후 메인 화면에서 admin 링크를 통해 접속해 주세요.
      </p>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
        <a href="/" class="admin-btn admin-btn-primary">메인으로</a>
        ${showRetry ? '<button type="button" class="admin-btn admin-btn-secondary" id="adminRetryBtn">다시 시도</button>' : ''}
      </div>
    </div>
  `;
  if (showRetry) {
    document.getElementById('adminRetryBtn')?.addEventListener('click', () => {
      document.getElementById('adminContent').innerHTML = '<div class="admin-loading">로딩 중...</div>';
      init();
    });
  }
}

function setupTabs() {
  const tabs = document.querySelectorAll('.admin-tab');
  const views = document.querySelectorAll('.admin-view');
  
  function activateTab(targetTab) {
      tabs.forEach(t => t.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));
    const tabEl = document.querySelector(`.admin-tab[data-tab="${targetTab}"]`);
    if (tabEl) tabEl.classList.add('active');
      if (targetTab === 'stores') {
        document.getElementById('storesView').classList.add('active');
        clearPaymentIdleTimer();
      } else if (targetTab === 'payments') {
        document.getElementById('paymentsView').classList.add('active');
        loadPaymentManagement().then(() => startPaymentIdleRefresh());
    } else     if (targetTab === 'stats') {
      document.getElementById('statsView').classList.add('active');
      loadStats();
    } else if (targetTab === 'settlement') {
      document.getElementById('settlementView').classList.add('active');
      loadSettlement();
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      if (targetTab) sessionStorage.setItem(ADMIN_TAB_KEY, targetTab);
      activateTab(targetTab);
    });
  });

  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const isReload = nav?.type === 'reload' || (typeof performance.navigation !== 'undefined' && performance.navigation.type === 1);
  const saved = sessionStorage.getItem(ADMIN_TAB_KEY);
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
  const tabToActivate = (saved && ['stores', 'payments', 'stats', 'settlement'].includes(saved) && (saved !== 'settlement' || !isMobile())) ? saved : (isMobile() ? 'payments' : 'stores');
  if (isReload && saved) {
    activateTab(tabToActivate);
  }
}

/** 신청 완료 주문이 주문일+1일 15:00까지 승인/거절되지 않은 경우 true */
function isOverdueForAccept(order) {
  if (order.status !== 'submitted') return false;
  const created = new Date(order.created_at);
  const deadline = new Date(created);
  deadline.setDate(deadline.getDate() + 1);
  deadline.setHours(15, 0, 0, 0);
  return new Date() > deadline;
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

function renderPaymentList() {
  const content = document.getElementById('adminPaymentContent');
  const allOrders = adminPaymentOrders;
  const cancelled = (o) => o.status === 'cancelled';

  const newCount = allOrders.filter(o => !cancelled(o) && (o.status === 'submitted' || o.status === 'order_accepted')).length;
  const paymentWaitCount = allOrders.filter(o => !cancelled(o) && o.status === 'payment_link_issued').length;
  const deliveryWaitCount = allOrders.filter(o => !cancelled(o) && o.status === 'payment_completed').length;
  const shippingCount = allOrders.filter(o => !cancelled(o) && o.status === 'shipping').length;
  const deliveryCompletedCount = allOrders.filter(o => !cancelled(o) && o.status === 'delivery_completed').length;

  let filtered;
  if (adminPaymentSubFilter === 'new') {
    filtered = allOrders.filter(o => o.status === 'submitted' || o.status === 'order_accepted');
  } else if (adminPaymentSubFilter === 'payment_wait') {
    filtered = allOrders.filter(o => o.status === 'payment_link_issued');
  } else if (adminPaymentSubFilter === 'delivery_wait') {
    filtered = allOrders.filter(o => o.status === 'payment_completed');
  } else if (adminPaymentSubFilter === 'shipping') {
    filtered = allOrders.filter(o => o.status === 'shipping');
  } else if (adminPaymentSubFilter === 'delivery_completed') {
    filtered = allOrders.filter(o => o.status === 'delivery_completed');
  } else {
    filtered = allOrders.slice();
  }

  const sortBy = adminPaymentSortBy;
  const dir = adminPaymentSortDir[sortBy] || 'desc';
  const sorted = sortPaymentOrders(filtered, sortBy, dir);

  const arrow = (key) => (adminPaymentSortDir[key] === 'asc' ? ' ↑' : ' ↓');
  const sortBar = `
    <div class="admin-payment-sort">
      <div class="admin-payment-sort-btns">
        <button type="button" class="admin-payment-sort-btn ${sortBy === 'created_at' ? 'active' : ''}" data-sort="created_at">주문시간${arrow('created_at')}</button>
        <button type="button" class="admin-payment-sort-btn ${sortBy === 'delivery_date' ? 'active' : ''}" data-sort="delivery_date">배송희망일시${arrow('delivery_date')}</button>
      </div>
    </div>
    <div class="admin-payment-subfilter">
      <div class="admin-payment-subfilter-row">
        <span class="admin-payment-subfilter-item ${adminPaymentSubFilter === 'all' ? 'active' : ''}" data-subfilter="all" role="button" tabindex="0">전체보기</span>
        <span class="admin-payment-subfilter-item ${adminPaymentSubFilter === 'new' ? 'active' : ''}" data-subfilter="new" role="button" tabindex="0">신규주문 ${newCount}개</span>
        <span class="admin-payment-subfilter-item ${adminPaymentSubFilter === 'payment_wait' ? 'active' : ''}" data-subfilter="payment_wait" role="button" tabindex="0">결제대기 ${paymentWaitCount}개</span>
      </div>
      <div class="admin-payment-subfilter-row">
        <span class="admin-payment-subfilter-item ${adminPaymentSubFilter === 'delivery_wait' ? 'active' : ''}" data-subfilter="delivery_wait" role="button" tabindex="0">배송대기 ${deliveryWaitCount}개</span>
        <span class="admin-payment-subfilter-item ${adminPaymentSubFilter === 'shipping' ? 'active' : ''}" data-subfilter="shipping" role="button" tabindex="0">배송중 ${shippingCount}개</span>
        <span class="admin-payment-subfilter-item ${adminPaymentSubFilter === 'delivery_completed' ? 'active' : ''}" data-subfilter="delivery_completed" role="button" tabindex="0">배송완료 ${deliveryCompletedCount}개</span>
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
    const isUrgent = !isCancelled && daysUntilDelivery <= 7 && !(order.payment_link && String(order.payment_link).trim());
    const isPaymentDone = order.status === 'payment_completed' || order.status === 'shipping' || order.status === 'delivery_completed';
    const paymentLinkRowDisabled = isCancelled || isPaymentDone || order.status === 'submitted' || !!(order.payment_link && String(order.payment_link).trim());
    const shippingRowDisabled = order.status !== 'payment_completed';
    const deliveryRowDisabled = order.status !== 'shipping';
    const shippingValue = (order.status === 'shipping' || order.status === 'delivery_completed') ? (order.tracking_number || '') : '';
    const overdue = isOverdueForAccept(order);
    const orderIdEsc = escapeHtml(String(order.id));
    const orderIdEl = overdue
      ? `<span class="admin-payment-order-id admin-overdue-flash admin-payment-order-id-link" data-order-detail="${orderIdEsc}" data-overdue-flash role="button" tabindex="0"><span class="admin-overdue-id">주문 #${orderIdEsc}</span><span class="admin-overdue-msg">주문 신청을 승인해 주세요.</span></span>`
      : `<span class="admin-payment-order-id admin-payment-order-id-link" data-order-detail="${orderIdEsc}" role="button" tabindex="0">주문 #${orderIdEsc}</span>`;

    const statusLabelEsc = escapeHtml(getStatusLabel(order.status, order.cancel_reason));
    const deliveryAddressEsc = escapeHtml([(order.delivery_address || '').trim(), (order.detail_address || '').trim()].filter(Boolean).join(' ') || '—');
    const paymentLinkEsc = escapeHtml(order.payment_link || '');
    const shippingValueEsc = escapeHtml(shippingValue || '');
    const deliveryInputValueEsc = order.status === 'delivery_completed' ? escapeHtml(`주문 #${order.id}`) : '';

    return `
      <div class="admin-payment-order ${isCancelled ? 'admin-payment-order-cancelled' : ''}" data-order-id="${orderIdEsc}">
        <div class="admin-payment-order-header">
          ${orderIdEl}
          <span class="admin-payment-order-status ${order.status}">${statusLabelEsc}</span>
        </div>
        <div class="admin-payment-order-info">
          <div>주문시간: ${formatAdminOrderDate(order.created_at)}</div>
          <div>배송희망: ${escapeHtml(order.delivery_date || '')} ${escapeHtml(order.delivery_time || '')}${isCancelled ? '' : ` <span class="${dDayClass}">(${dDayText})</span>`}</div>
          <div>배송주소: ${deliveryAddressEsc}</div>
          <div>주문자: ${escapeHtml(order.depositor || '—')} / ${escapeHtml(order.contact || '—')}</div>
          <div>이메일: ${escapeHtml(order.user_email || '—')}</div>
          <div>총액: ${formatAdminPrice(order.total_amount)}</div>
        </div>
        <div class="admin-payment-link-row">
          <input 
            type="text" 
            class="admin-payment-link-input ${isUrgent ? 'urgent' : ''}" 
            value="${paymentLinkEsc}" 
            data-order-id="${orderIdEsc}"
            placeholder="결제 생성 코드 입력"
            ${paymentLinkRowDisabled ? 'readonly disabled' : ''}
          >
          <button 
            type="button" 
            class="admin-btn admin-btn-primary admin-payment-link-btn" 
            data-save-link="${orderIdEsc}"
            ${paymentLinkRowDisabled ? 'disabled' : ''}
          >저장</button>
        </div>
        <div class="admin-payment-link-row">
          <input 
            type="text" 
            class="admin-payment-link-input admin-shipping-input" 
            value="${shippingValueEsc}" 
            data-order-id="${orderIdEsc}"
            data-shipping-input="${orderIdEsc}"
            placeholder="배송 번호 입력"
            ${shippingRowDisabled ? 'readonly disabled' : ''}
          >
          <button 
            type="button" 
            class="admin-btn admin-btn-primary admin-payment-link-btn" 
            data-save-shipping="${orderIdEsc}"
            ${shippingRowDisabled ? 'disabled' : ''}
          >저장</button>
        </div>
        <div class="admin-payment-link-row">
          <input 
            type="text" 
            class="admin-payment-link-input admin-delivery-input" 
            value="${deliveryInputValueEsc}" 
            data-order-id="${orderIdEsc}"
            data-delivery-input="${orderIdEsc}"
            placeholder="배송 완료 코드 입력"
            ${deliveryRowDisabled ? 'readonly disabled' : ''}
          >
          <button 
            type="button" 
            class="admin-btn admin-btn-primary admin-payment-link-btn" 
            data-save-delivery="${orderIdEsc}"
            ${deliveryRowDisabled ? 'disabled' : ''}
          >저장</button>
        </div>
        <div class="admin-payment-order-delete-row">
          ${order.status !== 'cancelled' && (order.status === 'submitted' || order.status === 'order_accepted' || order.status === 'payment_link_issued') ? `<button type="button" class="admin-payment-cancel-btn" data-cancel-order="${orderIdEsc}">취소</button>` : ''}
          <button type="button" class="admin-payment-delete-btn" data-delete-order="${orderIdEsc}">삭제</button>
        </div>
      </div>
    `;
  }).join('');

  const showLoadMore = adminPaymentSubFilter === 'all' && adminPaymentOrders.length < adminPaymentTotal;
  const loadMoreHtml = showLoadMore
    ? `<div class="admin-payment-load-more-wrap"><button type="button" class="admin-btn admin-payment-load-more-btn" data-payment-load-more>더 보기</button></div>`
    : '';
  content.innerHTML = sortBar + ordersHtml + loadMoreHtml;

  adminPaymentFlashIntervals.forEach(id => clearInterval(id));
  adminPaymentFlashIntervals = [];
  content.querySelectorAll('[data-overdue-flash]').forEach(el => {
    const id = setInterval(() => {
      el.classList.toggle('admin-overdue-show-msg');
    }, 1500);
    adminPaymentFlashIntervals.push(id);
  });

  content.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      if (adminPaymentSortBy === key) {
        adminPaymentSortDir[key] = adminPaymentSortDir[key] === 'asc' ? 'desc' : 'asc';
      } else {
        adminPaymentSortBy = key;
      }
      renderPaymentList();
    });
  });

  content.querySelectorAll('[data-subfilter]').forEach(el => {
    const handler = () => {
      adminPaymentSubFilter = el.dataset.subfilter;
      renderPaymentList();
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
      const orderId = el.dataset.orderDetail;
      const order = adminPaymentOrders.find(o => o.id === orderId);
      if (order) openAdminOrderDetail(order);
    });
  });

  content.querySelector('[data-payment-load-more]')?.addEventListener('click', () => loadMorePaymentOrders());

  content.querySelectorAll('[data-save-link]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.saveLink;
      const input = content.querySelector(`.admin-payment-link-input[data-order-id="${orderId}"]`);
      const paymentLink = input?.value?.trim() || '';

      const approvedPhrase = paymentLink && (orderId === paymentLink || `주문 #${orderId}` === paymentLink);
      if (!approvedPhrase) {
        alert('결제 진행 승인 코드 오류');
        if (input) input.value = '';
        return;
      }

      btn.disabled = true;
      btn.textContent = '저장 중...';

      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/admin/payment-link`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ orderId, paymentLink }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || '저장에 실패했습니다.');
        }

        const order = adminPaymentOrders.find(o => o.id === orderId);
        if (order) {
          order.payment_link = paymentLink;
          if (!paymentLink.trim() && order.status === 'payment_link_issued') {
            order.status = 'order_accepted';
          } else if (paymentLink.trim() && (order.status === 'submitted' || order.status === 'order_accepted')) {
            order.status = 'payment_link_issued';
          }
        }
        alert('저장되었습니다.');
        renderPaymentList();
      } catch (e) {
        alert(e.message || '저장에 실패했습니다.');
      } finally {
        btn.disabled = false;
        btn.textContent = '저장';
      }
    });
  });

  content.querySelectorAll('[data-save-shipping]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.saveShipping;
      const input = content.querySelector(`.admin-shipping-input[data-order-id="${orderId}"]`);
      const raw = (input?.value || '').trim();
      const trackingNumber = raw.replace(/\D/g, '');

      const isKoreanPhone = /^0\d{8,10}$/.test(trackingNumber);
      if (!isKoreanPhone) {
        alert('대한민국 휴대폰 또는 전화번호만 입력 가능합니다. (9~11자리 숫자, 0으로 시작)');
        return;
      }

      btn.disabled = true;
      btn.textContent = '저장 중...';

      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/admin/shipping-number`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ orderId, trackingNumber }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || '저장에 실패했습니다.');
        }

        const order = adminPaymentOrders.find(o => o.id === orderId);
        if (order) {
          order.status = 'shipping';
          order.tracking_number = trackingNumber;
        }
        alert('저장되었습니다.');
        renderPaymentList();
      } catch (e) {
        alert(e.message || '저장에 실패했습니다.');
      } finally {
        btn.disabled = false;
        btn.textContent = '저장';
      }
    });
  });

  content.querySelectorAll('[data-save-delivery]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.saveDelivery;
      const input = content.querySelector(`.admin-delivery-input[data-order-id="${orderId}"]`);
      const code = input?.value?.trim() || '';

      const valid = code === orderId || code === `주문 #${orderId}`;
      if (!valid) {
        alert('배송 완료 승인 코드 오류');
        if (input) input.value = '';
        return;
      }

      btn.disabled = true;
      btn.textContent = '저장 중...';

      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/admin/delivery-complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ orderId, code }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || '저장에 실패했습니다.');
        }

        const order = adminPaymentOrders.find(o => o.id === orderId);
        if (order) order.status = 'delivery_completed';
        alert('저장되었습니다.');
        renderPaymentList();
      } catch (e) {
        alert(e.message || '저장에 실패했습니다.');
      } finally {
        btn.disabled = false;
        btn.textContent = '저장';
      }
    });
  });

  content.querySelectorAll('[data-cancel-order]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.cancelOrder;
      const code = prompt('주문 손님도 알고 계신거죠?\n취소 코드를 입력해주세요.');
      if (code === null) return;
      const trimmed = String(code).trim();
      if (trimmed !== orderId && trimmed !== `주문 #${orderId}`) {
        alert('취소 코드 오류입니다.');
        return;
      }
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch(`${API_BASE}/api/admin/cancel-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ orderId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || '취소에 실패했습니다.');
          return;
        }
        const order = adminPaymentOrders.find((o) => o.id === orderId);
        if (order) order.status = 'cancelled';
        alert('주문이 취소되었습니다.');
        renderPaymentList();
      } catch (err) {
        alert(err.message || '취소에 실패했습니다.');
      }
    });
  });

  content.querySelectorAll('[data-delete-order]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.deleteOrder;
      const code = prompt('주문 내역이 완전히 삭제됩니다.\n삭제 코드를 입력해주세요.');
      if (code === null) return;
      const trimmed = String(code).trim();
      if (trimmed !== orderId && trimmed !== `주문 #${orderId}`) {
        alert('삭제 코드 오류입니다.');
        return;
      }
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch(`${API_BASE}/api/admin/delete-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ orderId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || '삭제에 실패했습니다.');
          return;
        }
        adminPaymentOrders = adminPaymentOrders.filter((o) => o.id !== orderId);
        renderPaymentList();
      } catch (err) {
        alert(err.message || '삭제에 실패했습니다.');
      }
    });
  });
}

const PAYMENT_PAGE_SIZE = 25;

async function loadPaymentManagement() {
  const content = document.getElementById('adminPaymentContent');
  content.innerHTML = '<div class="admin-loading">로딩 중...</div>';

  try {
    const token = getToken();
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/orders?limit=${PAYMENT_PAGE_SIZE}&offset=0`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '주문 목록을 불러올 수 없습니다.');
    }

    const { orders, total } = await res.json();
    adminPaymentOrders = orders || [];
    adminPaymentTotal = typeof total === 'number' ? total : adminPaymentOrders.length;

    try {
      const storesRes = await fetchWithTimeout(`${API_BASE}/api/admin/stores`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (storesRes.ok) {
        const { stores } = await storesRes.json();
        adminStoresMap = {};
        adminStoreOrder = [];
        (stores || []).forEach(s => {
          const slug = s.slug || s.id;
          adminStoresMap[slug] = s.title || slug;
          adminStoreOrder.push(slug);
        });
      }
    } catch (_) {}

    if (adminPaymentOrders.length === 0 && adminPaymentTotal === 0) {
      content.innerHTML = '<div class="admin-loading">주문 내역이 없습니다</div>';
      return;
    }

    renderPaymentList();
  } catch (e) {
    content.innerHTML = `<div class="admin-loading admin-error"><p>${escapeHtml(e.message || '오류가 발생했습니다.')}</p></div>`;
  }
}

async function loadMorePaymentOrders() {
  const btn = document.querySelector('[data-payment-load-more]');
  if (btn) btn.disabled = true;
  try {
    const token = getToken();
    const offset = adminPaymentOrders.length;
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/orders?limit=${PAYMENT_PAGE_SIZE}&offset=${offset}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;
    const { orders } = await res.json();
    if (Array.isArray(orders) && orders.length) {
      adminPaymentOrders = adminPaymentOrders.concat(orders);
      renderPaymentList();
    }
  } catch (_) {}
  if (btn) btn.disabled = false;
}

async function refetchPaymentOrdersAndRender() {
  const content = document.getElementById('adminPaymentContent');
  try {
    const token = getToken();
    const currentLen = adminPaymentOrders.length;
    const limit = Math.max(PAYMENT_PAGE_SIZE, currentLen);
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/orders?limit=${limit}&offset=0`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;
    const { orders, total } = await res.json();
    adminPaymentOrders = orders || [];
    adminPaymentTotal = typeof total === 'number' ? total : adminPaymentOrders.length;
    if (adminPaymentOrders.length === 0 && adminPaymentTotal === 0) {
      content.innerHTML = '<div class="admin-loading">주문 내역이 없습니다</div>';
      return;
    }
    renderPaymentList();
  } catch (_) {}
}

function resetPaymentIdleTimer() {
  if (paymentIdleTimerId != null) clearTimeout(paymentIdleTimerId);
  paymentIdleTimerId = setTimeout(() => {
    refetchPaymentOrdersAndRender().then(() => resetPaymentIdleTimer());
  }, PAYMENT_IDLE_MS);
}

function startPaymentIdleRefresh() {
  if (paymentIdleTimerId != null) clearTimeout(paymentIdleTimerId);
  paymentIdleTimerId = setTimeout(() => {
    refetchPaymentOrdersAndRender().then(() => resetPaymentIdleTimer());
  }, PAYMENT_IDLE_MS);
  if (!paymentIdleListenersAttached) {
    paymentIdleListenersAttached = true;
    document.addEventListener('click', resetPaymentIdleTimer);
    document.addEventListener('keydown', resetPaymentIdleTimer);
    document.addEventListener('input', resetPaymentIdleTimer);
  }
}

function clearPaymentIdleTimer() {
  if (paymentIdleTimerId != null) {
    clearTimeout(paymentIdleTimerId);
    paymentIdleTimerId = null;
  }
  if (paymentIdleListenersAttached) {
    paymentIdleListenersAttached = false;
    document.removeEventListener('click', resetPaymentIdleTimer);
    document.removeEventListener('keydown', resetPaymentIdleTimer);
    document.removeEventListener('input', resetPaymentIdleTimer);
  }
}

function getStatsDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function getThisWeekMonday(d) {
  const x = new Date(d.getTime());
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

async function loadStats() {
  const content = document.getElementById('adminStatsContent');
  if (!content) return;
  const startInput = document.getElementById('adminStatsStartDate');
  const endInput = document.getElementById('adminStatsEndDate');
  let startDate = startInput?.value?.trim() || '';
  let endDate = endInput?.value?.trim() || '';
  const defaultRange = getDefaultStatsRange();
  if (!startDate) startDate = defaultRange.start;
  if (!endDate) endDate = defaultRange.end;

  content.innerHTML = '<div class="admin-loading">로딩 중...</div>';
  try {
    const token = getToken();
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/stats?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      content.innerHTML = `<div class="admin-stats-error">${escapeHtml(err.error || '통계를 불러올 수 없습니다.')}</div>`;
      return;
    }
    const data = await res.json();
    adminStatsLastData = data;
    renderStats(content, data);
  } catch (e) {
    content.innerHTML = `<div class="admin-stats-error">${escapeHtml(e.message || '통계를 불러올 수 없습니다.')}</div>`;
  }
}

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

function renderSettlementTable(byBrand) {
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

let settlementClockIntervalId = null;

/** 정산서 출력용 기본 기간 (최근 7일) */
function getStatementDefaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { start: toDateKey(start), end: toDateKey(end) };
}

function renderSettlementStatementContent(data) {
  if (!data || !data.days) return '';
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  const brandName = escapeHtml(data.brandTitle || data.slug || '');
  const periodText = (data.startDate || '') + ' ~ ' + (data.endDate || '');
  const contactEmail = escapeHtml(data.storeContactEmail || '');
  const repName = escapeHtml(data.representative || '');
  const issueDate = toDateKey(new Date());

  let html = '<div class="admin-settlement-statement-print">';
  html += '<div class="admin-settlement-statement-print-inner">';
  html += '<div class="admin-settlement-statement-header">';
  html += '<p class="admin-settlement-statement-logo">BzCat</p>';
  html += '<p class="admin-settlement-statement-title">정산서</p>';
  html += '<p class="admin-settlement-statement-period">' + escapeHtml(periodText) + '</p>';
  html += '<hr class="admin-settlement-statement-hr">';
  html += '</div>';

  html += '<div class="admin-settlement-statement-brand">';
  html += '<br><p><strong>브랜드 정보</strong></p><br>';
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
  html += '</div>';

  html += '<div class="admin-settlement-statement-footer">';
  html += '<p>* 수수료는 판매금액의 15%이며, 정산금액 = 판매금액 − 수수료입니다.</p>';
  html += '<p>* 정산서 확인 후, 본사의 지정된 이메일 주소로 전자세금계산서 발행 부탁드립니다.</p>';
  html += '<p>* 정산금액은 귀사의 지정된 입금 계좌로 현금 지급됩니다.</p>';
  html += '</div>';
  html += '<br><br>';
  html += '<div class="admin-settlement-statement-issuer">';
  html += '<p>정산서 발행일: ' + escapeHtml(issueDate) + '</p>';
  html += '<p>정산서 발행처: (주)코코로키친</p>';
  html += '</div>';
  html += '</div></div>';
  return html;
}

async function runSettlementStatementSearch() {
  const startEl = document.getElementById('adminSettlementStatementStart');
  const endEl = document.getElementById('adminSettlementStatementEnd');
  const slugEl = document.getElementById('adminSettlementBrandSelect');
  const resultBox = document.getElementById('adminSettlementStatementResult');
  if (!startEl || !endEl || !slugEl || !resultBox) return;
  const startDate = (startEl.value || '').trim();
  const endDate = (endEl.value || '').trim();
  const slug = (slugEl.value || '').trim().toLowerCase();
  if (!slug) {
    resultBox.innerHTML = '<p class="admin-stats-error">브랜드를 선택해 주세요.</p>';
    return;
  }
  if (!startDate || !endDate) {
    resultBox.innerHTML = '<p class="admin-stats-error">시작일·종료일을 입력해 주세요.</p>';
    return;
  }
  if (startDate > endDate) {
    resultBox.innerHTML = '<p class="admin-stats-error">시작일이 종료일보다 늦을 수 없습니다.</p>';
    return;
  }
  resultBox.innerHTML = '<div class="admin-loading">로딩 중...</div>';
  if (SETTLEMENT_MOCK_FOR_TEST) {
    const days = [];
    const d = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    const row = { orderCount: 1, totalAmount: 500000, fee: 75000, settlement: 425000 };
    for (; d <= end; d.setDate(d.getDate() + 1)) {
      const dateKey = toDateKey(new Date(d));
      days.push({ date: dateKey, ...row });
    }
    const n = days.length;
    const mockStatementData = {
      brandTitle: '오늘Brand1',
      slug: 'todaybrand1',
      storeContactEmail: 'contact@todaybrand1.com',
      representative: '대표자명',
      startDate,
      endDate,
      days,
      totalOrderCount: n,
      totalSales: 500000 * n,
      totalFee: 75000 * n,
      totalSettlement: 425000 * n,
    };
    resultBox.innerHTML = renderSettlementStatementContent(mockStatementData);
    return;
  }
  try {
    const token = getToken();
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/settlement-statement?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&slug=${encodeURIComponent(slug)}`, { headers: { Authorization: `Bearer ${token}` } });
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

function printSettlementStatement() {
  const wrap = document.getElementById('adminSettlementStatementResult');
  const printEl = wrap?.querySelector('.admin-settlement-statement-print');
  if (!printEl || !printEl.innerHTML.trim()) {
    alert('먼저 검색하여 정산서 내용을 불러온 뒤 PDF 출력해 주세요.');
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

async function loadSettlement() {
  const container = document.getElementById('adminSettlementContent');
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
  const stRange = getStatementDefaultRange();

  const statementBlock =
    '<div class="admin-settlement-statement-area">' +
    '<h3 class="admin-settlement-statement-heading">정산서 출력</h3>' +
    '<div class="admin-stats-daterange" style="margin-bottom:12px;">' +
    '<input type="date" id="adminSettlementStatementStart" value="' + escapeHtml(stRange.start) + '">' +
    '<span>~</span>' +
    '<input type="date" id="adminSettlementStatementEnd" value="' + escapeHtml(stRange.end) + '">' +
    '</div>' +
    '<div class="admin-stats-daterange" style="margin-bottom:16px;">' +
    '<select id="adminSettlementBrandSelect" class="admin-settlement-brand-select"><option value="">브랜드 선택</option></select>' +
    '<button type="button" class="admin-stats-search-btn" id="adminSettlementStatementSearch" title="검색" aria-label="검색"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button>' +
    '</div>' +
    '<div id="adminSettlementStatementResult" class="admin-settlement-statement-result"></div>' +
    '<div style="margin-top:16px;"><button type="button" class="admin-btn admin-settlement-pdf-btn" id="adminSettlementPdfBtn">PDF 출력하기</button></div>' +
    '</div>';

  container.innerHTML =
    '<div class="admin-settlement-clock" id="adminSettlementClock">' + escapeHtml(formatSettlementClock()) + '</div>' +
    '<section class="admin-stats-section"><h3>오늘 정산 내역</h3><p class="admin-settlement-caption">배송완료일 ' + escapeHtml(dateToday) + ' 기준</p><div id="adminSettlementToday"></div></section>' +
    '<section class="admin-stats-section"><h3>내일 정산 예정</h3><p class="admin-settlement-caption">배송완료일 ' + escapeHtml(dateTomorrow) + ' 기준</p><div id="adminSettlementTomorrow"></div></section>' +
    statementBlock;

  const clockEl = document.getElementById('adminSettlementClock');
  if (settlementClockIntervalId) clearInterval(settlementClockIntervalId);
  settlementClockIntervalId = setInterval(() => {
    if (clockEl) clockEl.textContent = formatSettlementClock();
  }, 1000);

  const token = getToken();
  const todayBox = document.getElementById('adminSettlementToday');
  const tomorrowBox = document.getElementById('adminSettlementTomorrow');
  if (todayBox) todayBox.innerHTML = '<div class="admin-loading">로딩 중...</div>';
  if (tomorrowBox) tomorrowBox.innerHTML = '<div class="admin-loading">로딩 중...</div>';

  document.getElementById('adminSettlementStatementSearch')?.addEventListener('click', runSettlementStatementSearch);
  document.getElementById('adminSettlementPdfBtn')?.addEventListener('click', printSettlementStatement);

  if (SETTLEMENT_MOCK_FOR_TEST) {
    const mockToday = { byBrand: [{ brandTitle: '오늘Brand1', orderCount: 1, totalAmount: 500000 }, { brandTitle: '오늘Brand2', orderCount: 1, totalAmount: 1000000 }] };
    const mockTomorrow = { byBrand: [{ brandTitle: '내일Brand1', orderCount: 1, totalAmount: 500000 }, { brandTitle: '내일Brand2', orderCount: 1, totalAmount: 1000000 }] };
    if (todayBox) todayBox.innerHTML = renderSettlementTable(mockToday.byBrand);
    if (tomorrowBox) tomorrowBox.innerHTML = renderSettlementTable(mockTomorrow.byBrand);
  }

  try {
    const promises = SETTLEMENT_MOCK_FOR_TEST
      ? [fetchStores()]
      : [
          fetchWithTimeout(`${API_BASE}/api/admin/settlement?date=${encodeURIComponent(dateToday)}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetchWithTimeout(`${API_BASE}/api/admin/settlement?date=${encodeURIComponent(dateTomorrow)}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetchStores(),
        ];
    const results = await Promise.all(promises);
    const storesData = SETTLEMENT_MOCK_FOR_TEST ? results[0] : results[2];
    if (!SETTLEMENT_MOCK_FOR_TEST) {
      const dataToday = results[0].ok ? await results[0].json() : { byBrand: [] };
      const dataTomorrow = results[1].ok ? await results[1].json() : { byBrand: [] };
      if (todayBox) todayBox.innerHTML = renderSettlementTable(dataToday.byBrand || []);
      if (tomorrowBox) tomorrowBox.innerHTML = renderSettlementTable(dataTomorrow.byBrand || []);
    }

    const stores = (storesData && storesData.stores) || [];
    const sorted = stores.slice().sort((a, b) => (a.brand || a.title || a.id || '').toString().localeCompare((b.brand || b.title || b.id || '').toString(), 'ko'));
    const selectEl = document.getElementById('adminSettlementBrandSelect');
    if (selectEl) {
      sorted.forEach((s) => {
        const sid = (s.slug || s.id || '').toString().toLowerCase();
        const label = (s.brand || s.title || s.id || sid).toString().trim() || sid;
        if (sid) selectEl.appendChild(new Option(label, sid));
      });
    }
  } catch (e) {
    if (todayBox) todayBox.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '오늘 정산을 불러올 수 없습니다.') + '</p>';
    if (tomorrowBox) tomorrowBox.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '내일 정산 예정을 불러올 수 없습니다.') + '</p>';
  }
}

function renderStats(container, data) {
  const orderSummary = data.orderSummary || {};
  const revenue = data.revenue || {};
  const conversion = data.conversion || {};
  const delivery = data.delivery || {};
  const topMenus = data.topMenus || [];
  const timeSeries = data.timeSeries || [];
  const crm = data.crm || {};
  const alerts = data.alerts || {};
  const dateRange = data.dateRange || {};
  const defaultRange = getDefaultStatsRange();
  const startVal = dateRange.startDate || defaultRange.start;
  const endVal = dateRange.endDate || defaultRange.end;
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  let html = '<div class="admin-stats-toolbar"><div class="admin-stats-daterange"><input type="date" id="adminStatsStartDate" value="' + escapeHtml(startVal) + '"><span>~</span><input type="date" id="adminStatsEndDate" value="' + escapeHtml(endVal) + '"><button type="button" class="admin-stats-search-btn" id="adminStatsApplyBtn" title="조회" aria-label="조회"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button></div>';
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
  const menuFilterLimit = adminStatsMenuFilter === 'top10' ? 10 : (topMenus.length || 20);
  const menuList = topMenus.slice(0, menuFilterLimit);
  const menuFilterLabel = adminStatsMenuFilter === 'top10' ? 'top10' : 'all';
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
  document.getElementById('adminStatsApplyBtn')?.addEventListener('click', loadStats);
  container.querySelectorAll('.admin-stats-preset-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const preset = btn.getAttribute('data-preset');
      const range = getPresetStatsRange(preset);
      if (!range) return;
      const startEl = document.getElementById('adminStatsStartDate');
      const endEl = document.getElementById('adminStatsEndDate');
      if (startEl) startEl.value = range.start;
      if (endEl) endEl.value = range.end;
      loadStats();
    });
  });
  container.querySelectorAll('[data-menu-filter-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      adminStatsMenuFilter = adminStatsMenuFilter === 'top10' ? 'all' : 'top10';
      if (adminStatsLastData) renderStats(container, adminStatsLastData);
    });
  });
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
  return `${y}.${m}.${day} ${h}:${min}`;
}

function formatAdminPrice(price) {
  return Number(price || 0).toLocaleString() + '원';
}

function renderAdminOrderDetailHtml(order) {
  const orderItems = order.order_items || [];
  const byCategory = {};
  for (const oi of orderItems) {
    const itemId = oi.id || '';
    const slug = (itemId.split('-')[0] || 'default');
    const item = { name: oi.name || '', price: Number(oi.price) || 0 };
    const qty = Number(oi.quantity) || 0;
    if (qty <= 0) continue;
    if (!byCategory[slug]) byCategory[slug] = [];
    byCategory[slug].push({ item, qty });
  }
  const categoryOrder = adminStoreOrder.length ? adminStoreOrder : Object.keys(byCategory).sort();
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
      const title = adminStoresMap[slug] || slug;
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

function openAdminOrderDetail(order) {
  const content = document.getElementById('adminOrderDetailContent');
  const totalEl = document.getElementById('adminOrderDetailTotal');
  const pdfBtn = document.getElementById('adminOrderDetailPdfBtn');
  const overlay = document.getElementById('adminOrderDetailOverlay');
  const panel = overlay?.querySelector('.admin-order-detail-panel');
  if (!content || !overlay) return;
  const html = renderAdminOrderDetailHtml(order);
  content.innerHTML = `<div class="order-detail-list order-detail-cart-style">${html}</div>`;
  if (totalEl) totalEl.textContent = formatAdminPrice(order.total_amount || 0);
  if (panel) panel.classList.toggle('admin-order-detail-cancelled', order.status === 'cancelled');
  if (pdfBtn) {
    pdfBtn.href = '#';
    pdfBtn.style.display = '';
    pdfBtn.textContent = order.status === 'cancelled' ? '주문서 확인 (취소 건)' : '주문서 확인';
    const orderIdForPdf = order.id;
    pdfBtn.onclick = async (e) => {
      e.preventDefault();
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE}/api/orders/pdf?orderId=${encodeURIComponent(orderIdForPdf)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (_) {}
    };
  }
  overlay.classList.add('visible');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeAdminOrderDetail() {
  const overlay = document.getElementById('adminOrderDetailOverlay');
  if (overlay) {
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

async function init() {
  const authResult = await checkAdmin();
  if (!authResult.ok) {
    showLoadingError(authResult.error || '접근할 수 없습니다.');
    return;
  }
  
  setupTabs();
  loadPaymentManagement();

  document.getElementById('adminOrderDetailClose')?.addEventListener('click', closeAdminOrderDetail);
  document.getElementById('adminOrderDetailOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'adminOrderDetailOverlay') closeAdminOrderDetail();
  });

  function closeApiSettingsModal() {
    const modal = document.getElementById('adminApiSettingsModal');
    if (modal) {
      modal.classList.remove('admin-modal-visible');
      modal.setAttribute('aria-hidden', 'true');
    }
  }
  function applyApiSettingsModal() {
    const modal = document.getElementById('adminApiSettingsModal');
    const modalInput = document.getElementById('adminApiSettingsEnvVar');
    const businessDaysContainer = document.getElementById('adminApiSettingsBusinessDays');
    const businessHoursContainer = document.getElementById('adminApiSettingsBusinessHours');
    const storeId = modal?.dataset?.currentStoreId;
    if (!storeId) return;
    const storeEl = Array.from(document.querySelectorAll('.admin-store')).find((el) => el.dataset.storeId === storeId);
    const apiKeyInput = storeEl?.querySelector('input[data-field="apiKeyEnvVar"]');
    const businessDaysInput = storeEl?.querySelector('input[data-field="businessDays"]');
    const businessHoursInput = storeEl?.querySelector('input[data-field="businessHours"]');
    if (apiKeyInput) apiKeyInput.value = (modalInput?.value || '').trim() || 'TOSS_SECRET_KEY';
    if (businessDaysContainer && businessDaysInput) {
      const checked = Array.from(businessDaysContainer.querySelectorAll('input[data-day]:checked'))
        .map((cb) => parseInt(cb.dataset.day, 10))
        .sort((a, b) => a - b);
      businessDaysInput.value = checked.length ? checked.join(',') : '0,1,2,3,4,5,6';
    }
    if (businessHoursContainer && businessHoursInput) {
      const checked = Array.from(businessHoursContainer.querySelectorAll('input[data-slot]:checked'))
        .map((cb) => cb.dataset.slot)
        .filter(Boolean);
      businessHoursInput.value = checked.length ? checked.join(',') : BUSINESS_HOURS_SLOTS.join(',');
    }
    closeApiSettingsModal();
  }
  document.getElementById('adminApiSettingsModalClose')?.addEventListener('click', closeApiSettingsModal);
  document.getElementById('adminApiSettingsCancel')?.addEventListener('click', closeApiSettingsModal);
  document.getElementById('adminApiSettingsApply')?.addEventListener('click', applyApiSettingsModal);
  document.getElementById('adminApiSettingsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'adminApiSettingsModal') closeApiSettingsModal();
    if (e.target.closest('[data-settings-tab]')) {
      const tab = e.target.closest('[data-settings-tab]');
      const modal = tab.closest('#adminApiSettingsModal');
      if (!modal) return;
      const tabId = tab.dataset.settingsTab;
      modal.querySelectorAll('.admin-modal-tab').forEach((t) => t.classList.toggle('active', t.dataset.settingsTab === tabId));
      const panelMap = { 'payment-env': 'adminSettingsPanelPaymentEnv', 'business-days': 'adminSettingsPanelBusinessDays', 'business-hours': 'adminSettingsPanelBusinessHours' };
      const panelId = panelMap[tabId];
      modal.querySelectorAll('.admin-modal-panel').forEach((p) => p.classList.remove('active'));
      if (panelId) document.getElementById(panelId)?.classList.add('active');
    }
  });

  try {
    const { stores, menus } = await fetchStores();
    const content = document.getElementById('adminContent');
    const indexHtml = stores.length > 1
      ? `<div class="admin-index">
          <span class="admin-index-label">바로가기</span>
          <div class="admin-index-btns">
            ${stores.map((s) => `<button type="button" class="admin-btn admin-btn-index" data-goto-store="${escapeHtml(s.id || '')}">${escapeHtml(s.title || s.id || '')}</button>`).join('')}
          </div>
        </div>`
      : '';
    content.innerHTML = `
      ${indexHtml}
      <div class="admin-stores-list" id="adminStoresList">
        ${stores.map((s) => renderStore(s, menus[s.id] || [])).join('')}
      </div>
      <div class="admin-add-store-row">
        <button type="button" class="admin-btn admin-btn-secondary admin-btn-add-store" data-add-store>+ 카테고리 추가</button>
        <button type="button" class="admin-btn admin-btn-reorder-stores" data-reorder-stores aria-label="카테고리 순서 변경" title="카테고리 순서 변경"><span class="admin-reorder-icon" aria-hidden="true">↕</span></button>
      </div>
    `;

    content.addEventListener('click', async (e) => {
      if (e.target.closest('[data-scroll-top]')) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (e.target.closest('[data-store-settings]')) {
        const btn = e.target.closest('[data-store-settings]');
        const storeEl = btn.closest('.admin-store');
        const storeId = storeEl?.dataset?.storeId;
        const apiKeyInput = storeEl?.querySelector('input[data-field="apiKeyEnvVar"]');
        const businessDaysInput = storeEl?.querySelector('input[data-field="businessDays"]');
        const businessHoursInput = storeEl?.querySelector('input[data-field="businessHours"]');
        const modal = document.getElementById('adminApiSettingsModal');
        const modalInput = document.getElementById('adminApiSettingsEnvVar');
        const modalTitle = document.getElementById('adminApiSettingsStoreTitle');
        const businessDaysContainer = document.getElementById('adminApiSettingsBusinessDays');
        const businessHoursContainer = document.getElementById('adminApiSettingsBusinessHours');
        if (storeId && apiKeyInput && modal && modalInput) {
          modal.dataset.currentStoreId = storeId;
          modalTitle.textContent = storeEl.querySelector('.admin-store-title')?.textContent || storeId;
          modalInput.value = apiKeyInput.value || 'TOSS_SECRET_KEY';
          const daysStr = businessDaysInput?.value || '0,1,2,3,4,5,6';
          const days = daysStr.split(',').map((d) => parseInt(d, 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 6);
          businessDaysContainer?.querySelectorAll('input[data-day]').forEach((cb) => {
            cb.checked = days.includes(parseInt(cb.dataset.day, 10));
          });
          const hoursStr = businessHoursInput?.value || BUSINESS_HOURS_SLOTS.join(',');
          const hoursSet = new Set(hoursStr.split(',').map((s) => s.trim()).filter(Boolean));
          businessHoursContainer?.querySelectorAll('input[data-slot]').forEach((cb) => {
            cb.checked = hoursSet.has(cb.dataset.slot);
          });
          modal.querySelectorAll('.admin-modal-tab').forEach((t) => t.classList.remove('active'));
          modal.querySelector('[data-settings-tab="payment-env"]')?.classList.add('active');
          modal.querySelectorAll('.admin-modal-panel').forEach((p) => p.classList.remove('active'));
          document.getElementById('adminSettingsPanelPaymentEnv')?.classList.add('active');
          modal.classList.add('admin-modal-visible');
          modal.setAttribute('aria-hidden', 'false');
        }
      }
      if (e.target.closest('[data-goto-store]')) {
        const storeId = e.target.closest('[data-goto-store]').dataset.gotoStore;
        const el = document.getElementById(`admin-store-${storeId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (e.target.closest('[data-reorder-stores]')) {
        openReorderStoresModal();
      }
      if (e.target.closest('[data-add-store]')) {
        const list = document.getElementById('adminStoresList');
        const indexBtns = document.querySelector('.admin-index-btns');
        const newStore = {
          id: generateStoreId(),
          slug: generateStoreId(),
          title: '새 카테고리',
          brand: '',
          storeAddress: '',
          storeContact: '',
          storeContactEmail: '',
          representative: '',
          bizNo: '',
          suburl: '',
          businessDays: [0, 1, 2, 3, 4, 5, 6],
          businessHours: [...BUSINESS_HOURS_SLOTS],
          payment: { apiKeyEnvVar: 'TOSS_SECRET_KEY' },
        };
        const div = document.createElement('div');
        div.innerHTML = renderStore(newStore, []);
        list.appendChild(div.firstElementChild);
        if (indexBtns) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'admin-btn admin-btn-index';
          btn.dataset.gotoStore = newStore.id;
          btn.textContent = newStore.title;
          indexBtns.appendChild(btn);
        }
      }
      if (e.target.closest('[data-delete-store]')) {
        const btn = e.target.closest('[data-delete-store]');
        const storeEl = btn.closest('.admin-store');
        const list = document.getElementById('adminStoresList');
        if (list && list.querySelectorAll('.admin-store').length <= 1) {
          alert('최소 1개 이상의 카테고리가 필요합니다.');
          return;
        }
        const menuCount = storeEl.querySelectorAll('.admin-menu-item').length;
        if (menuCount > 0) {
          alert('메뉴가 1개라도 있으면 카테고리를 삭제할 수 없습니다. 먼저 메뉴를 모두 삭제해 주세요.');
          return;
        }
        if (confirm('이 카테고리를 삭제하시겠습니까?')) {
          const gotoBtn = content.querySelector(`[data-goto-store="${storeEl.dataset.storeId}"]`);
          if (gotoBtn) gotoBtn.remove();
          storeEl.remove();
          try {
            await handleSave();
          } catch (err) {
            showError(err.message);
          }
        }
      }
      if (e.target.closest('[data-upload-btn]')) {
        const btn = e.target.closest('[data-upload-btn]');
        const item = btn.closest('.admin-menu-item');
        const fileInput = item?.querySelector('[data-upload-input]');
        if (fileInput) fileInput.click();
      }
      if (e.target.closest('[data-add-menu]')) {
        const storeId = e.target.closest('[data-add-menu]').dataset.addMenu;
        const list = content.querySelector(`.admin-menu-list[data-store-id="${storeId}"]`);
        const newItem = { id: generateId(storeId), name: '', price: 0, description: '', imageUrl: '' };
        const div = document.createElement('div');
        div.innerHTML = renderMenuItem(storeId, newItem, list.children.length);
        const itemEl = div.firstElementChild;
        itemEl.dataset.menuId = newItem.id;
        list.appendChild(itemEl);
      }
      if (e.target.closest('[data-remove-menu]')) {
        const btn = e.target.closest('[data-remove-menu]');
        const itemEl = btn?.closest('.admin-menu-item');
        const menuId = itemEl?.dataset?.menuId;
        if (menuId) {
          try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/api/admin/check-menu-in-use?menuId=${encodeURIComponent(menuId)}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            if (data.inUse === true) {
              alert('해당 메뉴는 주문 진행중입니다.');
              return;
            }
          } catch (err) {
            alert(err.message || '확인에 실패했습니다.');
            return;
          }
        }
        itemEl?.remove();
      }
      if (e.target.closest('[data-save]')) {
        handleSave();
      }
    });

    content.addEventListener('input', (e) => {
      const input = e.target;
      if (input?.getAttribute('data-field') === 'suburl') {
        const cursor = input.selectionStart;
        const raw = input.value;
        const filtered = raw.toLowerCase().replace(/[^a-z]/g, '');
        if (raw !== filtered) {
          input.value = filtered;
          input.setSelectionRange(Math.min(cursor, filtered.length), Math.min(cursor, filtered.length));
        }
      }
    });

    content.addEventListener('change', async (e) => {
      const input = e.target.closest('[data-upload-input]');
      if (!input || !input.files?.length) return;
      const file = input.files[0];
      const item = input.closest('.admin-menu-item');
      const urlInput = item?.querySelector('input[data-field="imageUrl"]');
      const thumb = item?.querySelector('.admin-menu-thumb');
      const btn = item?.querySelector('[data-upload-btn]');
      if (!urlInput) return;
      const origText = btn?.textContent;
      if (btn) btn.disabled = true;
      if (btn) btn.textContent = '업로드 중...';
      try {
        const url = await uploadImage(file);
        urlInput.value = url;
        if (thumb) {
          const safeUrl = safeImageUrl(url);
          thumb.innerHTML = safeUrl ? `<img src="${escapeHtml(safeUrl)}" alt="" onerror="this.parentElement.innerHTML='<span class=\\'placeholder\\'>📷</span>'">` : '<span class="placeholder">📷</span>';
        }
      } catch (err) {
        alert(err.message);
      } finally {
        input.value = '';
        if (btn) { btn.disabled = false; btn.textContent = origText || '📤 업로드'; }
      }
    });
  } catch (err) {
    showLoadingError(err.message || '로딩에 실패했습니다.', true);
    document.getElementById('adminError').style.display = 'none';
  }
}

function openReorderStoresModal() {
  const list = document.getElementById('adminStoresList');
  if (!list) return;
  const storeEls = list.querySelectorAll('.admin-store');
  const items = [...storeEls].map((el) => ({
    id: el.dataset.storeId,
    title: (el.querySelector('.admin-store-title')?.textContent?.trim()) || (el.querySelector('input[data-field="title"]')?.value?.trim()) || el.dataset.storeId || '',
  }));
  const listContainer = document.getElementById('adminReorderStoresList');
  if (!listContainer) return;
  listContainer.innerHTML = items
    .map(
      (item) =>
        `<li data-store-id="${escapeHtml(item.id)}" class="admin-reorder-modal-item">
          <span class="admin-reorder-modal-title">${escapeHtml(item.title)}</span>
          <div class="admin-reorder-modal-move">
            <button type="button" data-move-up aria-label="위로">↑</button>
            <button type="button" data-move-down aria-label="아래로">↓</button>
          </div>
        </li>`
    )
    .join('');
  const modal = document.getElementById('adminReorderStoresModal');
  if (modal) {
    modal.classList.add('admin-modal-visible');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeReorderStoresModal() {
  const modal = document.getElementById('adminReorderStoresModal');
  if (modal) {
    modal.classList.remove('admin-modal-visible');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function applyReorderAndSave() {
  const listEl = document.getElementById('adminReorderStoresList');
  const storesList = document.getElementById('adminStoresList');
  const indexBtns = document.querySelector('.admin-index-btns');
  if (!listEl || !storesList) return;
  const order = [...listEl.querySelectorAll('li')].map((li) => li.dataset.storeId);
  const storeEls = storesList.querySelectorAll('.admin-store');
  const byId = {};
  storeEls.forEach((el) => {
    byId[el.dataset.storeId] = el;
  });
  order.forEach((id) => {
    if (byId[id]) storesList.appendChild(byId[id]);
  });
  if (indexBtns) {
    const btns = indexBtns.querySelectorAll('[data-goto-store]');
    const btnById = {};
    btns.forEach((b) => {
      btnById[b.dataset.gotoStore] = b;
    });
    order.forEach((id) => {
      if (btnById[id]) indexBtns.appendChild(btnById[id]);
    });
  }
  handleSave();
}

async function handleSave() {
  hideError();
  try {
    const { stores, menus } = collectData();
    for (const store of stores) {
      if (!isValidKoreanMobile(store.storeContact)) {
        alert('정상적인 핸드폰 번호를 입력해주세요.');
        return;
      }
    }
    await saveStores(stores, menus);
    alert('저장되었습니다.');
  } catch (err) {
    showError(err.message);
  }
}

(function bindReorderStoresModal() {
  const modal = document.getElementById('adminReorderStoresModal');
  if (!modal) return;
  modal.querySelector('#adminReorderStoresModalClose')?.addEventListener('click', closeReorderStoresModal);
  modal.querySelector('#adminReorderStoresCancel')?.addEventListener('click', closeReorderStoresModal);
  modal.querySelector('#adminReorderStoresConfirm')?.addEventListener('click', () => {
    applyReorderAndSave();
    closeReorderStoresModal();
  });
  document.getElementById('adminReorderStoresList')?.addEventListener('click', (e) => {
    const up = e.target.closest('[data-move-up]');
    const down = e.target.closest('[data-move-down]');
    if (up) {
      const li = up.closest('li');
      if (li?.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
    } else if (down) {
      const li = down.closest('li');
      if (li?.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
    }
  });
})();

init();
