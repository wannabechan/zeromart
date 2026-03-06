/**
 * 단체 케이터링 주문 앱
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
    const res = await fetch('/api/menu-data');
    if (res.ok) {
      const data = await res.json();
      MENU_DATA = data;
      return true;
    }
  } catch (e) {
    console.warn('Menu data load failed:', e);
  }
  return false;
}

// 장바구니 상태: { [itemId]: quantity }
let cart = {};
// 메뉴 카드에 설정한 담을 수량 (담기 버튼으로 이만큼 담음)
let pendingQty = {};

// DOM 요소
const categoryTabs = document.getElementById('categoryTabs');
const categoryNotice = document.getElementById('categoryNotice');
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
const cartMinOrderNotice = document.getElementById('cartMinOrderNotice');
const btnCheckout = document.getElementById('btnCheckout');
const checkoutModal = document.getElementById('checkoutModal');
const checkoutClose = document.getElementById('checkoutClose');
const checkoutAmount = document.getElementById('checkoutAmount');
const checkoutOrderTime = document.getElementById('checkoutOrderTime');
const inputDepositor = document.getElementById('inputDepositor');
const inputContact = document.getElementById('inputContact');
const checkoutForm = document.getElementById('checkoutForm');
const inputDeliveryDate = document.getElementById('inputDeliveryDate');
const inputDeliveryTime = document.getElementById('inputDeliveryTime');
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
let profileIncludeCancelled = true;
const PROFILE_PAGE_SIZE = 10;

// 180초 무활동 시 API 재호출 + 주문 목록 영역만 다시 그리기
const PROFILE_IDLE_MS = 180000;
let profileIdleTimerId = null;
let profileIdleListenersAttached = false;

const ORDER_STATUS_STEPS = [
  { key: 'submitted', label: '신청완료' },
  { key: 'order_accepted', label: '결제준비중' },
  { key: 'payment_link_issued', label: '결제하기' },
  { key: 'payment_completed', label: '결제완료' },
  { key: 'delivery_completed', label: '배송완료' },
];
const PENDING_ORDER_STATUSES = ['submitted', 'order_accepted', 'payment_link_issued', 'payment_completed', 'shipping'];

// 유틸: 금액 포맷
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

// 유틸: 주문시간 포맷 (yy년 mm월 dd일 hh시 mm분)
function formatOrderTime(date) {
  const y = String(date.getFullYear()).slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}년 ${m}월 ${d}일 ${h}시 ${min}분`;
}

// 유틸: ISO 날짜를 간단 포맷 (yy년 mm월 dd일 | hh시 mm분)
function formatOrderDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const y = String(d.getFullYear()).slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}년 ${m}월 ${day}일 | ${h}시 ${min}분`;
}

// 유틸: 배송희망일 날짜만 (yy년 mm월 dd일)
function formatDeliveryDateOnly(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const y = String(d.getFullYear()).slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}년 ${m}월 ${day}일`;
}

// 유틸: 입금기한 표시용 (mm월 dd일 hh시 mm분)
function formatDeadlineShort(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${m}월 ${d}일 ${h}시 ${min}분`;
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
  return itemId.split('-')[0];
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
  const d = new Date(dateStr + 'T12:00:00');
  const dayOfWeek = d.getDay();
  return days.includes(dayOfWeek);
}

const DELIVERY_TIME_SLOTS = ['09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00'];

function setDeliveryTimeOptions(allowedSlots) {
  if (!inputDeliveryTime) return;
  const allowedSet = (allowedSlots && Array.isArray(allowedSlots) && allowedSlots.length > 0) ? new Set(allowedSlots) : null;
  const options = ['<option value="">선택</option>', ...DELIVERY_TIME_SLOTS.map((slot) => {
    const isAllowed = allowedSet === null || allowedSet.has(slot);
    if (isAllowed) return `<option value="${slot}">${slot}</option>`;
    return `<option value="" disabled>${slot}</option>`;
  })];
  inputDeliveryTime.innerHTML = options.join('');
}

function formatDeliveryDateDisplay(dateStr) {
  if (!dateStr) return '날짜 선택';
  const [y, m, d] = dateStr.split('-');
  return `${y}. ${parseInt(m, 10)}. ${parseInt(d, 10)}.`;
}

function renderDeliveryDatePickerPanel(panelEl, categorySlug) {
  const minStr = getMinDeliveryDate();
  const maxStr = getMaxDeliveryDate();
  const minDate = new Date(minStr + 'T12:00:00');
  const maxDate = new Date(maxStr + 'T12:00:00');
  const businessDays = (MENU_DATA[categorySlug]?.businessDays && Array.isArray(MENU_DATA[categorySlug].businessDays))
    ? MENU_DATA[categorySlug].businessDays
    : [0, 1, 2, 3, 4, 5, 6];
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  let html = '<div class="delivery-date-picker-grid">';
  weekdays.forEach((w) => { html += `<div class="delivery-date-picker-weekday">${w}</div>`; });
  const start = new Date(minDate);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(maxDate);
  end.setDate(end.getDate() + (6 - end.getDay()));
  let lastMonth = -1;
  let lastYear = -1;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t);
    const y = d.getFullYear();
    const monthNum = d.getMonth();
    const m = String(monthNum + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${day}`;
    const dayNum = d.getDate();
    if (monthNum !== lastMonth || y !== lastYear) {
      lastMonth = monthNum;
      lastYear = y;
      html += `<div class="delivery-date-picker-month" style="grid-column: 1 / -1;">${y}년 ${monthNum + 1}월</div>`;
    }
    const inRange = d >= minDate && d <= maxDate;
    const isBusiness = businessDays.includes(d.getDay());
    const enabled = inRange && isBusiness;
    if (enabled) {
      html += `<button type="button" class="delivery-date-cell delivery-date-cell--enabled" data-date="${dateStr}">${dayNum}</button>`;
    } else if (inRange) {
      html += `<span class="delivery-date-cell delivery-date-cell--disabled">${dayNum}</span>`;
    } else {
      html += `<span class="delivery-date-cell delivery-date-cell--disabled" aria-hidden="true">${dayNum}</span>`;
    }
  }
  html += '</div>';
  panelEl.innerHTML = html;
}

// 장바구니에 포함된 첫 매장의 결제정보
function getPaymentForCart() {
  const itemIds = Object.keys(cart).filter((id) => cart[id] > 0);
  const firstId = itemIds[0];
  if (!firstId) return MENU_DATA.bento?.payment || MENU_DATA_FALLBACK.bento.payment;
  const storeSlug = firstId.split('-')[0];
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
  renderMenuCards();
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

// 담기: 카드에 설정한 수량만큼 장바구니에 추가 (1카테고리만 허용)
function addToCartFromPending(itemId) {
  const qty = pendingQty[itemId] || 0;
  if (qty <= 0) return;
  const cartCategory = getCartCategory();
  const itemCategory = getCategoryForItem(itemId);
  if (cartCategory !== null && itemCategory !== cartCategory) {
    return; // 다른 카테고리 담기 불가
  }
  cart[itemId] = (cart[itemId] || 0) + qty;
  delete pendingQty[itemId];
  updateCartCount();
  renderMenuCards();
  renderCartItems();
}

// 카테고리 탭 렌더 (API 데이터 기반). initialSlug: suburl 접근 시 먼저 보여줄 카테고리 slug
function renderCategoryTabs(initialSlug) {
  const slugs = Object.keys(MENU_DATA);
  if (slugs.length === 0) {
    categoryTabs.innerHTML = '<p class="category-empty">등록된 카테고리가 없습니다.</p>';
    menuSectionTitle.textContent = '';
    menuGrid.innerHTML = '';
    return;
  }
  const firstSlug = (initialSlug && slugs.includes(initialSlug)) ? initialSlug : slugs[0];
  categoryTabs.innerHTML = slugs
    .map((slug) => {
      const title = escapeHtml(MENU_DATA[slug]?.title || slug);
      const slugEsc = escapeHtml(slug);
      const active = slug === firstSlug ? ' active' : '';
      return `<button class="category-tab${active}" data-category="${slugEsc}">${title}</button>`;
    })
    .join('');
}

// 메뉴 카드 렌더
function renderMenuCards() {
  const slugs = Object.keys(MENU_DATA);
  const category = document.querySelector('.category-tab.active')?.dataset.category || slugs[0];
  const data = MENU_DATA[category];
  if (!data) {
    menuSectionTitle.textContent = slugs.length ? '카테고리를 선택하세요' : '';
    menuGrid.innerHTML = '';
    return;
  }

  const brand = escapeHtml(data.brand || '');
  const bizNo = escapeHtml(data.bizNo || '');
  const titleEscaped = escapeHtml(data.title || '');
  if (brand || bizNo) {
    menuSectionTitle.innerHTML = titleEscaped + '   <span class="menu-section-madeby">made by ' + brand + ' (' + bizNo + ')</span>';
  } else {
    menuSectionTitle.textContent = data.title;
  }
  const emoji = getCategoryEmoji(category);

  const items = data.items || [];
  const cartCategory = getCartCategory();
  const canAddFromCategory = cartCategory === null || category === cartCategory;

  menuGrid.innerHTML = items
    .map((item) => {
      const qty = canAddFromCategory ? (pendingQty[item.id] || 0) : 0;
      const addDisabled = canAddFromCategory ? qty === 0 : false;
      const qtyDisabled = !canAddFromCategory;
      const idEsc = escapeHtml(item.id);
      const nameEsc = escapeHtml(item.name);
      const descEsc = escapeHtml(item.description || '상세 설명이 없습니다.');
      const imgSrc = safeImageUrl(item.imageUrl);
      const imgContent = imgSrc
        ? `<div class="menu-card-image"><img src="${escapeHtml(imgSrc)}" alt="" class="menu-card-img" onerror="this.outerHTML='<span class=\\'menu-card-emoji\\'>${emoji}</span>'"></div>`
        : `<div class="menu-card-image">${emoji}</div>`;
      return `
        <article class="menu-card" data-id="${idEsc}">
          <div class="menu-card-image-wrapper" role="button" tabindex="0" aria-label="상세 정보 보기">
            ${imgContent}
            <div class="menu-info-overlay" data-id="${idEsc}">
              <p>${descEsc}</p>
            </div>
          </div>
          <div class="menu-card-body">
            <h3 class="menu-card-name">${nameEsc}</h3>
            <p class="menu-card-price">${formatPrice(item.price)}</p>
            <div class="menu-card-actions">
              <div class="menu-qty-controls">
                <button type="button" class="menu-qty-btn${qtyDisabled ? ' menu-qty-btn--other-category' : ''}" data-action="decrease" data-id="${idEsc}" ${!qtyDisabled && qty === 0 ? 'disabled' : ''}>−</button>
                <span class="menu-qty-value">${qty}</span>
                <button type="button" class="menu-qty-btn${qtyDisabled ? ' menu-qty-btn--other-category' : ''}" data-action="increase" data-id="${idEsc}" ${qtyDisabled ? '' : ''}>+</button>
              </div>
              <button class="menu-add-btn ${!canAddFromCategory ? 'menu-add-btn-other-category' : ''}" data-id="${idEsc}" ${addDisabled && canAddFromCategory ? 'disabled' : ''} aria-label="장바구니 담기">
                <svg class="menu-add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
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

  const TOTAL_MIN = 100;
  const categoryTotals = {};
  for (const slug of Object.keys(byCategory)) {
    categoryTotals[slug] = byCategory[slug].reduce((sum, { item, qty }) => sum + item.price * qty, 0);
  }
  const totalMeetMin = total >= TOTAL_MIN;
  btnCheckout.classList.toggle('below-minimum', !totalMeetMin);

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
      const categoryTitle = escapeHtml(MENU_DATA[slug]?.title || slug);
      const catTotal = categoryTotals[slug] || 0;
      const meetMin = catTotal >= TOTAL_MIN;
      const totalClass = meetMin ? 'cart-category-total met' : 'cart-category-total below';
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

// 6일 후 ~ 45일 후 날짜 (배송희망날짜용)
function getMinDeliveryDate() {
  const d = new Date();
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}
function getMaxDeliveryDate() {
  const d = new Date();
  d.setDate(d.getDate() + 45);
  return d.toISOString().slice(0, 10);
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
  return renderOrderDetailByCategory(byCategory, categoryOrder);
}

function renderOrderSummaryFromOrderItems(orderItems) {
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
  return renderOrderDetailByCategory(byCategory, categoryOrder);
}

function renderOrderDetailByCategory(byCategory, categoryOrder) {
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
  return categoryOrder
    .filter((slug) => byCategory[slug]?.length)
    .map((slug) => {
      const categoryTitle = escapeHtml(MENU_DATA[slug]?.title || slug);
      const catTotal = categoryTotals[slug] || 0;
      const itemsHtml = byCategory[slug].map(renderDetailItem).join('');
      return `
        <div class="cart-category-group">
          <div class="cart-category-header">
            <span class="cart-category-title">${categoryTitle}</span>
            <span class="cart-category-total met">${formatPrice(catTotal)}</span>
          </div>
          ${itemsHtml}
        </div>
      `;
    })
    .join('');
}

// 결제 모달 열기
function openCheckoutModal() {
  const total = calculateTotal();
  const entries = Object.entries(cart).filter(([, qty]) => qty > 0);
  const orderTime = new Date();

  checkoutOrderTime.textContent = formatOrderTime(orderTime);
  checkoutAmount.textContent = formatPrice(total);

  orderDetailContent.innerHTML = `<div class="order-detail-list order-detail-cart-style">${renderOrderSummaryList(entries)}</div>`;

  const orderDetailPanel = orderDetailOverlay.querySelector('.order-detail-panel');
  if (orderDetailPanel) orderDetailPanel.classList.remove('order-detail-cancelled');
  const pdfBtn = document.getElementById('orderDetailPdfBtn');
  if (pdfBtn) {
    pdfBtn.href = '#';
    pdfBtn.style.display = 'none';
  }
  const orderDetailTotalEl = document.getElementById('orderDetailTotal');
  if (orderDetailTotalEl) orderDetailTotalEl.textContent = formatPrice(total);

  inputDepositor.value = '';
  inputContact.value = '';
  inputDeliveryDate.value = '';
  const cartCategory = getCartCategory();
  const businessHours = cartCategory != null && MENU_DATA[cartCategory]?.businessHours ? MENU_DATA[cartCategory].businessHours : null;
  setDeliveryTimeOptions(businessHours);
  inputDeliveryTime.value = '';
  inputDeliveryAddress.value = '';
  detailAddressRow.style.display = 'none';
  inputDetailAddress.value = '';
  const deliveryDatePickerDisplay = document.getElementById('deliveryDatePickerDisplay');
  if (deliveryDatePickerDisplay) deliveryDatePickerDisplay.textContent = formatDeliveryDateDisplay(inputDeliveryDate.value);
  btnOrderSubmit.textContent = '주문 신청';
  btnOrderSubmit.disabled = true;

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
  profileIncludeCancelled = true;
  if (profileIncludeCancelledEl) profileIncludeCancelledEl.checked = true;
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
  const html = renderOrderSummaryFromOrderItems(order.orderItems || []);
  orderDetailContent.innerHTML = `<div class="order-detail-list order-detail-cart-style">${html}</div>`;
  const totalEl = document.getElementById('orderDetailTotal');
  if (totalEl) totalEl.textContent = formatPrice(order.totalAmount || 0);
  const panel = orderDetailOverlay.querySelector('.order-detail-panel');
  if (panel) panel.classList.toggle('order-detail-cancelled', order.status === 'cancelled');

  const pdfBtn = document.getElementById('orderDetailPdfBtn');
  if (pdfBtn) {
    pdfBtn.style.display = '';
    pdfBtn.href = '#';
    pdfBtn.textContent = order.status === 'cancelled' ? '주문서확인 (취소 건)' : '주문서확인';
    const orderIdForPdf = order.id;
    pdfBtn.onclick = async (e) => {
      e.preventDefault();
      const token = window.BzCatAuth?.getToken();
      if (!token) return;
      try {
        const res = await fetch(`/api/orders/pdf?orderId=${encodeURIComponent(orderIdForPdf)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (_) {}
    };
  }

  const cancelBtn = document.getElementById('orderDetailCancelBtn');
  const headerSep = document.getElementById('orderDetailHeaderSep');
  if (cancelBtn) {
    if (canCancelOrder(order.status)) {
      cancelBtn.style.display = '';
      cancelBtn.textContent = '취소하기';
      cancelBtn.onclick = () => handleOrderCancelClick(order);
      if (headerSep) headerSep.style.display = '';
    } else if (order.status === 'payment_completed') {
      cancelBtn.style.display = '';
      cancelBtn.textContent = '결제취소';
      cancelBtn.onclick = () => handlePaymentCancelClick(order);
      if (headerSep) headerSep.style.display = '';
    } else {
      cancelBtn.style.display = 'none';
      cancelBtn.onclick = null;
      if (headerSep) headerSep.style.display = 'none';
    }
  } else if (headerSep) {
    headerSep.style.display = 'none';
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
  if (isPastPaymentDeadline(order)) {
    alert('배송 준비중입니다. 결제 취소가 불가합니다.');
    return;
  }
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
  if (order.status === 'cancelled' || order.status === 'order_accepted' || order.status === 'payment_completed' || order.status === 'shipping' || order.status === 'delivery_completed') return false;
  return order.status === 'payment_link_issued';
}

function canCancelOrder(status) {
  return status !== 'cancelled' && ['submitted', 'order_accepted', 'payment_link_issued'].includes(status);
}

/** 배송 희망일 4일 전 23:59 KST를 지났는지 (결제 취소 불가 시점) */
function isPastPaymentDeadline(order) {
  const raw = order.delivery_date || order.deliveryDate || '';
  const s = String(raw).trim();
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
  const date = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
  date.setUTCDate(date.getUTCDate() - 4);
  date.setUTCHours(14, 59, 0, 0); // 23:59 KST
  return Date.now() > date.getTime();
}

