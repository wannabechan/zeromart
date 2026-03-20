/**
 * B2B 식자재 주문 앱
 * - 카테고리 선택 → 메뉴 담기 → 장바구니 → 계좌송금 안내
 */

// 메뉴 데이터 (API에서 로드, 실패 시 폴백)
const MENU_DATA_FALLBACK = {
  bento: { title: '도시락', items: [{ id: 'bento-1', name: '삼겹살 덮밥', price: 100000, description: '메뉴를 불러오는 중입니다.', imageUrl: '' }], payment: { accountHolder: '(주)케이터링서비스', bankName: '신한은행', accountNumber: '110-123-456789' } },
  side: { title: '반찬', items: [], payment: { accountHolder: '(주)케이터링서비스', bankName: '신한은행', accountNumber: '110-123-456789' } },
  salad: { title: '샐러드', items: [], payment: { accountHolder: '(주)케이터링서비스', bankName: '신한은행', accountNumber: '110-123-456789' } },
  beverage: { title: '음료', items: [], payment: { accountHolder: '(주)케이터링서비스', bankName: '신한은행', accountNumber: '110-123-456789' } },
  dessert: { title: '디저트', items: [], payment: { accountHolder: '(주)케이터링서비스', bankName: '신한은행', accountNumber: '110-123-456789' } },
};

let MENU_DATA = { ...MENU_DATA_FALLBACK };

async function loadMenuData() {
  try {
    const token = window.BzCatAuth?.getToken?.();
    const res = await fetch('/api/menu-data', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const data = await res.json();
      MENU_DATA = data && typeof data === 'object' ? data : {};
      return true;
    }
  } catch (e) {
    console.warn('Menu data load failed:', e);
  }
  return false;
}

/** 로그인 직후 등 앱 표시 시점에 메뉴를 다시 불러와 권한이 있는 매장/메뉴만 보이도록 갱신 */
async function refreshMenuAndRender() {
  const token = window.BzCatAuth?.getToken?.();
  if (!token) return;
  const currentCategory = document.querySelector('.category-tab.active')?.dataset.category || '_all';
  const ok = await loadMenuData();
  if (!ok) return;
  const slugStillExists = currentCategory === '_all' || currentCategory === '_recent' || Object.prototype.hasOwnProperty.call(MENU_DATA, currentCategory);
  renderCategoryTabs(slugStillExists ? currentCategory : undefined);
  if (document.querySelector('.category-tab.active')?.dataset.category === '_recent') {
    await fetchRecentOrderItems();
  }
  renderMenuCards();
  renderCartItems();
  updateCartCount();
}

// 장바구니 상태: { [itemId]: quantity }
let cart = {};
/** 최근주문 탭용: 모든 주문의 상품 최대 20개 (최근 순) */
let recentOrderItemsCache = null;
// 메뉴 카드에 설정한 담을 수량 (담기 버튼으로 이만큼 담음)
let pendingQty = {};

// DOM 요소
const categoryTabsRow = document.getElementById('categoryTabsRow');
const categoryTabs = document.getElementById('categoryTabs');
const searchBarRow = document.getElementById('searchBarRow');
const searchToggle = document.getElementById('searchToggle');
const searchClose = document.getElementById('searchClose');
const searchInput = document.getElementById('searchInput');
const menuSectionTitle = document.getElementById('menuSectionTitle');
const menuGrid = document.getElementById('menuGrid');
const cartToggle = document.getElementById('cartToggle');
const cartCount = document.getElementById('cartCount');
const cartOverlay = document.getElementById('cartOverlay');
const cartDrawer = document.getElementById('cartDrawer');
const cartClose = document.getElementById('cartClose');
const cartEmpty = document.getElementById('cartEmpty');
const cartItems = document.getElementById('cartItems');
const cartFooter = document.getElementById('cartFooter');
const cartTotal = document.getElementById('cartTotal');
const btnCheckout = document.getElementById('btnCheckout');
const checkoutModal = document.getElementById('checkoutModal');
const checkoutClose = document.getElementById('checkoutClose');
const checkoutAmount = document.getElementById('checkoutAmount');
const checkoutOrderTime = document.getElementById('checkoutOrderTime');
const inputDepositor = document.getElementById('inputDepositor');
const inputContact = document.getElementById('inputContact');
const checkoutForm = document.getElementById('checkoutForm');
const inputDeliveryAddress = document.getElementById('inputDeliveryAddress');
const detailAddressRow = document.getElementById('detailAddressRow');
const inputDetailAddress = document.getElementById('inputDetailAddress');
const btnOrderSubmit = document.getElementById('btnOrderSubmit');
const btnOrderDetail = document.getElementById('btnOrderDetail');
const orderDetailOverlay = document.getElementById('orderDetailOverlay');
const orderDetailContent = document.getElementById('orderDetailContent');
const orderDetailClose = document.getElementById('orderDetailClose');
const profileToggle = document.getElementById('profileToggle');
const profileOverlay = document.getElementById('profileOverlay');
const profileDrawer = document.getElementById('profileDrawer');
const profileClose = document.getElementById('profileClose');
const profileSettingsBtn = document.getElementById('profileSettingsBtn');
const settingsPage = document.getElementById('settingsPage');
const settingsBack = document.getElementById('settingsBack');
const settingsForm = document.getElementById('settingsForm');
const profileEmpty = document.getElementById('profileEmpty');
const profileOrders = document.getElementById('profileOrders');
const profileIncludeCancelledEl = document.getElementById('profileIncludeCancelled');
const loginRequiredModal = document.getElementById('loginRequiredModal');
const loginRequiredGo = document.getElementById('loginRequiredGo');
const chatIntroModal = document.getElementById('chatIntroModal');
const chatIntroClose = document.getElementById('chatIntroClose');
const categoryChatBtn = document.getElementById('categoryChatBtn');

let profileOrdersData = {};
let profileAllOrders = [];
let profileVisibleCount = 10;
let profileIncludeCancelled = false;
const PROFILE_PAGE_SIZE = 10;

// 180초 무활동 시 API 재호출 + 주문 목록 영역만 다시 그리기
const PROFILE_IDLE_MS = 180000;
let profileIdleTimerId = null;
let profileIdleListenersAttached = false;

const ORDER_STATUS_STEPS = [
  { key: 'payment_link_issued', label: '결제하기' },
  { key: 'payment_completed', label: '결제완료' },
  { key: 'delivery_completed', label: '발송완료' },
];
const PENDING_ORDER_STATUSES = ['submitted', 'order_accepted', 'payment_link_issued', 'payment_completed'];

// 주문 상품 id → 매장(대분류) 키 (어드민 generateId: storeId-ts-rand, storeId에 하이픈 가능)
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

function getMenuCategoryHeaderTitle(slug) {
  const d = MENU_DATA[slug];
  if (!d) return slug;
  return formatStoreSectionLabel(d.title, d.brand, slug);
}

// 유틸: 금액 포맷
function getOrderNumberDisplay(order) {
  const id = order?.id ?? '';
  const items = order?.order_items || order?.orderItems || [];
  const slugs = [...new Set(items.map((i) => getOrderItemStoreKey(i.id)).filter((s) => s && s !== 'unknown'))];
  slugs.sort();
  const n = slugs.length || 1;
  if (n <= 1) return `#${id}-1`;
  return slugs.map((_, i) => `#${id}-${i + 1}`).join(', ');
}

function getOrderSlipLabelForCategory(order, categorySlug) {
  const id = order?.id;
  if (id == null || id === '') return '';
  const items = order?.order_items || order?.orderItems || [];
  const slugs = [...new Set(items.map((i) => getOrderItemStoreKey(i.id)).filter((s) => s && s !== 'unknown'))].sort();
  const key = String(categorySlug).toLowerCase();
  const idx = slugs.indexOf(key);
  const n = slugs.length || 1;
  if (n <= 1) return `#${id}-1`;
  if (idx < 0) return `#${id}-1`;
  return `#${id}-${idx + 1}`;
}

function formatPrice(price) {
  return price.toLocaleString() + '원';
}

// 유틸: HTML 이스케이프 (XSS 방지)
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

// 유틸: 주문시간 포맷 KST (yy년 mm월 dd일 hh시 mm분)
function formatOrderTime(date) {
  if (!date) return '';
  const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = formatter.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}년 ${get('month')}월 ${get('day')}일 ${get('hour')}시 ${get('minute')}분`;
}

// 유틸: ISO 날짜를 KST 기준 간단 포맷 (yy년 mm월 dd일 | hh시 mm분)
function formatOrderDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = formatter.formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}년 ${get('month')}월 ${get('day')}일 | ${get('hour')}시 ${get('minute')}분`;
}

// 유틸: 아이콘 이모지 (플레이스홀더)
function getCategoryEmoji(category) {
  const emojis = { bento: '🍱', side: '🥗', salad: '🥬', beverage: '🥤', dessert: '🍰' };
  return emojis[category] || '📦';
}

// 카테고리 총 개수
function getCartTotalCount() {
  return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
}

