/**
 * GET /api/config
 * 공개 설정 값 (프론트에서 사용, 인증 불필요)
 * emailAdmin: 문의용 이메일 (환경변수 EMAIL_ADMIN)
 * paymentRewardExpireDays: 제로포인트 소멸 일수 (환경변수 PAYMENT_REWARD_EXPIREDAYS, 크론 소멸 및 안내 표시)
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
    const zeroPointPublicOpen = isZeroPointPublicOpenEnv();
    const settlementFeeRate = getSettlementFeeRatePercent();
    return apiResponse(res, 200, { emailAdmin, paymentRewardExpireDays, zeroPointPublicOpen, settlementFeeRate });
  } catch (error) {
    console.error('Config error:', error);
    return apiResponse(res, 500, {
      emailAdmin: '',
      paymentRewardExpireDays: 60,
      zeroPointPublicOpen: false,
      settlementFeeRate: getSettlementFeeRatePercent(),
    });
  }
};
