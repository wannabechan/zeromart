/**
 * 정산 수수료 (환경변수 SETTLEMENT_FEE_RATE, 퍼센트. 예: 4.8 = 4.8%)
 * - 판매금액(부가세 포함) × 요율 → 수수료 공급가액 + 부가세(10%)
 * - 수수료(표시·차감) = 공급가액 + 부가세
 * - 정산금액 = 판매금액 − 수수료
 */

const DEFAULT_SETTLEMENT_FEE_RATE_PERCENT = 4.8;
const SETTLEMENT_FEE_VAT_RATE_PERCENT = 10;

function getSettlementFeeRatePercent() {
  const raw = String(process.env.SETTLEMENT_FEE_RATE || '').trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SETTLEMENT_FEE_RATE_PERCENT;
  return n;
}

/** @returns {number} 수수료 공급가액 */
function calculateSettlementFeeExclusiveVat(salesKrw) {
  const sales = Number(salesKrw) || 0;
  const rate = getSettlementFeeRatePercent();
  return Math.round(sales * (rate / 100));
}

/** 수수료 공급가액에 대한 부가세 */
function calculateSettlementFeeVatAmount(feeExclusiveVat) {
  const fee = Number(feeExclusiveVat) || 0;
  return Math.round(fee * (SETTLEMENT_FEE_VAT_RATE_PERCENT / 100));
}

/** @returns {number} 부가세 포함 정산 수수료(공급가액 + 부가세) */
function calculateSettlementFee(salesKrw) {
  const supply = calculateSettlementFeeExclusiveVat(salesKrw);
  return supply + calculateSettlementFeeVatAmount(supply);
}

/** @returns {number} 정산금액 = 판매금액 − 수수료(부가세 포함) */
function calculateSettlementAmountAfterFee(salesKrw) {
  const sales = Number(salesKrw) || 0;
  return sales - calculateSettlementFee(sales);
}

module.exports = {
  DEFAULT_SETTLEMENT_FEE_RATE_PERCENT,
  SETTLEMENT_FEE_VAT_RATE_PERCENT,
  getSettlementFeeRatePercent,
  calculateSettlementFeeExclusiveVat,
  calculateSettlementFeeVatAmount,
  calculateSettlementFee,
  calculateSettlementAmountAfterFee,
};
