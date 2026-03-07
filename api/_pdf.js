/**
 * 주문서 PDF 생성 (정식 주문서 형식)
 * 순서: 1. 주문 내역, 2. 주문자 정보, 3. 기타
 */

const PDFDocument = require('pdfkit');
const { getStoreForOrder, getStoreDisplayName } = require('./orders/_order-email');
const { getProfileSettings } = require('./_redis');
const path = require('path');
const fs = require('fs');

const DEFAULT_CATEGORY_TITLES = {
  bento: '도시락',
  side: '반찬',
  salad: '샐러드',
  beverage: '음료',
  dessert: '디저트',
};

const MARGIN = 50;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_HEIGHT - MARGIN;

function formatPrice(price) {
  return Number(price).toLocaleString() + '원';
}

function formatDateKST(isoStr) {
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
  return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

async function generateOrderPdf(order, stores = [], options = {}) {
  const isCancelled = options.isCancelled === true;
  const slugToTitle = {};
  for (const s of stores) {
    slugToTitle[s.slug || s.id] = s.title || s.id;
  }
  const getCategoryTitle = (slug) => slugToTitle[slug] || DEFAULT_CATEGORY_TITLES[slug] || slug;

  const orderItems = order.order_items || [];
  const byCategory = {};
  for (const oi of orderItems) {
    const itemId = oi.id || '';
    const slug = (itemId.split('-')[0] || 'default').toLowerCase();
    const item = { name: oi.name || '', price: oi.price || 0, qty: oi.quantity || 0 };
    if (!byCategory[slug]) byCategory[slug] = [];
    byCategory[slug].push(item);
  }
  for (const slug of Object.keys(byCategory)) {
    byCategory[slug].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
  }

  const categoryOrder = ['bento', 'side', 'salad', 'beverage', 'dessert'];
  const knownSlugs = categoryOrder.filter((s) => byCategory[s]?.length);
  const otherSlugs = Object.keys(byCategory).filter((s) => !categoryOrder.includes(s));
  const orderedSlugs = [...knownSlugs, ...otherSlugs];

  const profile = await getProfileSettings(order.user_email || '');
  const store = getStoreForOrder(order, stores);
  const storeDisplayName = getStoreDisplayName(store);
  const profileStoreName = (profile?.storeName || '').trim() || storeDisplayName;
  const deliveryAddr = [order.delivery_address, order.detail_address].filter(Boolean).join(' / ') || '—';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fontPath = path.join(__dirname, 'fonts', 'NotoSansKR-VariableFont_wght.ttf');
    const useKorean = fs.existsSync(fontPath);
    if (useKorean) {
      doc.registerFont('NotoSansKR', fontPath);
      doc.font('NotoSansKR');
    }

    doc.fillColor('#000');
    let y = MARGIN;

    // ===== 헤더 =====
    doc.fontSize(24);
    doc.text('Zero Mart', MARGIN, y, { align: 'center', width: CONTENT_WIDTH });
    doc.fontSize(14);
    y = doc.y + 4;
    doc.text(isCancelled ? 'B2B 식자재 주문서 (취소 건)' : 'B2B 식자재 주문서', MARGIN, y, { align: 'center', width: CONTENT_WIDTH });
    y = doc.y + 20;

    // 구분선
    doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke('#ddd');
    y += 16;

    const col1 = MARGIN + 12;
    const col2 = MARGIN + 280;
    const col3 = MARGIN + 360;
    const col4 = MARGIN + 440;

    function ensureSpace(needed) {
      if (y + needed > BOTTOM_LIMIT - 30) {
        doc.addPage();
        y = MARGIN;
        drawTableHeader();
      }
    }

    function drawHLine(atY, color = '#ccc') {
      doc.strokeColor(color).lineWidth(0.5).moveTo(MARGIN, atY).lineTo(MARGIN + CONTENT_WIDTH, atY).stroke();
    }

    function drawTableHeader() {
      drawHLine(y, '#ccc');
      doc.fillColor('#000').fontSize(9);
      if (!useKorean) doc.font('Helvetica-Bold');
      doc.text('메뉴명', col1, y + 8);
      doc.text('수량', col2, y + 8);
      doc.text('단가', col3, y + 8);
      doc.text('금액', col4, y + 8);
      if (useKorean) doc.font('NotoSansKR');
      y += 24;
      drawHLine(y, '#ccc');
    }

    doc.fontSize(12);
    if (!useKorean) doc.font('Helvetica-Bold');
    doc.text('1. 주문 내역', MARGIN, y);
    if (useKorean) doc.font('NotoSansKR');
    y += 20;

    ensureSpace(24);
    drawTableHeader();

    let rowNum = 0;
    for (const slug of orderedSlugs) {
      const title = getCategoryTitle(slug);
      ensureSpace(20);
      drawHLine(y, '#ddd');
      doc.fontSize(10).fillColor('#000');
      if (!useKorean) doc.font('Helvetica-Bold');
      else doc.font('NotoSansKR');
      doc.text(`[${title}]`, col1, y + 6);
      if (!useKorean) doc.font('Helvetica');
      if (useKorean) doc.font('NotoSansKR');
      y += 20;
      drawHLine(y, '#ddd');
      rowNum++;

      for (const item of byCategory[slug]) {
        const lineTotal = Number(item.price || 0) * Number(item.qty || 0);
        const rowH = 18;
        ensureSpace(rowH);
        doc.fontSize(9).fillColor('#000');
        doc.text(`- ${String(item.name || '')}`, col1, y + 5, { width: col2 - col1 - 8 });
        doc.text(String(item.qty || 0), col2, y + 5);
        doc.text(formatPrice(item.price || 0), col3, y + 5);
        doc.text(formatPrice(lineTotal), col4, y + 5, { width: 55, align: 'right' });
        y += rowH;
        drawHLine(y, '#eee');
        rowNum++;
      }
    }

    // 총 금액 행
    ensureSpace(36);
    y += 8;
    drawHLine(y, '#ccc');
    doc.fontSize(10).fillColor('#000');
    if (!useKorean) doc.font('Helvetica-Bold');
    doc.text('총 주문 금액', col1, y + 9);
    doc.fontSize(9);
    doc.text(formatPrice(order.total_amount || 0), col4, y + 10, { width: 55, align: 'right', lineBreak: false });
    if (useKorean) doc.font('NotoSansKR');
    y += 28;
    drawHLine(y, '#ccc');

    // ===== 2. 주문자 정보 =====
    const section2And3Height = 220;
    if (y + section2And3Height > BOTTOM_LIMIT - 30) {
      doc.addPage();
      y = MARGIN;
    }
    y += 20;

    doc.fontSize(12);
    if (!useKorean) doc.font('Helvetica-Bold');
    doc.text('2. 주문자 정보', MARGIN, y);
    if (useKorean) doc.font('NotoSansKR');
    y += 20;

    const orderBoxY = y;
    const orderBoxH = 14 + 18 * 4;
    doc.rect(MARGIN, y, CONTENT_WIDTH, orderBoxH).stroke('#ccc').fill('#fafafa');
    doc.fillColor('#000').fontSize(10);
    y += 14;
    doc.text(`주문번호: #${order.id}`, MARGIN + 12, y);
    doc.text(`주문일시: ${formatDateKST(order.created_at)}`, MARGIN + 12, y + 18);
    doc.text(`주문매장: ${profileStoreName}`, MARGIN + 12, y + 36);
    doc.text(`배송주소: ${deliveryAddr}`, MARGIN + 12, y + 54);
    y = orderBoxY + orderBoxH + 20;

    // ===== 3. 기타 =====
    doc.fontSize(12);
    if (!useKorean) doc.font('Helvetica-Bold');
    doc.text('3. 기타', MARGIN, y);
    if (useKorean) doc.font('NotoSansKR');
    y += 20;

    const notices = [
      '안전 배송 부탁드립니다. 감사합니다!',
      '배송 완료 후, 홈페이지 [주문관리] 페이지에서 \'배송완료\' 처리해주세요.',
    ];
    doc.rect(MARGIN, y, CONTENT_WIDTH, notices.length * 22 + 16).stroke('#ccc').fill('#fcfcfc');
    doc.fillColor('#000').fontSize(9);
    y += 12;
    for (const n of notices) {
      doc.text(n, MARGIN + 12, y, { width: CONTENT_WIDTH - 24 });
      y += 22;
    }
    y += 16;

    // 푸터 (마지막 페이지 최하단)
    doc.fontSize(8).fillColor('#000');
    doc.text('Zero Mart B2B 식자재 주문', MARGIN, PAGE_HEIGHT - MARGIN - 12, {
      align: 'center',
      width: CONTENT_WIDTH,
    });

    doc.end();
  });
}

module.exports = { generateOrderPdf };
