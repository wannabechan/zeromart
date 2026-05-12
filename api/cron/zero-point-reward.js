/**
 * GET/POST /api/cron/zero-point-reward
 * 결제 완료 50분이 지난 주문에 대해 제로포인트 적립 처리 (매장 알림 메일과 분리).
 * - 일반 카드(신용·체크): PAYMENT_REWARDRATE_CREDIT (%)
 * - 간편결제(easyPay): PAYMENT_REWARDRATE_EASYPAY (%)
 * CRON_SECRET 필요 (Authorization: Bearer <CRON_SECRET>).
 */

const { getAllOrders, addUserZeroPoints, saveOrder } = require('../_redis');
const { requireAuthCron } = require('../_utils');
const { getZeroPointRewardKindFromOrder, isEligibleForZeroPointReward } = require('./_zeroPointRewardEligibility');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).setHeader('Allow', 'GET, POST').end();
  }

  if (!requireAuthCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const orders = await getAllOrders();
    let rewarded = 0;
    for (const order of orders) {
      if (!isEligibleForZeroPointReward(order)) continue;
      const kind = getZeroPointRewardKindFromOrder(order);
      const rateRaw = kind === 'easypay'
        ? process.env.PAYMENT_REWARDRATE_EASYPAY
        : process.env.PAYMENT_REWARDRATE_CREDIT;
      const rate = Number(rateRaw);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      const paidBase = Number(order.payment_confirmed_amount);
      const fallbackBase = Number(order.total_amount);
      const base = Number.isFinite(paidBase) && paidBase > 0 ? paidBase : fallbackBase;
      const pts = Number.isFinite(base) && base > 0 ? Math.floor(base * (rate / 100)) : 0;
      if (pts <= 0 || !order.user_email) continue;
      const awardedAt = new Date().toISOString();
      order.zero_point_earned = pts;
      order.zero_point_awarded_at = awardedAt;
      await saveOrder(order);
      const email = String(order.user_email).trim().toLowerCase();
      const bal = await addUserZeroPoints(email, pts, {
        sourceOrderId: String(order.id),
        awardedAt,
        historyCode: kind === 'easypay' ? 'earn_easypay' : 'earn_credit',
      });
      if (bal == null) continue;
      rewarded += 1;
    }

    return res.status(200).json({ ok: true, rewarded, checked: orders.length });
  } catch (err) {
    console.error('Zero point reward cron error:', err);
    return res.status(500).json({ error: 'Zero point reward failed' });
  }
};
