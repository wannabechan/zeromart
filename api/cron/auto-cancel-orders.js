/**
 * GET /api/cron/auto-cancel-orders
 * 결제 완료 전 주문(submitted, payment_link_issued) 중 주문 일시로부터 24시간 경과 시 '결제기한만료'로 자동 취소.
 * CRON_SECRET 필요 (Authorization: Bearer <CRON_SECRET>).
 */

const { getAllOrders } = require('../_redis');
const { isPastPaymentDeadline, cancelOrderAndRegeneratePdf } = require('../_orderCancel');

const STATUSES_TO_AUTO_CANCEL = ['submitted', 'payment_link_issued'];

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).setHeader('Allow', 'GET, POST').end();
  }

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  if (!secret || token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const orders = await getAllOrders();
    const toCancel = orders.filter(
      (o) =>
        STATUSES_TO_AUTO_CANCEL.includes(o.status || '') &&
        isPastPaymentDeadline(o)
    );

    let cancelled = 0;
    for (const order of toCancel) {
      await cancelOrderAndRegeneratePdf(order.id, '결제기한만료');
      cancelled += 1;
    }

    return res.status(200).json({ ok: true, cancelled, checked: orders.length });
  } catch (err) {
    console.error('Auto-cancel orders error:', err);
    return res.status(500).json({ error: 'Auto-cancel failed' });
  }
};
