/**
 * 결제 API 공통 헬퍼 (getAppOrigin, getStoreSlugFromOrder, getTossSecretKeyForOrder)
 */

const { getStores } = require('../_redis');

function getAppOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

function getStoreSlugFromOrder(order) {
  const items = order.order_items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const firstId = items[0]?.id;
  if (!firstId || typeof firstId !== 'string') return null;
  const slug = firstId.split('-')[0];
  return slug || null;
}

const FIXED_TOSS_ENV_NAMES = ['TOSS_SECRET_KEY', 'TOSS_SECRET_KEY_TEST'];
/** 결제키 환경변수 명칭 규칙: PAYKEY_ 로 시작 + 영문/숫자/밑줄 */
const PAYKEY_PATTERN = /^PAYKEY_[A-Za-z0-9_]+$/;

function isAllowedTossEnvName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  return FIXED_TOSS_ENV_NAMES.includes(trimmed) || PAYKEY_PATTERN.test(trimmed);
}

async function getTossSecretKeyForOrder(order) {
  const stores = await getStores();
  const slug = getStoreSlugFromOrder(order);
  const store = slug
    ? stores.find((s) => (s.id === slug || s.slug === slug))
    : null;
  let envVarName = (store?.payment?.apiKeyEnvVar || stores[0]?.payment?.apiKeyEnvVar || '').trim() || 'TOSS_SECRET_KEY';
  if (!isAllowedTossEnvName(envVarName)) envVarName = 'TOSS_SECRET_KEY';
  return process.env[envVarName] || '';
}

module.exports = {
  getAppOrigin,
  getTossSecretKeyForOrder,
};
