/**
 * 토스페이먼츠 Payment 객체 기준, 간편결제가 아닌 일반 카드(신용·체크) 결제 여부.
 * @see https://docs.tosspayments.com/reference#payment-%EA%B0%9D%EC%B2%B4
 * @see https://docs.tosspayments.com/guides/v2/easypay-response
 */

function hasMeaningfulEasyPay(easyPay) {
  if (easyPay == null || typeof easyPay !== 'object') return false;
  const provider = easyPay.provider;
  if (provider != null && String(provider).trim() !== '') return true;
  const amt = Number(easyPay.amount);
  const disc = Number(easyPay.discountAmount);
  if (Number.isFinite(amt) && amt > 0) return true;
  if (Number.isFinite(disc) && disc > 0) return true;
  return false;
}

/**
 * @param {object} payment - POST /v1/payments/confirm 응답 JSON
 * @returns {boolean}
 */
function isTossPureCreditOrCheckCard(payment) {
  if (!payment || typeof payment !== 'object') return false;
  const method = String(payment.method || '').trim();
  const methodUpper = method.toUpperCase();
  const isCardChannel = method === '카드' || methodUpper === 'CARD';
  if (!isCardChannel) return false;
  if (hasMeaningfulEasyPay(payment.easyPay)) return false;
  const card = payment.card;
  if (!card || typeof card !== 'object') return false;
  const cardType = String(card.cardType || '').trim();
  const cardTypeUpper = cardType.toUpperCase();
  if (cardType === '신용' || cardType === '체크') return true;
  const ct = cardType.toLowerCase();
  if (ct === 'credit' || ct === 'debit' || ct === 'check') return true;
  if (cardTypeUpper === 'CREDIT' || cardTypeUpper === 'DEBIT' || cardTypeUpper === 'CHECK') return true;
  return false;
}

module.exports = { isTossPureCreditOrCheckCard, hasMeaningfulEasyPay };
