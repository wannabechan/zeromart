/**
 * GET /api/orders/pdf?orderId=xxx
 * 주문서 PDF 생성 반환 (요청 시점에 생성, 취소 건 제목 반영)
 * 본인 주문 또는 관리자만 접근
 */

const { verifyToken, setCorsHeaders } = require('../_utils');
const { getOrderById, getStores } = require('../_redis');
const { generateOrderPdf } = require('../_pdf');
const { getOrderItemsByStore } = require('./_order-email');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    setCorsHeaders(res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawOrderId = req.query.orderId;
  if (!rawOrderId || typeof rawOrderId !== 'string') {
    setCorsHeaders(res);
    return res.status(400).json({ error: '주문 번호가 필요합니다.' });
  }
  const orderId = rawOrderId.trim();
  if (!orderId) {
    setCorsHeaders(res);
    return res.status(400).json({ error: '주문 번호가 필요합니다.' });
  }

  let order = await getOrderById(orderId);
  if (!order) {
    setCorsHeaders(res);
    return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
  }

  const storeSlug = (req.query.store || '').trim().toLowerCase();
  let orderNumberDisplayOverride = null;
  if (storeSlug) {
    const byStore = getOrderItemsByStore(order);
    const slugs = Object.keys(byStore).filter(Boolean).sort();
    const slipIndex = slugs.indexOf(storeSlug);
    const slipNumber = slipIndex >= 0 ? slipIndex + 1 : 1;
    orderNumberDisplayOverride = `#${order.id}-${slipNumber}`;

    const items = order.order_items || order.orderItems || [];
    const filtered = items.filter((item) => {
      const id = (item.id || '').toString();
      const slug = (id.split('-')[0] || '').toLowerCase();
      return slug === storeSlug;
    });
    order = { ...order, order_items: filtered };
  }

  const tokenFromQuery = (req.query.token || '').trim();
  const allowedByToken = tokenFromQuery && order.accept_token && order.accept_token === tokenFromQuery;

  if (!allowedByToken) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      setCorsHeaders(res);
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    const user = verifyToken(authHeader.substring(7));
    if (!user) {
      setCorsHeaders(res);
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    const isAdmin = user.level === 'admin';
    if (order.user_email !== user.email && !isAdmin) {
      setCorsHeaders(res);
      return res.status(403).json({ error: '해당 주문을 볼 수 없습니다.' });
    }
  }

  try {
    const stores = await getStores();
    const isCancelled = order.status === 'cancelled';
    const pdfOptions = { isCancelled };
    if (orderNumberDisplayOverride) pdfOptions.orderNumberDisplay = orderNumberDisplayOverride;
    const pdfBuffer = await generateOrderPdf(order, stores, pdfOptions);

    setCorsHeaders(res);
    res.setHeader('Content-Type', 'application/pdf');
    const baseId = String(order.id || orderId).replace(/[^\w-]/g, '_');
    const safeSlug = storeSlug ? storeSlug.replace(/[^a-z0-9_-]/g, '_') : '';
    const filename = safeSlug ? `order-${baseId}-${safeSlug}.pdf` : `order-${baseId}.pdf`;
    const safeFilename = filename.replace(/["\\\r\n]/g, '_');
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Order PDF generation error:', err);
    setCorsHeaders(res);
    res.status(500).json({ error: '주문서 생성에 실패했습니다.' });
  }
};
