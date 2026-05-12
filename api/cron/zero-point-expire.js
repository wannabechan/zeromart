/**
 * GET/POST /api/cron/zero-point-expire
 * 적립일(zero_point_awarded_at 기준)로부터 PAYMENT_REWARD_EXPIREDAYS일이 지난 제로포인트 배치를 소멸.
 * CRON_SECRET 필요 (Authorization: Bearer <CRON_SECRET>).
 */

const { requireAuthCron } = require('../_utils');
const { expireAllUsersZeroPointsByPolicy } = require('../_redis');

function getPaymentRewardExpireDays() {
  const raw = String(process.env.PAYMENT_REWARD_EXPIREDAYS || '').trim();
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 60;
  return n;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).setHeader('Allow', 'GET, POST').end();
  }
  if (!requireAuthCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const days = getPaymentRewardExpireDays();
  try {
    const out = await expireAllUsersZeroPointsByPolicy(days);
    return res.status(200).json({
      ok: true,
      expireDays: days,
      checked: out.checked,
      pointsExpired: out.pointsExpired,
      usersTouched: out.usersTouched,
    });
  } catch (err) {
    console.error('Zero point expire cron error:', err);
    return res.status(500).json({ error: 'Zero point expire failed' });
  }
};
