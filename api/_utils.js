/**
 * API 유틸리티 함수
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  throw new Error('JWT_SECRET is required and must be at least 16 characters. Set it in Vercel Environment Variables (and .env.local for local dev).');
}

/** 로그인 JWT 유효 기간 (jsonwebtoken 형식, 예: 7d, 30d). `JWT_EXPIRES_IN` 환경 변수로 변경 가능. */
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * JWT 토큰 생성
 */
function generateToken(email, level) {
  return jwt.sign(
    { email, level },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * JWT 토큰 검증
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * 어드민 여부 (JWT 검증 후 user 객체에 대해 사용)
 */
function isAdmin(user) {
  return !!(user && user.level === 'admin');
}

/**
 * Cron API 인증 (CRON_SECRET과 timing-safe 비교)
 */
function requireAuthCron(req) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers && req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!secret || typeof secret !== 'string') return false;
  if (token.length !== secret.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token, 'utf8'), Buffer.from(secret, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * 사용자 레벨 결정 (관리자 이메일은 Vercel 환경 변수 EMAIL_ADMIN 사용)
 */
function getUserLevel(email) {
  const normalized = (email || '').toLowerCase().trim();
  let adminEmail = (process.env.EMAIL_ADMIN || '').trim();
  if (adminEmail.startsWith('"') && adminEmail.endsWith('"')) adminEmail = adminEmail.slice(1, -1);
  if (adminEmail.startsWith("'") && adminEmail.endsWith("'")) adminEmail = adminEmail.slice(1, -1);
  adminEmail = adminEmail.toLowerCase().trim();
  if (adminEmail && normalized === adminEmail) return 'admin';
  return 'user';
}

/**
 * 6자리 랜덤 코드 생성
 */
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * CORS 및 보안 헤더 설정
 * production에서는 APP_ORIGIN만 허용. 개발 시 미설정이면 '*'.
 */
function setCorsHeaders(response) {
  const envOrigin = (process.env.APP_ORIGIN || '').trim();
  const isProduction = process.env.NODE_ENV === 'production';
  const allowOrigin = isProduction ? envOrigin : (envOrigin || '*');
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Origin', allowOrigin || 'null');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  response.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('X-XSS-Protection', '1; mode=block');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

/**
 * Authorization: Bearer <token> 추출 및 검증. 인증 필요 API에서 사용.
 * @param {object} req - 요청 객체
 * @returns {{ user: object, token: string } | null} 검증된 사용자 정보 또는 null
 */
function requireAuth(req) {
  const authHeader = req.headers && req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7).trim();
  if (!token) return null;
  const user = verifyToken(token);
  return user ? { user, token } : null;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function getPdfAccessTokenTtl() {
  const raw = String(process.env.PDF_ACCESS_TOKEN_TTL || '').trim();
  if (!raw) return '2h';
  const hours = Number.parseInt(raw, 10);
  if (!Number.isFinite(hours) || hours <= 0) return '2h';
  return `${hours}h`;
}

function generateOrderPdfAccessToken(orderId, storeSlug, acceptToken) {
  const payload = {
    type: 'order_pdf',
    orderId: String(orderId || ''),
    store: String(storeSlug || '').toLowerCase(),
    ath: sha256Hex(acceptToken || '').slice(0, 24),
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: getPdfAccessTokenTtl() });
}

function verifyOrderPdfAccessToken(accessToken, orderId, storeSlug, acceptToken) {
  if (!accessToken) return false;
  try {
    const decoded = jwt.verify(String(accessToken), JWT_SECRET);
    if (!decoded || decoded.type !== 'order_pdf') return false;
    if (String(decoded.orderId || '') !== String(orderId || '')) return false;
    if (String(decoded.store || '') !== String(storeSlug || '').toLowerCase()) return false;
    const expectedAth = sha256Hex(acceptToken || '').slice(0, 24);
    return decoded.ath === expectedAth;
  } catch (_) {
    return false;
  }
}

function getOrderPdfAccessTokenStatus(accessToken, orderId, storeSlug, acceptToken) {
  if (!accessToken) return { ok: false, reason: 'missing' };
  try {
    const decoded = jwt.verify(String(accessToken), JWT_SECRET);
    if (!decoded || decoded.type !== 'order_pdf') return { ok: false, reason: 'invalid' };
    if (String(decoded.orderId || '') !== String(orderId || '')) return { ok: false, reason: 'invalid' };
    if (String(decoded.store || '') !== String(storeSlug || '').toLowerCase()) return { ok: false, reason: 'invalid' };
    const expectedAth = sha256Hex(acceptToken || '').slice(0, 24);
    if (decoded.ath !== expectedAth) return { ok: false, reason: 'invalid' };
    return { ok: true, reason: 'ok' };
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
}

/**
 * API 응답 헬퍼
 */
function apiResponse(response, status, data) {
  setCorsHeaders(response);
  response.status(status).json(data);
}

module.exports = {
  generateToken,
  verifyToken,
  getUserLevel,
  isAdmin,
  requireAuthCron,
  generateCode,
  setCorsHeaders,
  apiResponse,
  requireAuth,
  generateOrderPdfAccessToken,
  verifyOrderPdfAccessToken,
  getOrderPdfAccessTokenStatus,
};
