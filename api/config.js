/**
 * GET /api/config
 * 공개 설정 값 (프론트에서 사용, 인증 불필요)
 * emailAdmin: 문의용 이메일 (환경변수 EMAIL_ADMIN)
 * paymentRewardExpireDays: 제로포인트 소멸 일수 (환경변수 PAYMENT_REWARD_EXPIREDAYS, 크론 소멸 및 안내 표시)
 * paymentRewardRateCredit: 신용/체크카드 적립률 % (환경변수 PAYMENT_REWARDRATE_CREDIT)
 * paymentRewardRateEasypay: 간편결제 적립률 % (환경변수 PAYMENT_REWARDRATE_EASYPAY)
 * zeroPointPublicOpen: ZEROPOINT_PUBLICOPEN === 'true' 일 때만 비관리자에게 주문 접수 모달의 제로포인트 줄 노출
 * settlementFeeRate: 정산 수수료율 % (환경변수 SETTLEMENT_FEE_RATE)
 */

const { apiResponse, getNormalizedAdminEmail } = require('./_utils');
const { getSettlementFeeRatePercent } = require('./_settlementFee');

function isZeroPointPublicOpenEnv() {
  return String(process.env.ZEROPOINT_PUBLICOPEN || '').trim().toLowerCase() === 'true';
}

function getPaymentRewardExpireDaysForDisplay() {
  const raw = String(process.env.PAYMENT_REWARD_EXPIREDAYS || '').trim();
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 60;
  return n;
}

function getPaymentRewardRateCreditForDisplay() {
  const raw = String(process.env.PAYMENT_REWARDRATE_CREDIT ?? '').trim();
  if (!raw) return 0.5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0.5;
  return n;
}

function getPaymentRewardRateEasypayForDisplay() {
  const raw = String(process.env.PAYMENT_REWARDRATE_EASYPAY ?? '').trim();
  if (!raw) return 0.1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0.1;
  return n;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'GET') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const emailAdmin = getNormalizedAdminEmail();
    const paymentRewardExpireDays = getPaymentRewardExpireDaysForDisplay();
    const paymentRewardRateCredit = getPaymentRewardRateCreditForDisplay();
    const paymentRewardRateEasypay = getPaymentRewardRateEasypayForDisplay();
    const zeroPointPublicOpen = isZeroPointPublicOpenEnv();
    const settlementFeeRate = getSettlementFeeRatePercent();
    return apiResponse(res, 200, {
      emailAdmin,
      paymentRewardExpireDays,
      paymentRewardRateCredit,
      paymentRewardRateEasypay,
      zeroPointPublicOpen,
      settlementFeeRate,
    });
  } catch (error) {
    console.error('Config error:', error);
    return apiResponse(res, 500, {
      emailAdmin: '',
      paymentRewardExpireDays: 60,
      paymentRewardRateCredit: getPaymentRewardRateCreditForDisplay(),
      paymentRewardRateEasypay: getPaymentRewardRateEasypayForDisplay(),
      zeroPointPublicOpen: false,
      settlementFeeRate: getSettlementFeeRatePercent(),
    });
  }
};
