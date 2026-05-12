/**
 * 제로포인트 결제 적립 크론용: 주문이 적립 대상인지·시간 조건 충족 여부.
 */

const ZERO_POINT_REWARD_DELAY_MS = 50 * 60 * 1000;

/** @returns {'credit'|'easypay'|null} */
function getZeroPointRewardKindFromOrder(order) {
  const k = order.zero_point_reward_kind;
  if (k === 'credit' || k === 'easypay') return k;
  if (order.zero_point_reward_eligible === true) return 'credit';
  return null;
}

function isEligibleForZeroPointReward(order) {
  if ((order.status || '') !== 'payment_completed') return false;
  if (Number(order.zero_point_earned) > 0) return false;
  if (!getZeroPointRewardKindFromOrder(order)) return false;
  const at = order.zero_point_reward_ready_at || order.payment_completed_at;
  if (!at) return false;
  const ts = new Date(at).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts >= (order.zero_point_reward_ready_at ? 0 : ZERO_POINT_REWARD_DELAY_MS);
}

module.exports = {
  ZERO_POINT_REWARD_DELAY_MS,
  getZeroPointRewardKindFromOrder,
  isEligibleForZeroPointReward,
};
