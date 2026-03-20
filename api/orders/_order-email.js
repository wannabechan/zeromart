/**
 * 신규 주문 접수 시 매장 담당자 이메일로 발송할 주문 내역 메일 본문 생성
 * (내 주문 보기 페이지의 주문 내역과 동일한 수준으로 구성)
 */

function escapeHtml(str) {
  if (str == null || str === '') return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 주문 상품 id에서 매장(대분류) 키 추출.
 * 어드민 generateId: `${storeId}-${Date.now().toString(36)}-${random4}` 형태이므로
 * storeId에 하이픈이 있으면(예: store-m5abc) split('-')[0] === 'store'로 여러 매장이 한 덩어리로 묶이는 문제가 생김.
 * 마지막 두 세그먼트(타임스탬프·랜덤)를 제거한 접두사를 매장 키로 사용.
 */
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

/**
 * 주문서·주문관리 등 매장 구역 헤더: 대분류명(브랜드명). 브랜드가 없거나 대분류와 같으면 대분류만.
 */
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

function formatOrderDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}. ${get('month')}. ${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * 주문에 해당하는 매장 객체 반환 (없으면 null)
 * 주문 첫 상품 id가 매장 id(또는 slug)로 시작하는 매장을 찾고, 여러 개면 id가 가장 긴(가장 구체적인) 매장을 반환.
 */
function getStoreForOrder(order, stores) {
  const items = order.order_items || order.orderItems || [];
  if (!Array.isArray(items) || items.length === 0) return null;
  const firstId = (items[0].id || '').toLowerCase();
  if (!firstId) return null;
  const match = (s) => {
    const id = (s.id || '').toLowerCase();
    const slug = (s.slug || '').toLowerCase();
    if (!id && !slug) return false;
    const prefix = id || slug;
    return firstId === prefix || firstId.startsWith(prefix + '-');
  };
  const candidates = stores.filter(match);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  candidates.sort((a, b) => (b.id || b.slug || '').length - (a.id || a.slug || '').length);
  return candidates[0];
}

/**
 * 매장 표시명 반환 (알림톡·메일 등에서 사용)
 */
function getStoreDisplayName(store) {
  if (!store) return '주문';
  return (store.brand || store.title || store.id || store.slug || '').trim() || '주문';
}

/**
 * 주문에 해당하는 매장의 담당자 이메일 반환 (없으면 null)
 * 단일 매장 주문 시 사용. 복수 매장 주문 시에는 getStoresWithItemsInOrder 사용.
 */
function getStoreEmailForOrder(order, stores) {
  const store = getStoreForOrder(order, stores);
  const email = (store?.storeContactEmail || '').trim();
  return email || null;
}

/**
 * 주문 상품을 매장(대분류)별로 묶어 반환. item.id에서 getOrderItemStoreKey로 slug 추출.
 * @returns {Record<string, object[]>} { [slug]: orderItems }
 */
function getOrderItemsByStore(order) {
  const items = order.order_items || order.orderItems || [];
  const byStore = {};
  for (const item of items) {
    const slug = getOrderItemStoreKey(item.id);
    if (!byStore[slug]) byStore[slug] = [];
    byStore[slug].push(item);
  }
  return byStore;
}

/**
 * 복수 카테고리 주문 시, 주문에 상품이 포함된 각 매장별로 { store, slug, items } 배열 반환.
 * slug 오름차순 정렬하여 -1, -2 넘버링이 항상 동일 매장에 매핑되도록 함.
 */
function getStoresWithItemsInOrder(order, stores) {
  const byStore = getOrderItemsByStore(order);
  const slugs = Object.keys(byStore).filter(Boolean).sort();
  const result = [];
  const storeMap = {};
  for (const s of stores || []) {
    const id = (s.id || s.slug || '').toString().toLowerCase();
    if (id) storeMap[id] = s;
  }
  for (const slug of slugs) {
    result.push({ store: storeMap[slug] || null, slug, items: byStore[slug] });
  }
  return result;
}

/**
 * 주문 번호 표기: 1개 카테고리 → #orderId-1, 복수 카테고리 → #orderId-1, #orderId-2, ...
 */
function getOrderNumberDisplay(order) {
  const id = order?.id ?? '';
  const byStore = getOrderItemsByStore(order || {});
  const slugs = Object.keys(byStore).filter(Boolean).sort();
  const n = slugs.length || 1;
  if (n <= 1) return `#${id}-1`;
  return slugs.map((_, i) => `#${id}-${i + 1}`).join(', ');
}

/** 매장 순서(0-based index)에 해당하는 주문 번호. getStoresWithItemsInOrder 순서와 동일해야 함 */
function getOrderNumberForStoreIndex(orderId, storeIndex) {
  return `#${orderId}-${Number(storeIndex) + 1}`;
}

/**
 * 주문 내역 메일 HTML 생성 (결제 완료 시 매장 담당자 발송용)
 * 주문 내역: 메뉴명·수량만. 주문자=매장명(이름), 배송주소=기본주소/상세주소, 버튼=주문서 인쇄
 * @param {object} order - 주문 객체
 * @param {object[]} stores - 매장 목록
 * @param {object} [options] - { pdfUrl, profileStoreName, orderNumberDisplay } (orderNumberDisplay = 주문번호 표기, 예: #260307011-1)
 */
function buildOrderNotificationHtml(order, stores, options = {}) {
  const pdfUrl = (options.pdfUrl || '').trim() || '#';
  const store = getStoreForOrder(order, stores);
  const storeDisplayName = getStoreDisplayName(store);
  const profileStoreName = (options.profileStoreName || '').trim() || storeDisplayName;
  const orderNumberDisplay = (options.orderNumberDisplay || getOrderNumberDisplay(order)).replace(/^#?/, '#');
  const slugToTitle = {};
  for (const s of stores || []) {
    const label = formatStoreSectionLabel(s.title, s.brand, (s.slug || s.id || '').toString());
    const keys = new Set();
    if (s.id) keys.add(String(s.id).toLowerCase());
    if (s.slug) keys.add(String(s.slug).toLowerCase());
    for (const k of keys) {
      if (k) slugToTitle[k] = label;
    }
  }
  const getCategoryTitle = (slug) => slugToTitle[slug] || slug || '기타';

  const orderItems = order.order_items || order.orderItems || [];
  const byCategory = {};
  for (const oi of orderItems) {
    const itemId = (oi.id || '').toString();
    const slug = getOrderItemStoreKey(itemId);
    const name = oi.name || '';
    const qty = Number(oi.quantity) || 0;
    if (qty <= 0) continue;
    if (!byCategory[slug]) byCategory[slug] = [];
    byCategory[slug].push({ name, qty });
  }
  for (const slug of Object.keys(byCategory)) {
    byCategory[slug].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
  }

  const categoryOrder = ['bento', 'side', 'salad', 'beverage', 'dessert'];
  const otherSlugs = Object.keys(byCategory).filter((s) => !categoryOrder.includes(s));
  const orderedSlugs = [...categoryOrder.filter((s) => byCategory[s]?.length), ...otherSlugs];

  const ordererDisplay = escapeHtml(`${profileStoreName} / ${order.depositor || '—'}`);
  const baseAddr = (order.delivery_address || order.deliveryAddress || '').trim();
  const detailAddr = (order.detail_address || order.detailAddress || '').trim();
  const deliveryDisplay = escapeHtml([baseAddr, detailAddr].filter(Boolean).join(' / ') || '—');
  const orderIdDisplay = escapeHtml(orderNumberDisplay);
  const createdAt = formatOrderDate(order.created_at || order.createdAt);

  let rowsHtml = '';
  for (const slug of orderedSlugs) {
    const items = byCategory[slug] || [];
    const catTitle = escapeHtml(getCategoryTitle(slug));
    rowsHtml += `
      <tr><td colspan="2" style="border-bottom:1px solid #eee; padding:10px 12px; font-weight:600; background:#F5F5F5;">${catTitle}</td></tr>
      ${items
        .map(
          (i) => `
      <tr>
        <td style="padding:8px 12px; border-bottom:1px solid #f0f0f0;">${escapeHtml(i.name)}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #f0f0f0; text-align:right;">${i.qty}</td>
      </tr>`
        )
        .join('')}
    `;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; font-family:'Noto Sans KR', -apple-system, BlinkMacSystemFont, sans-serif; font-size:14px; line-height:1.5; color:#333;">
  <div style="max-width:600px; margin:0 auto; padding:24px;">
    <h2 style="margin:0 0 8px; font-size:18px; color:#2C2C2C;">Zero Mart 신규 주문 안내</h2>
    <p style="margin:0 0 20px; color:#666;">아래 주문이 결제 완료되었습니다. 확인 후 처리 부탁드립니다.</p>

    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; background:#fff; border:1px solid #DADADA; border-radius:8px; overflow:hidden;">
      <tr><td colspan="2" style="padding:12px; background:#F5F5F5; font-weight:600; border-bottom:1px solid #DADADA;">주문 내역</td></tr>
      <tr style="background:#fafafa;">
        <td style="padding:8px 12px; border-bottom:1px solid #eee; font-weight:600;">메뉴</td>
        <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:right; font-weight:600;">수량</td>
      </tr>
      ${rowsHtml}
    </table>

    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; background:#fff; border:1px solid #DADADA; border-radius:8px; overflow:hidden;">
      <tr><td colspan="2" style="padding:12px; background:#F5F5F5; font-weight:600; border-bottom:1px solid #DADADA;">주문 정보</td></tr>
      <tr><td style="padding:10px 12px; width:120px; border-bottom:1px solid #eee;">주문번호</td><td style="padding:10px 12px; border-bottom:1px solid #eee;">${orderIdDisplay}</td></tr>
      <tr><td style="padding:10px 12px; border-bottom:1px solid #eee;">주문일시</td><td style="padding:10px 12px; border-bottom:1px solid #eee;">${createdAt}</td></tr>
      <tr><td style="padding:10px 12px; border-bottom:1px solid #eee;">주문자</td><td style="padding:10px 12px; border-bottom:1px solid #eee;">${ordererDisplay}</td></tr>
      <tr><td style="padding:10px 12px;">배송주소</td><td style="padding:10px 12px;">${deliveryDisplay}</td></tr>
    </table>

    <div style="margin-top:7px; margin-bottom:20px;">
      <a href="${pdfUrl.replace(/"/g, '&quot;')}" style="display:inline-block; padding:12px 24px; background:#2C2C2C; color:#fff; font-weight:600; text-decoration:none; border-radius:8px; font-size:0.9375rem;">주문서 인쇄</a>
    </div>

    <p style="margin:0; color:#999; font-size:12px;">Zero Mart - B2B 식자재 주문</p>
  </div>
</body>
</html>
  `.trim();

  return html;
}

module.exports = {
  getStoreForOrder,
  getStoreDisplayName,
  getStoreEmailForOrder,
  getOrderItemStoreKey,
  formatStoreSectionLabel,
  getOrderItemsByStore,
  getStoresWithItemsInOrder,
  getOrderNumberDisplay,
  getOrderNumberForStoreIndex,
  buildOrderNotificationHtml,
};