// 장바구니 총 금액
function calculateTotal() {
  let total = 0;
  for (const [itemId, qty] of Object.entries(cart)) {
    const item = findItemById(itemId);
    if (item) total += item.price * qty;
  }
  return total;
}

// 메뉴 아이템 찾기
function findItemById(itemId) {
  for (const cat of Object.values(MENU_DATA)) {
    const found = cat.items?.find((i) => i.id === itemId);
    if (found) return found;
  }
  return null;
}

function getCategoryForItem(itemId) {
  for (const [slug, data] of Object.entries(MENU_DATA)) {
    if (data.items?.some((i) => i.id === itemId)) return slug;
  }
  return getOrderItemStoreKey(itemId);
}

// 장바구니에 담긴 카테고리 (1가지만 허용)
function getCartCategory() {
  const itemIds = Object.keys(cart).filter((id) => cart[id] > 0);
  if (itemIds.length === 0) return null;
  return getCategoryForItem(itemIds[0]);
}

const DAY_NAMES_KO = ['일', '월', '화', '수', '목', '금', '토'];

function getBusinessDaysHint(categorySlug) {
  const data = MENU_DATA[categorySlug];
  const days = data?.businessDays;
  if (!days || !Array.isArray(days) || days.length === 0) return '';
  const names = days.slice().sort((a, b) => a - b).map((d) => DAY_NAMES_KO[d]).filter(Boolean);
  return names.length ? `영업일: ${names.join(', ')}` : '';
}

function isBusinessDay(dateStr, categorySlug) {
  if (!dateStr || !categorySlug) return true;
  const data = MENU_DATA[categorySlug];
  const days = data?.businessDays;
  if (!days || !Array.isArray(days) || days.length === 0) return true;
  const d = new Date(dateStr + 'T12:00:00+09:00');
  const dayOfWeek = d.getUTCDay();
  return days.includes(dayOfWeek);
}

// 장바구니에 포함된 첫 매장의 결제정보
function getPaymentForCart() {
  const itemIds = Object.keys(cart).filter((id) => cart[id] > 0);
  const firstId = itemIds[0];
  if (!firstId) return MENU_DATA.bento?.payment || MENU_DATA_FALLBACK.bento.payment;
  const storeSlug = getOrderItemStoreKey(firstId);
  const storeData = MENU_DATA[storeSlug];
  return storeData?.payment || MENU_DATA.bento?.payment || MENU_DATA_FALLBACK.bento.payment;
}

// 카트 버튼 카운트 갱신
function updateCartCount() {
  const count = getCartTotalCount();
  cartCount.textContent = count;
  cartCount.style.display = count > 0 ? 'flex' : 'none';
}

// 카드에서 설정한 수량만 변경 (담기 전)
function setPendingQty(itemId, delta) {
  const current = pendingQty[itemId] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) delete pendingQty[itemId];
  else pendingQty[itemId] = next;
  if (isSearchMode && searchInput) renderSearchResults(searchInput.value);
  else renderMenuCards();
}

// 장바구니 수량 변경 (장바구니 내 +/- 버튼용)
function updateCartQty(itemId, delta) {
  const current = cart[itemId] || 0;
  const next = Math.max(0, current + delta);
  if (next === 0) delete cart[itemId];
  else cart[itemId] = next;
  updateCartCount();
  renderMenuCards();
  renderCartItems();
}

// 담기: 카드에 설정한 수량만큼 장바구니에 추가 (여러 카테고리 허용)
function addToCartFromPending(itemId) {
  const qty = pendingQty[itemId] || 0;
  if (qty <= 0) return;
  cart[itemId] = (cart[itemId] || 0) + qty;
  delete pendingQty[itemId];
  updateCartCount();
  if (isSearchMode && searchInput) renderSearchResults(searchInput.value);
  else renderMenuCards();
  renderCartItems();
}

// 카테고리 탭 렌더 (API 데이터 기반). initialSlug: suburl 접근 시 먼저 보여줄 카테고리 slug
function renderCategoryTabs(initialSlug) {
  const slugs = Object.keys(MENU_DATA);
  const specialTabs = [
    { slug: '_all', title: '전체보기' },
    { slug: '_recent', title: '최근주문' },
  ];
  const allTabSlugs = ['_all', '_recent', ...slugs];
  const firstSlug = (initialSlug && allTabSlugs.includes(initialSlug)) ? initialSlug : '_all';
  const tabButtons = [
    ...specialTabs.map(({ slug, title }) => {
      const active = slug === firstSlug ? ' active' : '';
      return `<button class="category-tab category-tab-text${active}" data-category="${escapeHtml(slug)}">${escapeHtml(title)}</button>`;
    }),
    ...slugs.map((slug) => {
      const title = escapeHtml(getMenuCategoryHeaderTitle(slug));
      const slugEsc = escapeHtml(slug);
      const active = slug === firstSlug ? ' active' : '';
      return `<button class="category-tab${active}" data-category="${slugEsc}">${title}</button>`;
    }),
  ];
  if (tabButtons.length === 0) {
    categoryTabs.innerHTML = '<p class="category-empty">등록된 카테고리가 없습니다.</p>';
    menuSectionTitle.textContent = '';
    menuGrid.innerHTML = '';
    return;
  }
  categoryTabs.innerHTML = tabButtons.join('');
}

