/**
 * 결제 API 공통 헬퍼 (getAppOrigin, getTossSecretKeyForOrder)
 * Zero Mart: 결제키는 항상 PAYKEY_ZEROMART 환경변수 사용
 */

function getAppOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

/** Zero Mart: 결제 시 항상 PAYKEY_ZEROMART 환경변수 사용 (admin 매장설정과 무관) */
async function getTossSecretKeyForOrder(order) {
  const envVarName = 'PAYKEY_ZEROMART';
  return process.env[envVarName] || '';
}

module.exports = {
  getAppOrigin,
  getTossSecretKeyForOrder,
};
