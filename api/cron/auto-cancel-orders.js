/**
 * GET /api/cron/auto-cancel-orders
 * 배송 희망일 4일 전 23:59까지 결제 완료되지 않은 주문 자동 취소
 * Vercel Cron 또는 외부 스케줄러에서 호출 (CRON_SECRET 필요)
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