function renderProfileOrdersList() {
  const orders = profileIncludeCancelled ? profileAllOrders : profileAllOrders.filter((o) => o.status !== 'cancelled');
  const visible = orders.slice(0, profileVisibleCount);
  const hasMore = orders.length > profileVisibleCount;

  const stepIndex = (status) => {
    if (status === 'shipping' || status === 'delivery_completed') return 4;
    return ORDER_STATUS_STEPS.findIndex((s) => s.key === status);
  };
  const isCancelled = (status) => status === 'cancelled';
  const canCancel = canCancelOrder;

  profileOrdersData = {};
  const CANCELABLE_STEP_COUNT = 1;

  const cardsHtml = visible
    .map((o) => {
      profileOrdersData[o.id] = o;
      const paymentLinkActive = isPaymentLinkActive(o);
      const cancelled = isCancelled(o.status);
      const currentIdx = cancelled ? -1 : stepIndex(o.status);
      const step4Label = o.status === 'delivery_completed' ? '배송완료' : '배송중';
      let stepsHtml;
      if (cancelled) {
        stepsHtml = ORDER_STATUS_STEPS.slice(0, CANCELABLE_STEP_COUNT)
          .map((s) => `<span class="step done">${s.label}</span>`)
          .join('');
      } else {
        stepsHtml = ORDER_STATUS_STEPS.map((s, i) => {
          let cls = 'step';
          if (i < currentIdx) cls += ' done';
          else if (i === currentIdx) cls += ' active';
          else cls += ' pending';
          
          if (s.key === 'payment_link_issued' && paymentLinkActive) {
            cls += ' payment-link-ready';
          }
          const label = (i === 4) ? step4Label : s.label;
          return `<span class="${cls}" ${s.key === 'payment_link_issued' && paymentLinkActive ? `data-action="open-payment-link"` : ''}>${label}</span>`;
        }).join('');
      }
      const orderIdEsc = escapeHtml(String(o.id));
      return `
        <div class="profile-order-card" data-order-id="${orderIdEsc}">
          <div class="profile-order-card-header">
            <div class="profile-order-header-left">
              <span class="profile-order-id">주문 #${orderIdEsc}</span>
              <div class="profile-order-actions">
                <button type="button" class="profile-btn profile-btn-detail" data-action="detail">주문내역</button>
              </div>
            </div>
            <span class="profile-order-status ${cancelled ? 'cancelled' : ''} ${o.status === 'delivery_completed' ? 'delivered' : ''}">${escapeHtml(o.statusLabel || '')}</span>
          </div>
          <div class="profile-order-date">주문일시 : ${formatOrderDate(o.createdAt)}<br>배송희망일 : ${formatDeliveryDateOnly(o.deliveryDate)}</div>
          <div class="profile-order-status-steps">${stepsHtml}</div>
          <div class="profile-order-amount ${cancelled ? 'cancelled' : ''} ${o.status === 'delivery_completed' ? 'delivered' : ''}">${formatPrice(o.totalAmount || 0)}</div>
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
  profileEmpty.innerHTML = '<p>로딩 중...</p>';

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

// 카테고리 탭 클릭
function handleCategoryClick(e) {
  const tab = e.target.closest('.category-tab');
  if (!tab) return;
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
    const cartCategory = getCartCategory();
    const itemCategory = getCategoryForItem(id);
    if (cartCategory !== null && itemCategory !== cartCategory) {
      if (categoryNotice) {
        categoryNotice.classList.remove('notice-blink');
        void categoryNotice.offsetWidth;
        categoryNotice.classList.add('notice-blink');
        setTimeout(() => categoryNotice.classList.remove('notice-blink'), 1200);
      }
      return;
    }
    const action = qtyBtn.dataset.action;
    setPendingQty(id, action === 'increase' ? 1 : -1);
    return;
  }
  const addBtn = e.target.closest('.menu-add-btn');
  if (addBtn) {
    if (!window.BzCatAuth?.getToken()) {
      openLoginRequiredModal();
      return;
    }
    const itemId = addBtn.dataset.id;
    const cartCategory = getCartCategory();
    const itemCategory = getCategoryForItem(itemId);
    if (cartCategory !== null && itemCategory !== cartCategory) {
      if (categoryNotice) {
        categoryNotice.classList.remove('notice-blink');
        void categoryNotice.offsetWidth;
        categoryNotice.classList.add('notice-blink');
        setTimeout(() => categoryNotice.classList.remove('notice-blink'), 1200);
      }
      return;
    }
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
  };
  profileToggle.addEventListener('click', openProfile);
  profileClose.addEventListener('click', closeProfile);
  profileOverlay.addEventListener('click', (e) => {
    if (e.target === profileOverlay) closeProfile();
  });
  if (profileIncludeCancelledEl) {
    profileIncludeCancelledEl.addEventListener('change', () => {
      profileIncludeCancelled = profileIncludeCancelledEl.checked;
      renderProfileOrdersList();
      const profileContent = document.getElementById('profileContent');
      if (profileContent) profileContent.scrollTop = 0;
    });
  }
  profileOrders.addEventListener('click', (e) => {
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
    const total = calculateTotal();
    const TOTAL_MIN = 100;
    if (total < TOTAL_MIN) {
      cartMinOrderNotice.classList.remove('notice-blink');
      cartMinOrderNotice.offsetHeight;
      cartMinOrderNotice.classList.add('notice-blink');
      setTimeout(() => cartMinOrderNotice.classList.remove('notice-blink'), 1200);
      return;
    }
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
    const hasDate = (inputDeliveryDate.value || '').trim().length > 0;
    const hasTime = (inputDeliveryTime.value || '').trim().length > 0;
    const hasAddress = (inputDeliveryAddress.value || '').trim().length > 0;
    const detailRowVisible = detailAddressRow.style.display !== 'none';
    const hasDetailAddress = !detailRowVisible || (inputDetailAddress.value || '').trim().length > 0;
    btnOrderSubmit.disabled = !(hasName && hasContact && hasDate && hasTime && hasAddress && hasDetailAddress);
  }
  inputDepositor.addEventListener('input', updateOrderSubmitButton);
  inputDepositor.addEventListener('change', updateOrderSubmitButton);
  inputContact.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
    updateOrderSubmitButton();
  });
  inputContact.addEventListener('change', updateOrderSubmitButton);
  const deliveryDatePickerDisplay = document.getElementById('deliveryDatePickerDisplay');
  const deliveryDatePickerPanel = document.getElementById('deliveryDatePickerPanel');
  function openDeliveryDatePicker() {
    const category = getCartCategory() || Object.keys(MENU_DATA)[0];
    if (deliveryDatePickerPanel) {
      renderDeliveryDatePickerPanel(deliveryDatePickerPanel, category);
      deliveryDatePickerPanel.classList.add('open');
      deliveryDatePickerDisplay?.setAttribute('aria-expanded', 'true');
      setTimeout(() => document.addEventListener('click', closeDeliveryDatePickerOnOutside), 0);
    }
  }
  function closeDeliveryDatePicker() {
    if (deliveryDatePickerPanel) {
      deliveryDatePickerPanel.classList.remove('open');
      deliveryDatePickerDisplay?.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', closeDeliveryDatePickerOnOutside);
    }
  }
  function closeDeliveryDatePickerOnOutside(e) {
    if (deliveryDatePickerPanel?.classList.contains('open') && !deliveryDatePickerPanel.contains(e.target) && !deliveryDatePickerDisplay?.contains(e.target)) {
      closeDeliveryDatePicker();
    }
  }
  deliveryDatePickerDisplay?.addEventListener('click', (e) => { e.stopPropagation(); openDeliveryDatePicker(); });
  deliveryDatePickerDisplay?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDeliveryDatePicker(); } });
  deliveryDatePickerPanel?.addEventListener('click', (e) => {
    const btn = e.target.closest('.delivery-date-cell--enabled');
    if (btn && btn.dataset.date) {
      inputDeliveryDate.value = btn.dataset.date;
      if (deliveryDatePickerDisplay) deliveryDatePickerDisplay.textContent = formatDeliveryDateDisplay(btn.dataset.date);
      closeDeliveryDatePicker();
      updateOrderSubmitButton();
    }
  });
  inputDeliveryTime.addEventListener('input', updateOrderSubmitButton);
  inputDeliveryTime.addEventListener('change', updateOrderSubmitButton);
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
        deliveryDate: inputDeliveryDate.value,
        deliveryTime: inputDeliveryTime.value,
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
          return;
        }

        showOrderAcceptedModal(() => {
          cart = {};
          pendingQty = {};
          updateCartCount();
          renderCartItems();
          renderMenuCards();
          closeCheckoutModal();
          openProfile();
        });

      } catch (error) {
        console.error('Order submission error:', error);
        alert('네트워크 오류가 발생했습니다. 다시 시도해 주세요.');
      } finally {
        btnOrderSubmit.disabled = false;
        btnOrderSubmit.textContent = '주문 신청';
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

  loadMenuData().then(() => {
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
}

init();
