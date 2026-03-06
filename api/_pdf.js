/**
 * 주문서 PDF 생성 (정식 주문서 형식)
 * P1: 주문자 정보, 주문 정보, 기타 안내 사항, 면책 조항
 * P2+: 주문 내역
 */

const PDFDocument = require('pdfkit');
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
    doc.text('BzCat', MARGIN, y, { align: 'center', width: CONTENT_WIDTH });
    doc.fontSize(14);
    y = doc.y + 4;
    doc.text(isCancelled ? '비즈니스 케이터링 주문서 (취소 건)' : '비즈니스 케이터링 주문서', MARGIN, y, { align: 'center', width: CONTENT_WIDTH });
    y = doc.y + 20;

    // 구분선
    doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke('#ddd');
    y += 16;

    // ===== P1: 1. 주문자 정보 =====
    doc.fontSize(12);
    if (!useKorean) doc.font('Helvetica-Bold');
    doc.text('1. 주문자 정보', MARGIN, y);
    if (useKorean) doc.font('NotoSansKR');
    y += 20;

    const infoBoxY = y;
    doc.rect(MARGIN, y, CONTENT_WIDTH, 72).stroke('#ccc').fill('#fafafa');
    doc.fillColor('#000').fontSize(10);
    y += 14;
    doc.text(`주문자 이메일: ${order.user_email || '—'}`, MARGIN + 12, y);
    doc.text(`주문자명: ${order.depositor || '—'}`, MARGIN + 12, y + 18);
    doc.text(`연락처: ${order.contact || '—'}`, MARGIN + 12, y + 36);
    y = infoBoxY + 72 + 20;

    // ===== 2. 주문 정보 =====
    doc.fontSize(12);
    if (!useKorean) doc.font('Helvetica-Bold');
    doc.text('2. 주문 정보', MARGIN, y);
    if (useKorean) doc.font('NotoSansKR');
    y += 20;

    const orderBoxY = y;
    doc.rect(MARGIN, y, CONTENT_WIDTH, 90).stroke('#ccc').fill('#fafafa');
    doc.fillColor('#000').fontSize(10);
    y += 14;
    doc.text(`주문번호: #${order.id}`, MARGIN + 12, y);
    doc.text(`주문일시: ${formatDateKST(order.created_at)}`, MARGIN + 12, y + 18);
    doc.text(`배송희망일: ${order.delivery_date || '—'} ${order.delivery_time || ''}`, MARGIN + 12, y + 36);
    doc.text(`배송주소: ${order.delivery_address || '—'} ${order.detail_address || ''}`, MARGIN + 12, y + 54);
    y = orderBoxY + 90 + 20;

    // ===== 3. 기타 안내 사항 =====
    doc.fontSize(12);
    if (!useKorean) doc.font('Helvetica-Bold');
    doc.text('3. 기타 안내 사항', MARGIN, y);
    if (useKorean) doc.font('NotoSansKR');
    y += 20;

    const notices = [
      '· 본 주문서는 주문자의 신청에 따른 주문 내용 확인용 문서이며, 최종 결제 완료 후 주문이 확정됩니다.',
      '· 배송 희망일 최소 6일전 결제 링크가 생성되고, 등록하신 연락처로 안내 메세지를 보내드립니다.',
      '· 홈페이지 \'내 주문 보기\'에서 해당 주문의 [결제 진행하기] 버튼을 누르시고 결제를 진행하시면 됩니다.',
      '· 배송 희망일 4일전까지 결제 완료 필수이며, 기한 내 결제되지 않은 주문은 자동 취소됩니다.',
      '· 결제 취소는 배송 희망일 4일전까지만 허용되며, 이후에는 취소 및 환불이 불가합니다.',
    ];
    doc.rect(MARGIN, y, CONTENT_WIDTH, notices.length * 22 + 16).stroke('#ccc').fill('#fcfcfc');
    doc.fillColor('#000').fontSize(9);
    y += 12;
    for (const n of notices) {
      doc.text(n, MARGIN + 12, y, { width: CONTENT_WIDTH - 24 });
      y += 22;
    }
    y += 16;

    // ===== 4. 면책 조항 =====
    y += 10;
    doc.fontSize(12);
    if (!useKorean) doc.font('Helvetica-Bold');
    doc.text('4. 면책 조항', MARGIN, y);
    if (useKorean) doc.font('NotoSansKR');
    y += 20;

    const disclaimer = [
      '· 본 웹사이트는 소상공인 음식점의 주문 연결을 지원하기 위한 비영리 플랫폼으로, 플랫폼 제공자는 상품의 판매 당사자가 아닙니다.',
      '· 주문에 대한 결제, 조리 및 환불 책임은 해당 메뉴에 명시된 음식점에 있으며, 플랫폼 제공자는 이에 대한 법적·계약상 책임을 지지 않습니다.',
      '· 재고 수급 및 생산 일정 등 음식점 운영 사정에 따라 일부 메뉴 구성 또는 주문 내용이 변경될 수 있으며, 이 경우 사전에 고객에게 안내드립니다.',
      '· 플랫폼 서비스 운영 과정에서 제공되는 서비스의 일부 내용은 필요에 따라 예고 없이 변경될 수 있습니다.',
    ];
    const discWidth = CONTENT_WIDTH - 24;
    doc.fillColor('#000').fontSize(8);
    const discLineH = 21;
    const discTotalH = disclaimer.length * discLineH + 24;
    doc.rect(MARGIN, y, CONTENT_WIDTH, discTotalH).stroke('#ddd').fill('#fafafa');
    y += 12;
    for (const d of disclaimer) {
      doc.fillColor('#000');
      doc.text(d, MARGIN + 12, y, { width: discWidth });
      y += discLineH;
    }

    // ===== P2: 5. 주문 내역 =====
    doc.addPage();
    y = MARGIN;

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
    doc.text('5. 주문 내역', MARGIN, y);
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

    // 푸터 (마지막 페이지 최하단)
    doc.fontSize(8).fillColor('#000');
    doc.text('BzCat 비즈니스 케이터링', MARGIN, PAGE_HEIGHT - MARGIN - 12, {
      align: 'center',
      width: CONTENT_WIDTH,
    });

    doc.end();
  });
}

module.exports = { generateOrderPdf };