// 메뉴 카드 렌더
function renderMenuCards() {
  if (isSearchMode) return;
  const slugs = Object.keys(MENU_DATA);
  const category = document.querySelector('.category-tab.active')?.dataset.category || '_all';
  let items = [];
  if (category === '_all') {
    menuSectionTitle.style.display = 'none';
    const allItems = [];
    for (const data of Object.values(MENU_DATA)) {
      for (const item of data.items || []) {
        allItems.push(item);
      }
    }
    items = allItems.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
  } else if (category === '_recent') {
    menuSectionTitle.style.display = 'none';
    if (recentOrderItemsCache === null) {
      menuGrid.innerHTML = '<div class="menu-loading" role="status" aria-label="로딩 중" data-loading-start="' + Date.now() + '"><div class="loading-progress"><div class="loading-progress-bar"></div></div><span class="loading-progress-pct">0%</span></div>';
      return;
    }
    items = recentOrderItemsCache;
  } else {
    menuSectionTitle.style.display = '';
    const data = MENU_DATA[category];
    if (!data) {
      menuSectionTitle.className = 'section-title menu-title';
      menuSectionTitle.textContent = '카테고리를 선택하세요';
      menuGrid.innerHTML = '';
      return;
    }
    const groupDisplay = (data.suburl || '').trim() ? data.suburl : '-';
    menuSectionTitle.className = 'section-title menu-title menu-title-with-line';
    menuSectionTitle.innerHTML = '<span class="menu-title-text">*' + escapeHtml(groupDisplay) + '</span>&nbsp;&nbsp;&nbsp;<span class="menu-title-line" aria-hidden="true"></span>';
    items = data.items || [];
  }

  const emoji = category === '_all' || category === '_recent' ? '' : getCategoryEmoji(category);
  menuGrid.innerHTML = items
    .map((item) => {
      const qty = pendingQty[item.id] || 0;
      const notInMenu = category === '_recent' && !findItemById(item.id);
      const addDisabled = notInMenu || qty === 0;
      const qtyDisabled = false;
      const idEsc = escapeHtml(item.id);
      const nameEsc = escapeHtml(item.name);
      return `
        <article class="menu-card menu-card-row" data-id="${idEsc}">
          <div class="menu-card-left">
            <div class="menu-card-cell menu-card-cell-name">${nameEsc}</div>
            <div class="menu-card-cell menu-card-cell-price">${formatPrice(item.price)}</div>
          </div>
          <div class="menu-card-cell menu-card-cell-actions">
            <div class="menu-qty-controls">
              <button type="button" class="menu-qty-btn" data-action="decrease" data-id="${idEsc}" ${qty === 0 ? 'disabled' : ''}>−</button>
              <span class="menu-qty-value">${qty}</span>
              <button type="button" class="menu-qty-btn" data-action="increase" data-id="${idEsc}">+</button>
            </div>
            <button class="menu-add-btn" data-id="${idEsc}" ${addDisabled ? 'disabled' : ''} aria-label="장바구니 담기">
              <svg class="menu-add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

let isSearchMode = false;

function getAllMenuItems() {
  const all = [];
  for (const data of Object.values(MENU_DATA)) {
    for (const item of data.items || []) all.push(item);
  }
  return all.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
}

function renderSearchResults(query) {
  menuSectionTitle.style.display = 'none';
  const q = (query || '').trim().toLowerCase();
  const all = getAllMenuItems();
  const items = q === '' ? all : all.filter((item) => (item.name || '').toLowerCase().includes(q));
  menuGrid.innerHTML = items
    .map((item) => {
      const qty = pendingQty[item.id] || 0;
      const idEsc = escapeHtml(item.id);
      const nameEsc = escapeHtml(item.name);
      return `
        <article class="menu-card menu-card-row" data-id="${idEsc}">
          <div class="menu-card-left">
            <div class="menu-card-cell menu-card-cell-name">${nameEsc}</div>
            <div class="menu-card-cell menu-card-cell-price">${formatPrice(item.price)}</div>
          </div>
          <div class="menu-card-cell menu-card-cell-actions">
            <div class="menu-qty-controls">
              <button type="button" class="menu-qty-btn" data-action="decrease" data-id="${idEsc}" ${qty === 0 ? 'disabled' : ''}>−</button>
              <span class="menu-qty-value">${qty}</span>
              <button type="button" class="menu-qty-btn" data-action="increase" data-id="${idEsc}">+</button>
            </div>
            <button class="menu-add-btn" data-id="${idEsc}" ${qty === 0 ? 'disabled' : ''} aria-label="장바구니 담기">
              <svg class="menu-add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

function openSearchMode() {
  isSearchMode = true;
  if (categoryTabsRow) categoryTabsRow.style.display = 'none';
  if (searchBarRow) searchBarRow.style.display = 'flex';
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  renderSearchResults('');
}

function closeSearchMode() {
  isSearchMode = false;
  if (searchBarRow) searchBarRow.style.display = 'none';
  if (categoryTabsRow) categoryTabsRow.style.display = 'flex';
  if (searchInput) searchInput.value = '';
  const tabs = categoryTabs?.querySelectorAll('.category-tab');
  if (tabs?.length) {
    tabs.forEach((el, i) => el.classList.toggle('active', i === 0));
  }
  renderMenuCards();
}

// 장바구니 아이템 렌더
function renderCartItems() {
  const entries = Object.entries(cart).filter(([, qty]) => qty > 0);
  const total = calculateTotal();

  if (entries.length === 0) {
    cartEmpty.style.display = 'block';
    cartItems.innerHTML = '';
    cartFooter.style.display = 'none';
    return;
  }

  cartEmpty.style.display = 'none';
  cartFooter.style.display = 'block';
  cartTotal.textContent = formatPrice(total);

  const categoryOrder = Object.keys(MENU_DATA);
  const byCategory = {};
  for (const [itemId, qty] of entries) {
    const item = findItemById(itemId);
    if (!item) continue;
    const slug = getCategoryForItem(itemId);
    if (!byCategory[slug]) byCategory[slug] = [];
    byCategory[slug].push({ itemId, qty, item });
  }
  for (const slug of Object.keys(byCategory)) {
    byCategory[slug].sort((a, b) => (a.item.name || '').localeCompare(b.item.name || '', 'ko'));
  }

  const categoryTotals = {};
  for (const slug of Object.keys(byCategory)) {
    categoryTotals[slug] = byCategory[slug].reduce((sum, { item, qty }) => sum + item.price * qty, 0);
  }

  const renderCartItem = ({ itemId, qty, item }) => `
    <div class="cart-item" data-id="${escapeHtml(itemId)}">
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-price">${formatPrice(item.price)} × ${qty}</div>
      </div>
      <div class="cart-item-qty">
        <button type="button" data-action="decrease" data-id="${escapeHtml(itemId)}">−</button>
        <span>${qty}</span>
        <button type="button" data-action="increase" data-id="${escapeHtml(itemId)}">+</button>
      </div>
      <button class="cart-item-remove" data-id="${escapeHtml(itemId)}" aria-label="삭제">
        <svg class="icon-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
        </svg>
      </button>
    </div>
  `;

  cartItems.innerHTML = categoryOrder
    .filter((slug) => byCategory[slug]?.length)
    .map((slug) => {
      const categoryTitle = escapeHtml(getMenuCategoryHeaderTitle(slug));
      const catTotal = categoryTotals[slug] || 0;
      const totalClass = 'cart-category-total met';
      const itemsHtml = byCategory[slug].map(renderCartItem).join('');
      return `
        <div class="cart-category-group">
          <div class="cart-category-header">
            <span class="cart-category-title">${categoryTitle}</span>
            <span class="${totalClass}">${formatPrice(catTotal)}</span>
          </div>
          ${itemsHtml}
        </div>
      `;
    })
    .join('');
}

// 장바구니 열기/닫기
function openCart() {
  cartDrawer.classList.add('open');
  cartOverlay.classList.add('visible');
  cartOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  cartDrawer.classList.remove('open');
  cartOverlay.classList.remove('visible');
  cartOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function renderOrderSummaryList(entries) {
  const categoryOrder = Object.keys(MENU_DATA);
  const byCategory = {};
  for (const [itemId, qty] of entries) {
    const item = findItemById(itemId);
    if (!item) continue;
    const slug = getCategoryForItem(itemId);
    if (!byCategory[slug]) byCategory[slug] = [];
    byCategory[slug].push({ item, qty });
  }
  for (const slug of Object.keys(byCategory)) {
    byCategory[slug].sort((a, b) => (a.item.name || '').localeCompare(b.item.name || '', 'ko'));
  }
  return renderOrderDetailByCategory(byCategory, categoryOrder, null);
}

function renderOrderSummaryFromOrderItems(orderItems, order) {
  const categoryOrder = Object.keys(MENU_DATA);
  const byCategory = {};
  for (const oi of orderItems || []) {
    const itemId = oi.id || '';
    const slug = getCategoryForItem(itemId);
    const item = { name: oi.name || '', price: oi.price || 0 };
    const qty = oi.quantity || 0;
    if (!slug || qty <= 0) continue;
    if (!byCategory[slug]) byCategory[slug] = [];
    byCategory[slug].push({ item, qty });
  }
  for (const slug of Object.keys(byCategory)) {
    byCategory[slug].sort((a, b) => (a.item.name || '').localeCompare(b.item.name || '', 'ko'));
  }
  return renderOrderDetailByCategory(byCategory, categoryOrder, order || null);
}

function renderOrderDetailByCategory(byCategory, categoryOrder, order) {
  const categoryTotals = {};
  for (const slug of Object.keys(byCategory)) {
    categoryTotals[slug] = byCategory[slug].reduce((sum, { item, qty }) => sum + item.price * qty, 0);
  }
  const renderDetailItem = ({ item, qty }) => `
    <div class="order-detail-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-price">${formatPrice(item.price)} × ${qty}</div>
      </div>
    </div>
  `;
  const keys = Object.keys(byCategory);
  let displaySlugs;
  if (order) {
    const items = order.orderItems || order.order_items || [];
    const slipOrdered = [...new Set(items.map((i) => getOrderItemStoreKey(i.id)).filter((s) => s && s !== 'unknown'))].sort();
    const orderedKeys = [];
    for (const s of slipOrdered) {
      const k = keys.find((key) => String(key).toLowerCase() === s && byCategory[key]?.length);
      if (k != null && !orderedKeys.includes(k)) orderedKeys.push(k);
    }
    const orphan = keys.filter((k) => !orderedKeys.includes(k)).sort((a, b) => a.localeCompare(b, 'ko'));
    displaySlugs = orderedKeys.concat(orphan);
  } else {
    displaySlugs = categoryOrder.filter((slug) => byCategory[slug]?.length);
  }
  return displaySlugs
    .filter((slug) => byCategory[slug]?.length)
    .map((slug) => {
      const categoryTitle = escapeHtml(getMenuCategoryHeaderTitle(slug));
      const catTotal = categoryTotals[slug] || 0;
      const itemsHtml = byCategory[slug].map(renderDetailItem).join('');
      const slipRaw = order ? getOrderSlipLabelForCategory(order, slug) : '';
      const slipLabel = escapeHtml(slipRaw);
      return `
        <div class="cart-category-group">
          <div class="cart-category-header">
            <span class="cart-category-title">${categoryTitle}</span>
            <span class="cart-category-slip met">${slipLabel}</span>
          </div>
          ${itemsHtml}
          <div class="cart-category-subtotal-wrap">
            <div class="cart-category-subtotal-text met">${formatPrice(catTotal)}</div>
            <div class="cart-category-subtotal-lines" aria-hidden="true">
              <hr class="cart-category-rule" />
              <hr class="cart-category-rule" />
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

// 결제 모달 열기 (마이프로필 설정이 있으면 주문자명·연락처·배송주소·상세주소 기본값 적용)
async function openCheckoutModal() {
  const total = calculateTotal();
  const entries = Object.entries(cart).filter(([, qty]) => qty > 0);
  const orderTime = new Date();

  checkoutOrderTime.textContent = formatOrderTime(orderTime);
  checkoutAmount.textContent = formatPrice(total);

  orderDetailContent.innerHTML = `<div class="order-detail-list order-detail-cart-style">${renderOrderSummaryList(entries)}</div>`;

  const orderDetailPanel = orderDetailOverlay.querySelector('.order-detail-panel');
  if (orderDetailPanel) orderDetailPanel.classList.remove('order-detail-cancelled');
  const orderDetailTotalEl = document.getElementById('orderDetailTotal');
  if (orderDetailTotalEl) orderDetailTotalEl.textContent = formatPrice(total);

  inputDepositor.value = '';
  inputContact.value = '';
  inputDeliveryAddress.value = '';
  detailAddressRow.style.display = 'none';
  inputDetailAddress.value = '';

  const token = window.BzCatAuth?.getToken();
  if (token) {
    try {
      const res = await fetch('/api/profile/settings', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      const data = res.ok && json.settings ? json.settings : {};
      if (data.name) inputDepositor.value = data.name;
      if (data.contact) inputContact.value = data.contact;
      if ((data.address || '').trim()) {
        inputDeliveryAddress.value = (data.address || '').trim();
        detailAddressRow.style.display = '';
        if (data.detailAddress) inputDetailAddress.value = (data.detailAddress || '').trim();
      }
    } catch (_) {}
  }

  btnOrderSubmit.textContent = '결제하기';
  const hasName = (inputDepositor.value || '').trim().length > 0;
  const hasContact = (inputContact.value || '').trim().length > 0;
  const hasAddress = (inputDeliveryAddress.value || '').trim().length > 0;
  const detailRowVisible = detailAddressRow.style.display !== 'none';
  const hasDetailAddress = !detailRowVisible || (inputDetailAddress.value || '').trim().length > 0;
  btnOrderSubmit.disabled = !(hasName && hasContact && hasAddress && hasDetailAddress);

  checkoutModal.classList.add('visible');
  checkoutModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function openOrderDetailOverlay() {
  orderDetailOverlay.classList.add('visible');
  orderDetailOverlay.setAttribute('aria-hidden', 'false');
}

function closeOrderDetailOverlay() {
  orderDetailOverlay.classList.remove('visible');
  orderDetailOverlay.setAttribute('aria-hidden', 'true');
}

// 마이프로필: 주문 내역
async function openProfile() {
  profileDrawer.classList.add('open');
  profileOverlay.classList.add('visible');
  profileOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  await fetchAndRenderProfileOrders();
}

function closeProfile() {
  profileDrawer.classList.remove('open');
  profileOverlay.classList.remove('visible');
  profileOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function openProfileOrderDetail(order) {
  const html = renderOrderSummaryFromOrderItems(order.orderItems || [], order);
  orderDetailContent.innerHTML = `<div class="order-detail-list order-detail-cart-style">${html}</div>`;
  const totalEl = document.getElementById('orderDetailTotal');
  if (totalEl) totalEl.textContent = formatPrice(order.totalAmount || 0);
  const panel = orderDetailOverlay.querySelector('.order-detail-panel');
  if (panel) panel.classList.toggle('order-detail-cancelled', order.status === 'cancelled');

  const cancelBtn = document.getElementById('orderDetailCancelBtn');
  if (cancelBtn) {
    if (canCancelOrder(order.status)) {
      cancelBtn.style.display = '';
      cancelBtn.textContent = '취소하기';
      cancelBtn.onclick = () => handleOrderCancelClick(order);
    } else if (order.status === 'payment_completed') {
      const PAYMENT_CANCEL_WINDOW_MS = 45 * 60 * 1000;
      const completedAt = order.paymentCompletedAt ? new Date(order.paymentCompletedAt).getTime() : 0;
      const withinWindow = order.paymentCompletedAt && (Date.now() - completedAt < PAYMENT_CANCEL_WINDOW_MS);
      if (withinWindow) {
        cancelBtn.style.display = '';
        cancelBtn.textContent = '결제취소';
        cancelBtn.onclick = () => handlePaymentCancelClick(order);
      } else {
        cancelBtn.style.display = 'none';
        cancelBtn.onclick = null;
      }
    } else {
      cancelBtn.style.display = 'none';
      cancelBtn.onclick = null;
    }
  }

  orderDetailOverlay.classList.add('visible');
  orderDetailOverlay.setAttribute('aria-hidden', 'false');
}

function handleOrderCancelClick(order) {
  const modal = document.getElementById('orderDetailCancelModal');
  if (!modal) return;
  const backBtn = modal.querySelector('.order-detail-cancel-modal-btn.back');
  const confirmBtn = modal.querySelector('.order-detail-cancel-modal-btn.confirm');
  const backdrop = modal.querySelector('.order-detail-cancel-modal-backdrop');
  const closeBtn = modal.querySelector('.order-detail-cancel-modal-close');
  const closeModalAndOrderDetail = () => {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    if (backBtn) backBtn.onclick = null;
    if (confirmBtn) confirmBtn.onclick = null;
    if (backdrop) backdrop.onclick = null;
    if (closeBtn) closeBtn.onclick = null;
    closeOrderDetailOverlay();
  };
  backBtn.onclick = closeModalAndOrderDetail;
  confirmBtn.onclick = async () => {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    if (backBtn) backBtn.onclick = null;
    if (confirmBtn) confirmBtn.onclick = null;
    if (backdrop) backdrop.onclick = null;
    if (closeBtn) closeBtn.onclick = null;
    await doCancelOrder(order);
  };
  if (backdrop) backdrop.onclick = closeModalAndOrderDetail;
  if (closeBtn) closeBtn.onclick = closeModalAndOrderDetail;
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
}

function handlePaymentCancelClick(order) {
  const modal = document.getElementById('orderDetailPaymentCancelModal');
  if (!modal) return;
  const backBtn = modal.querySelector('.order-detail-payment-cancel-modal-btn.back');
  const confirmBtn = modal.querySelector('.order-detail-payment-cancel-modal-btn.confirm');
  const backdrop = modal.querySelector('.order-detail-payment-cancel-modal-backdrop');
  const closeBtn = modal.querySelector('.order-detail-payment-cancel-modal-close');
  const closeModalAndOrderDetail = () => {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    if (backBtn) backBtn.onclick = null;
    if (confirmBtn) confirmBtn.onclick = null;
    if (backdrop) backdrop.onclick = null;
    if (closeBtn) closeBtn.onclick = null;
    closeOrderDetailOverlay();
  };
  backBtn.onclick = closeModalAndOrderDetail;
  confirmBtn.onclick = async () => {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    if (backBtn) backBtn.onclick = null;
    if (confirmBtn) confirmBtn.onclick = null;
    if (backdrop) backdrop.onclick = null;
    if (closeBtn) closeBtn.onclick = null;
    await doCancelOrder(order);
  };
  if (backdrop) backdrop.onclick = closeModalAndOrderDetail;
  if (closeBtn) closeBtn.onclick = closeModalAndOrderDetail;
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
}

async function doCancelOrder(order) {
  const token = window.BzCatAuth?.getToken();
  if (!token) {
    alert('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    window.location.reload();
    return;
  }
  try {
    const res = await fetch('/api/orders/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ orderId: order.id }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '주문 취소에 실패했습니다.');
      return;
    }
    alert('주문이 취소되었습니다.');
    closeOrderDetailOverlay();
    await fetchAndRenderProfileOrders();
  } catch (err) {
    console.error('Cancel order error:', err);
    alert('네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
  }
}

function isPaymentLinkActive(order) {
  if (order.status === 'cancelled' || order.status === 'payment_completed' || order.status === 'shipping' || order.status === 'delivery_completed') return false;
  return ['submitted', 'order_accepted', 'payment_link_issued'].includes(order.status);
}

function canCancelOrder(status) {
  return status !== 'cancelled' && ['submitted', 'order_accepted', 'payment_link_issued'].includes(status);
}

function renderProfileOrdersList() {
  const orders = profileIncludeCancelled ? profileAllOrders : profileAllOrders.filter((o) => o.status !== 'cancelled');
  const visible = orders.slice(0, profileVisibleCount);
  const hasMore = orders.length > profileVisibleCount;

  const stepIndex = (status) => {
    if (['submitted', 'order_accepted', 'payment_link_issued'].includes(status)) return 0;
    if (status === 'payment_completed') return 1;
    if (status === 'shipping' || status === 'delivery_completed') return 2;
    return 0;
  };
  const isCancelled = (status) => status === 'cancelled';
  const canCancel = canCancelOrder;

  profileOrdersData = {};

  const cardsHtml = visible
    .map((o) => {
      profileOrdersData[o.id] = o;
      const paymentLinkActive = isPaymentLinkActive(o);
      const cancelled = isCancelled(o.status);
      const currentIdx = cancelled ? -1 : stepIndex(o.status);
      let stepsHtml;
      if (cancelled) {
        stepsHtml = '';
      } else {
        const isDeliveryCompleted = o.status === 'delivery_completed' || o.status === 'shipping';
        stepsHtml = ORDER_STATUS_STEPS.map((s, i) => {
          let cls = 'step';
          if (i < currentIdx) cls += ' done';
          else if (i === currentIdx) cls += ' active';
          else cls += ' pending';
          if (i === 0 && paymentLinkActive) cls += ' payment-link-ready';
          if (i === 2 && isDeliveryCompleted) cls += ' delivery-info-ready';
          const attrs = [];
          if (i === 0 && paymentLinkActive) attrs.push('data-action="open-payment-link"');
          if (i === 2 && isDeliveryCompleted) attrs.push(`data-action="show-delivery-info" data-order-id="${escapeHtml(String(o.id))}" role="button" tabindex="0"`);
          return `<span class="${cls}" ${attrs.join(' ')}>${s.label}</span>`;
        }).join('');
      }
      const orderIdEsc = escapeHtml(String(o.id));
      const orderNumberDisplay = escapeHtml(getOrderNumberDisplay(o)).replace(/, /g, '<br>');
      return `
        <div class="profile-order-card" data-order-id="${orderIdEsc}">
          <div class="profile-order-card-header">
            <div class="profile-order-header-left">
              <span class="profile-order-id">${orderNumberDisplay}</span>
            </div>
            <div class="profile-order-header-right">
              <span class="profile-order-status ${cancelled ? 'cancelled' : ''} ${o.status === 'delivery_completed' ? 'delivered' : ''}">${escapeHtml(o.statusLabel || '')}</span>
            </div>
          </div>
          <div class="profile-order-date">주문일시 : ${formatOrderDate(o.createdAt)}</div>
          <div class="profile-order-status-steps" ${cancelled ? ' style="display:none"' : ''}>${stepsHtml}</div>
          <div class="profile-order-amount-row">
            <div class="profile-order-amount ${cancelled ? 'cancelled' : ''} ${o.status === 'delivery_completed' ? 'delivered' : ''}">${formatPrice(o.totalAmount || 0)}</div>
            <button type="button" class="profile-btn profile-btn-detail" data-action="detail">주문내역</button>
          </div>
        </div>
      `;
    })
    .join('');

  const loadMoreHtml = hasMore
    ? `<div class="profile-load-more-wrap"><button type="button" class="profile-btn profile-btn-load-more" data-action="load-more">더 보기</button></div>`
    : '';

  profileOrders.innerHTML = cardsHtml + loadMoreHtml;
}

function updateProfileButtonHighlight() {
  const hasPending = profileAllOrders.some((o) => PENDING_ORDER_STATUSES.includes(o.status));
  profileToggle.classList.toggle('has-pending-orders', hasPending);
}

async function fetchAndRenderProfileOrders() {
  const token = window.BzCatAuth?.getToken();
  if (!token) {
    profileEmpty.style.display = 'block';
    profileOrders.style.display = 'none';
    profileEmpty.innerHTML = '<p>로그인이 필요합니다</p>';
    profileAllOrders = [];
    updateProfileButtonHighlight();
    return;
  }
  profileEmpty.style.display = 'block';
  profileOrders.style.display = 'none';
  profileEmpty.innerHTML = '<div class="profile-loading" role="status" aria-label="로딩 중" data-loading-start="' + Date.now() + '"><div class="loading-progress"><div class="loading-progress-bar"></div></div><span class="loading-progress-pct">0%</span></div>';

  try {
    const res = await fetch('/api/orders/my', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok) {
      profileEmpty.innerHTML = `<p>${escapeHtml(data.error || '불러오기에 실패했습니다.')}</p>`;
      return;
    }

    const orders = data.orders || [];
    profileAllOrders = orders;
    updateProfileButtonHighlight();

    if (orders.length === 0) {
      profileEmpty.style.display = 'block';
      profileOrders.style.display = 'none';
      profileEmpty.innerHTML = '<p>주문 내역이 없습니다</p><p class="profile-empty-hint">주문 신청을 완료하면 여기에서 확인할 수 있습니다</p>';
      return;
    }

    profileEmpty.style.display = 'none';
    profileOrders.style.display = 'block';
    profileVisibleCount = PROFILE_PAGE_SIZE;
    renderProfileOrdersList();
  } catch (err) {
    console.error('Profile orders fetch error:', err);
    profileEmpty.style.display = 'block';
    profileOrders.style.display = 'none';
    profileEmpty.innerHTML = '<p>네트워크 오류가 발생했습니다.</p>';
  }
}

function resetProfileIdleTimer() {
  if (profileIdleTimerId != null) clearTimeout(profileIdleTimerId);
  profileIdleTimerId = setTimeout(() => {
    fetchAndRenderProfileOrders().then(() => resetProfileIdleTimer());
  }, PROFILE_IDLE_MS);
}

function startProfileIdleRefresh() {
  if (profileIdleTimerId != null) clearTimeout(profileIdleTimerId);
  profileIdleTimerId = setTimeout(() => {
    fetchAndRenderProfileOrders().then(() => resetProfileIdleTimer());
  }, PROFILE_IDLE_MS);
  if (!profileIdleListenersAttached) {
    profileIdleListenersAttached = true;
    document.addEventListener('click', resetProfileIdleTimer);
    document.addEventListener('keydown', resetProfileIdleTimer);
    document.addEventListener('input', resetProfileIdleTimer);
  }
}

function closeCheckoutModal() {
  checkoutModal.classList.remove('visible');
  checkoutModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function showOrderAcceptedModal(onConfirm) {
  const modal = document.getElementById('orderAcceptedModal');
  if (!modal) return;
  const confirmBtn = document.getElementById('orderAcceptedModalConfirm');
  const closeBtn = document.getElementById('orderAcceptedModalClose');
  const backdrop = modal.querySelector('.order-accepted-modal-backdrop');
  const doClose = () => {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    if (typeof onConfirm === 'function') onConfirm();
    if (confirmBtn) confirmBtn.onclick = null;
    if (closeBtn) closeBtn.onclick = null;
    if (backdrop) backdrop.onclick = null;
  };
  if (confirmBtn) confirmBtn.onclick = doClose;
  if (closeBtn) closeBtn.onclick = doClose;
  if (backdrop) backdrop.onclick = doClose;
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
}

function showUnsupportedRegionModal() {
  const modal = document.getElementById('unsupportedRegionModal');
  if (!modal) return;
  const confirmBtn = document.getElementById('unsupportedRegionModalConfirm');
  const closeBtn = document.getElementById('unsupportedRegionModalClose');
  const backdrop = modal.querySelector('.unsupported-region-modal-backdrop');
  const doClose = () => {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    if (confirmBtn) confirmBtn.onclick = null;
    if (closeBtn) closeBtn.onclick = null;
    if (backdrop) backdrop.onclick = null;
  };
  if (confirmBtn) confirmBtn.onclick = doClose;
  if (closeBtn) closeBtn.onclick = doClose;
  if (backdrop) backdrop.onclick = doClose;
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
}

function openDeliveryInfoModal(order) {
  const modal = document.getElementById('deliveryInfoModal');
  const msgEl = document.getElementById('deliveryInfoModalMsg');
  if (!modal || !msgEl) return;
  const hasParcel = !!(order.courierCompany && order.courierCompany.trim()) || !!(order.trackingNumber && order.trackingNumber.trim());
  let text;
  if (order.deliveryType === 'direct') text = '직접 배송 완료';
  else if (hasParcel) text = `${(order.courierCompany || '—').trim()} / ${(order.trackingNumber || '').trim()}`;
  else text = '배송 정보 없음';
  msgEl.textContent = text;
  const closeBtn = document.getElementById('deliveryInfoModalClose');
  const backdrop = modal.querySelector('.delivery-info-modal-backdrop');
  const doClose = () => {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    if (closeBtn) closeBtn.onclick = null;
    if (backdrop) backdrop.onclick = null;
  };
  if (closeBtn) closeBtn.onclick = doClose;
  if (backdrop) backdrop.onclick = doClose;
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
}

// 최근주문 탭: 모든 주문 진행 단계의 상품을 최근 순 최대 20개
async function fetchRecentOrderItems() {
  const token = window.BzCatAuth?.getToken?.();
  if (!token) {
    recentOrderItemsCache = [];
    return;
  }
  try {
    const res = await fetch('/api/orders/my', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    const orders = data.orders || [];
    const orderDate = (o) => (o.createdAt ? new Date(o.createdAt).getTime() : 0);
    orders.sort((a, b) => orderDate(b) - orderDate(a));
    const flattened = [];
    for (const order of orders) {
      const ts = orderDate(order);
      for (const oi of order.orderItems || []) {
        if (oi && (oi.id || oi.name)) {
          flattened.push({
            id: oi.id || '',
            name: oi.name || '',
            price: oi.price != null ? oi.price : 0,
            _orderDate: ts,
          });
        }
      }
    }
    flattened.sort((a, b) => (b._orderDate || 0) - (a._orderDate || 0));
    recentOrderItemsCache = flattened.slice(0, 20).map(({ id, name, price }) => ({ id, name, price }));
  } catch (err) {
    console.warn('Recent orders fetch failed:', err);
    recentOrderItemsCache = [];
  }
}

// 카테고리 탭 클릭
async function handleCategoryClick(e) {
  const tab = e.target.closest('.category-tab');
  if (!tab) return;
  const category = tab.dataset.category;
  if (category === '_recent' && recentOrderItemsCache === null) {
    await fetchRecentOrderItems();
  }
  document.querySelectorAll('.category-tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  // 클릭한 탭이 잘려 보이면 스크롤해서 전체가 보이도록
  const container = categoryTabs;
  const tabLeft = tab.offsetLeft;
  const tabRight = tabLeft + tab.offsetWidth;
  const scrollLeft = container.scrollLeft;
  const visibleRight = scrollLeft + container.clientWidth;
  if (tabLeft < scrollLeft) {
    // 왼쪽이 잘린 경우: 1·2번째는 맨 처음처럼, 3번째 이상은 앞 버튼 일부가 보이도록
    const tabs = container.querySelectorAll('.category-tab');
    const index = Array.from(tabs).indexOf(tab);
    if (index <= 1) {
      container.scrollTo({ left: 0, behavior: 'smooth' });
    } else {
      const prevTab = tabs[index - 1];
      const targetScroll = Math.max(prevTab.offsetLeft, tabRight - container.clientWidth);
      container.scrollTo({ left: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  } else if (tabRight > visibleRight) {
    // 오른쪽이 잘린 경우: 마지막 버튼이면 완전히 보이게, 아니면 다음 버튼 50%가 보이도록 더 이동
    const tabs = container.querySelectorAll('.category-tab');
    const index = Array.from(tabs).indexOf(tab);
    const isLast = index === tabs.length - 1;
    if (isLast) {
      container.scrollTo({ left: tabRight - container.clientWidth, behavior: 'smooth' });
    } else {
      const nextTab = tabs[index + 1];
      const halfNext = nextTab.offsetLeft + nextTab.offsetWidth / 2;
      const targetScroll = Math.max(
        tabRight - container.clientWidth,
        Math.min(tabLeft, halfNext - container.clientWidth)
      );
      container.scrollTo({ left: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  }
  renderMenuCards();
}

// 모달 표시/숨김 공통
function setModalVisible(modalEl, visible) {
  if (!modalEl) return;
  modalEl.classList.toggle('visible', visible);
  modalEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

// 로그인 유도 모달
function openLoginRequiredModal() {
  setModalVisible(loginRequiredModal, true);
}
function closeLoginRequiredModal() {
  setModalVisible(loginRequiredModal, false);
}

// 채팅 주문 안내 모달
function openChatIntroModal() {
  setModalVisible(chatIntroModal, true);
}
function closeChatIntroModal() {
  setModalVisible(chatIntroModal, false);
}

// 메뉴 그리드 클릭 위임 (이벤트 리스너 최소화)
function handleMenuGridClick(e) {
  const qtyBtn = e.target.closest('.menu-qty-btn');
  if (qtyBtn) {
    if (!window.BzCatAuth?.getToken()) {
      openLoginRequiredModal();
      return;
    }
    const id = qtyBtn.dataset.id;
    const action = qtyBtn.dataset.action;
    setPendingQty(id, action === 'increase' ? 1 : -1);
    return;
  }
  const nameCell = e.target.closest('.menu-card-cell-name');
  if (nameCell) {
    if (!window.BzCatAuth?.getToken()) {
      openLoginRequiredModal();
      return;
    }
    const card = nameCell.closest('.menu-card');
    if (card && card.dataset.id) {
      setPendingQty(card.dataset.id, 1);
    }
    return;
  }
  const addBtn = e.target.closest('.menu-add-btn');
  if (addBtn) {
    if (!window.BzCatAuth?.getToken()) {
      openLoginRequiredModal();
      return;
    }
    const itemId = addBtn.dataset.id;
    addToCartFromPending(itemId);
    return;
  }
  const wrapper = e.target.closest('.menu-card-image-wrapper');
  if (wrapper) {
    e.stopPropagation();
    const overlay = wrapper.querySelector('.menu-info-overlay');
    if (e.target.closest('.menu-info-overlay')) {
      overlay?.classList.remove('active');
      return;
    }
    if (e.target.closest('.menu-card-image')) {
      menuGrid.querySelectorAll('.menu-info-overlay').forEach((o) => o.classList.remove('active'));
      overlay?.classList.add('active');
    }
    return;
  }
}

// 이벤트 바인딩
function init() {
  window.BzCatAppOpenProfile = openProfile;
  categoryTabs.addEventListener('click', handleCategoryClick);
  searchToggle?.addEventListener('click', openSearchMode);
  searchClose?.addEventListener('click', closeSearchMode);
  searchInput?.addEventListener('input', () => {
    if (isSearchMode) renderSearchResults(searchInput.value);
  });
  menuGrid.addEventListener('click', handleMenuGridClick);
  cartItems.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      updateCartQty(btn.dataset.id, btn.dataset.action === 'increase' ? 1 : -1);
      return;
    }
    const removeBtn = e.target.closest('.cart-item-remove');
    if (removeBtn) {
      const id = removeBtn.dataset.id;
      updateCartQty(id, -(cart[id] || 0));
    }
  });
  cartToggle.addEventListener('click', openCart);
  cartClose.addEventListener('click', closeCart);
  cartOverlay.addEventListener('click', closeCart);

  startProfileIdleRefresh();
  window.BzCatAppOnShow = function () {
    fetchAndRenderProfileOrders();
    refreshMenuAndRender();
  };
  window.BzCatAppRefreshMenu = refreshMenuAndRender;
  profileToggle.addEventListener('click', openProfile);
  profileClose.addEventListener('click', closeProfile);
  profileOverlay.addEventListener('click', (e) => {
    if (e.target === profileOverlay) closeProfile();
  });

  const mainContent = document.querySelector('.main');

  async function showSettingsPage() {
    if (!settingsPage || !mainContent) return;
    mainContent.style.display = 'none';
    settingsPage.style.display = 'flex';
    settingsPage.setAttribute('aria-hidden', 'false');
    const storeNameEl = document.getElementById('settingsStoreName');
    const bizNumberEl = document.getElementById('settingsBizNumber');
    const nameEl = document.getElementById('settingsName');
    const contactEl = document.getElementById('settingsContact');
    const addressEl = document.getElementById('settingsAddress');
    const detailRow = document.getElementById('settingsDetailAddressRow');
    const detailEl = document.getElementById('settingsDetailAddress');
    if (storeNameEl) storeNameEl.value = '';
    if (bizNumberEl) bizNumberEl.value = '';
    if (nameEl) nameEl.value = '';
    if (contactEl) contactEl.value = '';
    if (addressEl) addressEl.value = '';
    if (detailEl) detailEl.value = '';
    if (detailRow) detailRow.style.display = 'none';
    const token = window.BzCatAuth?.getToken();
    if (token) {
      try {
        const res = await fetch('/api/profile/settings', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        const data = res.ok && json.settings ? json.settings : {};
          if (storeNameEl) storeNameEl.value = data.storeName || '';
          if (bizNumberEl) bizNumberEl.value = (data.bizNumber || '').replace(/\D/g, '').slice(0, 10);
        if (nameEl) nameEl.value = data.name || '';
        if (contactEl) contactEl.value = data.contact || '';
        if (addressEl) addressEl.value = data.address || '';
        if (detailEl) detailEl.value = data.detailAddress || '';
        if (detailRow && (data.address || '').trim()) detailRow.style.display = '';
      } catch (_) {}
    }
  }

  function hideSettingsPage() {
    if (!settingsPage || !mainContent) return;
    settingsPage.style.display = 'none';
    settingsPage.setAttribute('aria-hidden', 'true');
    mainContent.style.display = '';
  }

  function applySettingsRoute() {
    const hash = (window.location.hash || '').toLowerCase();
    if (hash === '#settings') {
      showSettingsPage();
    } else {
      hideSettingsPage();
    }
  }

  if (profileSettingsBtn) {
    profileSettingsBtn.addEventListener('click', () => {
      closeProfile();
      window.location.hash = '#settings';
      applySettingsRoute();
    });
  }
  if (settingsBack) {
    settingsBack.addEventListener('click', () => {
      window.location.hash = '';
      applySettingsRoute();
    });
  }
  window.addEventListener('hashchange', applySettingsRoute);

  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const storeNameEl = document.getElementById('settingsStoreName');
      const bizNumberEl = document.getElementById('settingsBizNumber');
      const nameEl = document.getElementById('settingsName');
      const contactEl = document.getElementById('settingsContact');
      const addressEl = document.getElementById('settingsAddress');
      const detailEl = document.getElementById('settingsDetailAddress');
      const storeName = (storeNameEl?.value || '').trim();
      const bizNumberRaw = (bizNumberEl?.value || '').trim().replace(/\D/g, '');
      const bizNumber = bizNumberRaw.length === 10
        ? `${bizNumberRaw.slice(0, 3)}-${bizNumberRaw.slice(3, 5)}-${bizNumberRaw.slice(5, 10)}`
        : bizNumberRaw;
      const name = (nameEl?.value || '').trim();
      const contact = (contactEl?.value || '').trim().replace(/\D/g, '');
      const address = (addressEl?.value || '').trim();
      const detailAddress = (detailEl?.value || '').trim();
      if (!storeName) {
        alert('매장명을 입력해 주세요.');
        storeNameEl?.focus();
        return;
      }
      if (!bizNumberRaw || bizNumberRaw.length !== 10) {
        alert('사업자등록번호 10자리를 입력해 주세요.');
        bizNumberEl?.focus();
        return;
      }
      if (!name) {
        alert('이름을 입력해 주세요.');
        nameEl?.focus();
        return;
      }
      if (!contact) {
        alert('비상연락처를 입력해 주세요.');
        contactEl?.focus();
        return;
      }
      if (contact.length !== 11 || !contact.startsWith('010')) {
        alert('010으로 시작하는 11자리 핸드폰 번호를 입력해 주세요.');
        contactEl?.focus();
        return;
      }
      if (!address) {
        alert('기본배송주소를 입력해 주세요. 주소 입력란을 눌러 주소를 검색하세요.');
        addressEl?.focus();
        return;
      }
      const token = window.BzCatAuth?.getToken();
      if (!token) {
        alert('로그인이 필요합니다.');
        return;
      }
      const submitBtn = document.getElementById('settingsSubmit');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '저장 중...';
      }
      try {
        const res = await fetch('/api/profile/settings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            storeName,
            bizNumber,
            name,
            contact,
            address,
            detailAddress,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(json.error || '저장에 실패했습니다.');
          return;
        }
        alert('저장되었습니다.');
        window.location.hash = '';
        applySettingsRoute();
      } catch (err) {
        console.error(err);
        alert('네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '저장';
        }
      }
    });
  }

  const settingsAddressInput = document.getElementById('settingsAddress');
  const settingsDetailAddressRow = document.getElementById('settingsDetailAddressRow');
  const settingsDetailAddressInput = document.getElementById('settingsDetailAddress');

  function openSettingsPostcode() {
    if (typeof daum === 'undefined' || !daum.Postcode) {
      alert('주소 검색 API를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    const postcodeOverlay = document.getElementById('postcodeOverlay');
    const postcodeLayer = document.getElementById('postcodeLayer');
    if (!postcodeOverlay || !postcodeLayer || !settingsAddressInput) return;
    postcodeLayer.innerHTML = '';
    postcodeOverlay.classList.add('visible');
    postcodeOverlay.setAttribute('aria-hidden', 'false');
    new daum.Postcode({
      oncomplete: function (data) {
        let addr = '';
        if (data.userSelectedType === 'R') {
          addr = data.roadAddress || data.autoRoadAddress || data.address || '';
        } else {
          addr = data.jibunAddress || data.autoJibunAddress || data.address || '';
        }
        if (!addr) addr = data.address || data.roadAddress || data.jibunAddress || '';
        settingsAddressInput.value = addr;
        postcodeOverlay.classList.remove('visible');
        postcodeOverlay.setAttribute('aria-hidden', 'true');
        if (settingsDetailAddressRow) settingsDetailAddressRow.style.display = '';
        if (settingsDetailAddressInput) {
          settingsDetailAddressInput.value = '';
          setTimeout(() => settingsDetailAddressInput.focus(), 100);
        }
      },
      onresize: function (size) {
        postcodeLayer.style.height = size.height + 'px';
      },
      width: '100%',
      height: '100%',
    }).embed(postcodeLayer);
  }

  if (settingsAddressInput) {
    settingsAddressInput.addEventListener('click', openSettingsPostcode);
    settingsAddressInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSettingsPostcode();
      }
    });
  }
  if (profileIncludeCancelledEl) {
    profileIncludeCancelledEl.addEventListener('change', () => {
      profileIncludeCancelled = profileIncludeCancelledEl.checked;
      renderProfileOrdersList();
      const profileContent = document.getElementById('profileContent');
      if (profileContent) profileContent.scrollTop = 0;
    });
  }
  profileOrders.addEventListener('click', (e) => {
    const deliveryInfoStep = e.target.closest('[data-action="show-delivery-info"]');
    if (deliveryInfoStep) {
      const orderId = deliveryInfoStep.dataset.orderId;
      const order = orderId && profileOrdersData[orderId];
      if (order) openDeliveryInfoModal(order);
      return;
    }
    const paymentLinkStep = e.target.closest('[data-action="open-payment-link"]');
    if (paymentLinkStep) {
      const card = paymentLinkStep.closest('.profile-order-card');
      const orderId = card?.dataset?.orderId;
      const order = orderId && profileOrdersData[orderId];
      if (!order) return;
      (async () => {
        const token = window.BzCatAuth?.getToken();
        if (!token) {
          alert('로그인이 필요합니다.');
          return;
        }
        try {
          const res = await fetch('/api/payment/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ orderId }),
          });
          const text = await res.text();
          let data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch (_) {}
          if (!res.ok) {
            alert(data.error || '결제 요청에 실패했습니다.');
            return;
          }
          if (data.checkoutUrl) window.location.href = data.checkoutUrl;
          else alert('결제 URL을 받지 못했습니다.');
        } catch (err) {
          console.error(err);
          alert('네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
        }
      })();
      return;
    }
    
    const btn = e.target.closest('.profile-btn');
    if (!btn) return;
    if (btn.dataset.action === 'load-more') {
      profileVisibleCount += PROFILE_PAGE_SIZE;
      renderProfileOrdersList();
      return;
    }
    const card = btn.closest('.profile-order-card');
    const orderId = card?.dataset?.orderId;
    const order = orderId && profileOrdersData[orderId];
    if (!order) return;
    if (btn.dataset.action === 'detail') {
      openProfileOrderDetail(order);
    }
  });
  btnCheckout.addEventListener('click', (e) => {
    closeCart();
    openCheckoutModal();
  });
  checkoutClose.addEventListener('click', closeCheckoutModal);
  checkoutModal.addEventListener('click', (e) => {
    if (e.target === checkoutModal) closeCheckoutModal();
  });
  const loginRequiredClose = document.getElementById('loginRequiredClose');
  if (loginRequiredClose) loginRequiredClose.addEventListener('click', closeLoginRequiredModal);
  if (loginRequiredGo) {
    loginRequiredGo.addEventListener('click', () => {
      closeLoginRequiredModal();
      if (window.BzCatAuth?.showLogin) window.BzCatAuth.showLogin();
    });
  }
  if (loginRequiredModal) {
    loginRequiredModal.addEventListener('click', (e) => {
      if (e.target === loginRequiredModal) closeLoginRequiredModal();
    });
  }
  if (categoryChatBtn) categoryChatBtn.addEventListener('click', openChatIntroModal);
  if (chatIntroClose) chatIntroClose.addEventListener('click', closeChatIntroModal);
  if (chatIntroModal) {
    chatIntroModal.addEventListener('click', (e) => {
      if (e.target === chatIntroModal) closeChatIntroModal();
    });
  }
  function updateOrderSubmitButton() {
    const hasName = (inputDepositor.value || '').trim().length > 0;
    const hasContact = (inputContact.value || '').trim().length > 0;
    const hasAddress = (inputDeliveryAddress.value || '').trim().length > 0;
    const detailRowVisible = detailAddressRow.style.display !== 'none';
    const hasDetailAddress = !detailRowVisible || (inputDetailAddress.value || '').trim().length > 0;
    btnOrderSubmit.disabled = !(hasName && hasContact && hasAddress && hasDetailAddress);
  }
  inputDepositor.addEventListener('input', updateOrderSubmitButton);
  inputDepositor.addEventListener('change', updateOrderSubmitButton);
  inputContact.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
    updateOrderSubmitButton();
  });
  inputContact.addEventListener('change', updateOrderSubmitButton);
  const postcodeOverlay = document.getElementById('postcodeOverlay');
  const postcodeLayer = document.getElementById('postcodeLayer');
  const postcodeClose = document.getElementById('postcodeClose');

  function openPostcode() {
    if (typeof daum === 'undefined' || !daum.Postcode) {
      inputDeliveryAddress.removeAttribute('readonly');
      inputDeliveryAddress.placeholder = '배송주소 입력 (API 로드 실패)';
      return;
    }
    postcodeLayer.innerHTML = '';
    postcodeOverlay.classList.add('visible');
    postcodeOverlay.setAttribute('aria-hidden', 'false');
    new daum.Postcode({
      oncomplete: function (data) {
        const sido = (data.sido || '').trim();
        const sigungu = (data.sigungu || '').trim();
        const isSeoul = sido.indexOf('서울') !== -1;
        const isSeongnamBundang = sido.indexOf('경기') !== -1 && sigungu.indexOf('성남') !== -1 && sigungu.indexOf('분당') !== -1;
        if (!isSeoul && !isSeongnamBundang) {
          postcodeOverlay.classList.remove('visible');
          postcodeOverlay.setAttribute('aria-hidden', 'true');
          showUnsupportedRegionModal();
          return;
        }
        let addr = '';
        if (data.userSelectedType === 'R') {
          addr = data.roadAddress || data.autoRoadAddress || data.address || '';
        } else {
          addr = data.jibunAddress || data.autoJibunAddress || data.address || '';
        }
        if (!addr) addr = data.address || data.roadAddress || data.jibunAddress || '';
        inputDeliveryAddress.value = addr;
        postcodeOverlay.classList.remove('visible');
        postcodeOverlay.setAttribute('aria-hidden', 'true');
        detailAddressRow.style.display = '';
        inputDetailAddress.focus();
        updateOrderSubmitButton();
      },
      onresize: function (size) {
        postcodeLayer.style.height = size.height + 'px';
      },
      width: '100%',
      height: '100%',
    }).embed(postcodeLayer);
  }

  function closePostcode() {
    postcodeOverlay.classList.remove('visible');
    postcodeOverlay.setAttribute('aria-hidden', 'true');
  }

  inputDeliveryAddress.addEventListener('click', openPostcode);
  postcodeClose.addEventListener('click', closePostcode);
  postcodeOverlay.addEventListener('click', (e) => {
    if (e.target === postcodeOverlay) closePostcode();
  });
  inputDeliveryAddress.addEventListener('input', updateOrderSubmitButton);
  inputDeliveryAddress.addEventListener('change', updateOrderSubmitButton);
  inputDetailAddress.addEventListener('input', updateOrderSubmitButton);
  inputDetailAddress.addEventListener('change', updateOrderSubmitButton);

  btnOrderDetail.addEventListener('click', openOrderDetailOverlay);
  orderDetailClose.addEventListener('click', closeOrderDetailOverlay);
  orderDetailOverlay.addEventListener('click', (e) => {
    if (e.target === orderDetailOverlay) closeOrderDetailOverlay();
  });

  btnOrderSubmit.addEventListener('click', async () => {
      const token = window.BzCatAuth?.getToken();
      if (!token) {
        alert('로그인이 만료되었습니다. 다시 로그인해 주세요.');
        window.location.reload();
        return;
      }

      // 주문 데이터 준비
      const orderItems = Object.entries(cart).filter(([, qty]) => qty > 0).map(([itemId, qty]) => {
        const item = findItemById(itemId);
        return {
          id: itemId,
          name: item.name,
          price: item.price,
          quantity: qty,
        };
      });

      const categoryTotals = {};
      for (const { id, price, quantity } of orderItems) {
        const slug = getCategoryForItem(id);
        if (!categoryTotals[slug]) categoryTotals[slug] = 0;
        categoryTotals[slug] += price * quantity;
      }

      const orderData = {
        depositor: inputDepositor.value.trim(),
        contact: inputContact.value.trim(),
        expenseType: 'none',
        expenseDoc: null,
        deliveryAddress: inputDeliveryAddress.value.trim(),
        detailAddress: inputDetailAddress.value.trim() || null,
        orderItems: orderItems,
        totalAmount: calculateTotal(),
        categoryTotals,
      };

      btnOrderSubmit.disabled = true;
      btnOrderSubmit.textContent = '처리 중...';

      try {
        const response = await fetch('/api/orders/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(orderData),
        });

        const data = await response.json();

        if (!response.ok) {
          alert(data.error || '주문 처리에 실패했습니다.');
          btnOrderSubmit.disabled = false;
          btnOrderSubmit.textContent = '결제하기';
          return;
        }

        const orderId = data.order?.id;
        if (!orderId) {
          alert('주문 생성 후 주문 정보를 받지 못했습니다.');
          btnOrderSubmit.disabled = false;
          btnOrderSubmit.textContent = '결제하기';
          return;
        }

        const payRes = await fetch('/api/payment/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ orderId }),
        });
        const payData = await payRes.json().catch(() => ({}));

        if (!payRes.ok || !payData.checkoutUrl) {
          alert(payData.error || '결제 진행에 실패했습니다. 내 주문 보기에서 다시 결제하기를 시도할 수 있습니다.');
          btnOrderSubmit.disabled = false;
          btnOrderSubmit.textContent = '결제하기';
          return;
        }

        cart = {};
        pendingQty = {};
        updateCartCount();
        renderCartItems();
        renderMenuCards();
        closeCheckoutModal();
        window.location.href = payData.checkoutUrl;
      } catch (error) {
        console.error('Order/payment error:', error);
        alert('네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
        btnOrderSubmit.disabled = false;
        btnOrderSubmit.textContent = '결제하기';
      }
  });

  // ESC 키로 모달/오버레이 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (orderDetailOverlay.classList.contains('visible')) {
        closeOrderDetailOverlay();
      } else if (profileDrawer.classList.contains('open')) {
        closeProfile();
      } else {
        closeCart();
        closeCheckoutModal();
      }
    }
  });

  loadMenuData().then(async () => {
    const pathSeg = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || '';
    let initialSlug = null;
    if (pathSeg) {
      if (MENU_DATA[pathSeg]) initialSlug = pathSeg;
      else {
        const bySuburl = Object.keys(MENU_DATA).find((slug) => (MENU_DATA[slug].suburl || '') === pathSeg);
        if (bySuburl) initialSlug = bySuburl;
      }
    }
    renderCategoryTabs(initialSlug || undefined);
    const activeCategory = document.querySelector('.category-tab.active')?.dataset.category;
    if (activeCategory === '_recent') {
      await fetchRecentOrderItems();
    }
    renderMenuCards();
    renderCartItems();
    updateCartCount();
    if (initialSlug) {
      const base = window.location.origin + '/' + (window.location.search ? window.location.search : '') + (window.location.hash || '');
      window.history.replaceState({}, '', base);
    }
  });

  const params = new URLSearchParams(window.location.search);
  const paymentResult = params.get('payment');
  if (paymentResult === 'cancel') {
    const clearParam = () => {
      const u = new URL(window.location.href);
      u.searchParams.delete('payment');
      window.history.replaceState({}, '', u.pathname + (u.search || '') + (u.hash || ''));
    };
    openProfile().then(() => {
      alert('사용자의 요청에 의해 결제가 중지되었습니다.');
      clearParam();
    });
  } else if (paymentResult === 'success' || paymentResult === 'error') {
    const clearParam = () => {
      const u = new URL(window.location.href);
      u.searchParams.delete('payment');
      window.history.replaceState({}, '', u.pathname + (u.search || '') + (u.hash || ''));
    };
    openProfile().then(() => {
      clearParam();
    });
  }

  const orderAcceptResult = params.get('order_accept');
  if (orderAcceptResult === 'success' || orderAcceptResult === 'error' || orderAcceptResult === 'already') {
    const clearOrderAcceptParam = () => {
      const u = new URL(window.location.href);
      u.searchParams.delete('order_accept');
      window.history.replaceState({}, '', u.pathname + (u.search || '') + (u.hash || ''));
    };
    const msg = orderAcceptResult === 'success'
      ? '주문이 접수되었습니다.'
      : orderAcceptResult === 'already'
        ? '이미 처리된 주문입니다.'
        : '주문 접수 처리에 실패했습니다. 링크가 만료되었거나 잘못된 접근일 수 있습니다.';
    openProfile().then(() => {
      alert(msg);
      clearOrderAcceptParam();
    });
  }

  const orderRejectResult = params.get('order_reject');
  if (orderRejectResult === 'success' || orderRejectResult === 'error' || orderRejectResult === 'already') {
    const clearOrderRejectParam = () => {
      const u = new URL(window.location.href);
      u.searchParams.delete('order_reject');
      window.history.replaceState({}, '', u.pathname + (u.search || '') + (u.hash || ''));
    };
    const msgReject = orderRejectResult === 'success'
      ? '주문이 거부(취소)되었습니다.'
      : orderRejectResult === 'already'
        ? '이미 처리된 주문입니다.'
        : '거부 처리에 실패했습니다. 링크가 만료되었거나 잘못된 접근일 수 있습니다.';
    openProfile().then(() => {
      alert(msgReject);
      clearOrderRejectParam();
    });
  }

  // 내 주문 보기 직접 링크: #orders 또는 #profile 로 접속 시 로그인 여부와 관계없이 드로어 열기
  const hash = (window.location.hash || '').toLowerCase();
  if (hash === '#orders' || hash === '#profile') {
    openProfile();
  }

  // 프로필 설정 페이지: #settings 일 때 메인 대신 설정 화면 표시
  applySettingsRoute();
}

(function tickAppLoadingProgress() {
  document.querySelectorAll('.initial-load-spinner, .menu-loading, .profile-loading').forEach(function (el) {
    var start = el.getAttribute('data-loading-start');
    if (!start) {
      start = String(Date.now());
      el.setAttribute('data-loading-start', start);
    }
    var startNum = parseInt(start, 10);
    var p = Math.min(90, ((Date.now() - startNum) / 2000) * 90);
    var bar = el.querySelector('.loading-progress-bar');
    var pct = el.querySelector('.loading-progress-pct');
    if (bar) bar.style.width = p + '%';
    if (pct) pct.textContent = Math.round(p) + '%';
  });
  setTimeout(tickAppLoadingProgress, 150);
})();

init();
