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

function formatPrice(price) {
  return Number(price).toLocaleString() + '원';
}

function formatOrderDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}. ${m}. ${day} ${h}:${min}`;
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
 */
function getStoreEmailForOrder(order, stores) {
  const store = getStoreForOrder(order, stores);
  const email = (store?.storeContactEmail || '').trim();
  return email || null;
}

/**
 * 주문 내역 메일 HTML 생성 (내 주문 보기와 동일한 정보 수준)
 * @param {object} order - 주문 객체
 * @param {object[]} stores - 매장 목록
 * @param {object} [options] - { acceptUrl, rejectUrlSchedule, rejectUrlCooking, rejectUrlOther }
 */
function buildOrderNotificationHtml(order, stores, options = {}) {
  const acceptUrl = (options.acceptUrl || '').trim() || '#';
  const rejectUrlSchedule = (options.rejectUrlSchedule || '').trim() || '#';
  const rejectUrlCooking = (options.rejectUrlCooking || '').trim() || '#';
  const rejectUrlOther = (options.rejectUrlOther || '').trim() || '#';
  const slugToTitle = {};
  for (const s of stores || []) {
    const id = (s.id || s.slug || '').toString();
    slugToTitle[id.toLowerCase()] = s.title || s.id || s.slug || id;
  }
  const getCategoryTitle = (slug) => slugToTitle[slug] || slug || '기타';

  const orderItems = order.order_items || order.orderItems || [];
  const byCategory = {};
  for (const oi of orderItems) {
    const itemId = (oi.id || '').toString();
    const slug = (itemId.split('-')[0] || 'default').toLowerCase();
    const name = oi.name || '';
    const price = Number(oi.price) || 0;
    const qty = Number(oi.quantity) || 0;
    if (qty <= 0) continue;
    if (!byCategory[slug]) byCategory[slug] = [];
    byCategory[slug].push({ name, price, qty });
  }
  for (const slug of Object.keys(byCategory)) {
    byCategory[slug].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
  }

  const categoryOrder = ['bento', 'side', 'salad', 'beverage', 'dessert'];
  const otherSlugs = Object.keys(byCategory).filter((s) => !categoryOrder.includes(s));
  const orderedSlugs = [...categoryOrder.filter((s) => byCategory[s]?.length), ...otherSlugs];

  const totalAmount = Number(order.total_amount ?? order.totalAmount) || 0;
  const depositor = escapeHtml(order.depositor || '—');
  const contact = escapeHtml(order.contact || '—');
  const deliveryDate = escapeHtml(order.delivery_date || order.deliveryDate || '—');
  const deliveryTime = escapeHtml(order.delivery_time || order.deliveryTime || '');
  const deliveryAddress = escapeHtml(order.delivery_address || order.deliveryAddress || '—');
  const detailAddress = escapeHtml(order.detail_address || order.detailAddress || '');
  const orderId = escapeHtml(order.id || '');
  const createdAt = formatOrderDate(order.created_at || order.createdAt);

  let rowsHtml = '';
  for (const slug of orderedSlugs) {
    const items = byCategory[slug] || [];
    const catTotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const catTitle = escapeHtml(getCategoryTitle(slug));
    rowsHtml += `
      <tr><td colspan="3" style="border-bottom:1px solid #eee; padding:10px 12px; font-weight:600; background:#f8f9fa;">${catTitle}</td></tr>
      ${items
        .map(
          (i) => `
      <tr>
        <td style="padding:8px 12px; border-bottom:1px solid #f0f0f0;">${escapeHtml(i.name)}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #f0f0f0; text-align:right;">${formatPrice(i.price)} × ${i.qty}</td>
        <td style="padding:8px 12px; border-bottom:1px solid #f0f0f0; text-align:right;">${formatPrice(i.price * i.qty)}</td>
      </tr>`
        )
        .join('')}
      <tr><td colspan="2" style="padding:6px 12px; text-align:right; font-weight:600;">소계</td><td style="padding:6px 12px; text-align:right;">${formatPrice(catTotal)}</td></tr>
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
    <h2 style="margin:0 0 8px; font-size:18px; color:#e67b19;">BzCat 신규 주문 안내</h2>
    <p style="margin:0 0 20px; color:#666;">아래 주문이 접수되었습니다. 확인 후 처리 부탁드립니다.</p>

    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; background:#fff; border:1px solid #e0e0e0; border-radius:8px; overflow:hidden;">
      <tr><td colspan="3" style="padding:12px; background:#f8f9fa; font-weight:600; border-bottom:1px solid #e0e0e0;">주문 내역</td></tr>
      <tr style="background:#fafafa;">
        <td style="padding:8px 12px; border-bottom:1px solid #eee; font-weight:600;">메뉴</td>
        <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:right; font-weight:600;">단가 × 수량</td>
        <td style="padding:8px 12px; border-bottom:1px solid #eee; text-align:right; font-weight:600;">금액</td>
      </tr>
      ${rowsHtml}
      <tr style="background:#f8f9fa;">
        <td colspan="2" style="padding:12px; font-weight:700;">총 결제 금액</td>
        <td style="padding:12px; text-align:right; font-weight:700; font-size:16px; color:#e67b19;">${formatPrice(totalAmount)}</td>
      </tr>
    </table>

    <table style="width:100%; border-collapse:collapse; margin-bottom:20px; background:#fff; border:1px solid #e0e0e0; border-radius:8px; overflow:hidden;">
      <tr><td colspan="2" style="padding:12px; background:#f8f9fa; font-weight:600; border-bottom:1px solid #e0e0e0;">주문 정보</td></tr>
      <tr><td style="padding:10px 12px; width:120px; border-bottom:1px solid #eee;">주문번호</td><td style="padding:10px 12px; border-bottom:1px solid #eee;">#${orderId}</td></tr>
      <tr><td style="padding:10px 12px; border-bottom:1px solid #eee;">주문일시</td><td style="padding:10px 12px; border-bottom:1px solid #eee;">${createdAt}</td></tr>
      <tr><td style="padding:10px 12px; border-bottom:1px solid #eee;">주문자명</td><td style="padding:10px 12px; border-bottom:1px solid #eee;">${depositor}</td></tr>
      <tr><td style="padding:10px 12px; border-bottom:1px solid #eee;">배송 희망일</td><td style="padding:10px 12px; border-bottom:1px solid #eee;">${deliveryDate} ${deliveryTime}</td></tr>
      <tr><td style="padding:10px 12px;">배송 주소</td><td style="padding:10px 12px;">${deliveryAddress}</td></tr>
    </table>

    <div style="margin-top:7px; margin-bottom:16px;">
      <a href="${acceptUrl.replace(/"/g, '&quot;')}" style="display:inline-block; padding:12px 24px; background:#e67b19; color:#fff; font-weight:600; text-decoration:none; border-radius:8px; font-size:0.9375rem;">주문 수령하기</a>
    </div>
    <div style="margin-bottom:20px; font-size:0.75rem; color:#999;">
      <a href="${rejectUrlSchedule.replace(/"/g, '&quot;')}" style="color:#999; text-decoration:underline; display:inline;">거부:스케줄문제</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="${rejectUrlCooking.replace(/"/g, '&quot;')}" style="color:#999; text-decoration:underline; display:inline;">거부:조리문제</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="${rejectUrlOther.replace(/"/g, '&quot;')}" style="color:#999; text-decoration:underline; display:inline;">거부:기타</a>
    </div>

    <p style="margin:0; color:#999; font-size:12px;">BzCat - 비즈니스 케이터링</p>
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
  buildOrderNotificationHtml,
};
