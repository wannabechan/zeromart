/**
 * GET/POST /api/cron/migrate-order-slips
 * 모든 주문에 order_slips 필드를 보정 저장 (배포 후 일괄 실행용). CRON_SECRET 필요.
 */

const { getAllOrders, getStores } = require('../_redis');
const { persistSlipsIfMissing } = require('../orders/_orderSlips');
const { requireAuthCron } = require('../_utils');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).setHeader('Allow', 'GET, POST').end();
  }

  if (!requireAuthCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const stores = await getStores() || [];
    const orders = await getAllOrders();
    let updated = 0;
    for (const o of orders) {
      if (!o || !o.id) continue;
      const before = JSON.stringify(o.order_slips || null);
      const afterOrder = await persistSlipsIfMissing(String(o.id), stores);
      const after = JSON.stringify(afterOrder?.order_slips || null);
      if (before !== after) updated += 1;
    }
    return res.status(200).json({ ok: true, checked: orders.length, updated });
  } catch (err) {
    console.error('migrate-order-slips error:', err);
    return res.status(500).json({ error: 'migrate failed' });
  }
};
