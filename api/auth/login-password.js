/**
 * POST /api/auth/login-password
 * 저장된 비밀번호로 로그인. 이메일 인증 코드·사업자번호 뒤 6자리는 받지 않는다.
 */

const { apiResponse } = require('../_utils');
const { getUser, checkRateLimitIncr } = require('../_redis');
const { verifyPassword, userHasPassword } = require('./_password');
const { issueLoginForEmail } = require('./_issueLogin');

const LIMIT_PER_EMAIL = 8;
const LIMIT_PER_IP = 20;
const WINDOW_SECONDS = 60;

function clientIp(req) {
  const rawFwd = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
  return (rawFwd.split(',')[0] || req.socket?.remoteAddress || 'unknown').trim();
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return apiResponse(res, 200, {});
  if (req.method !== 'POST') return apiResponse(res, 405, { error: 'Method not allowed' });

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!rawEmail || rawEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) || password.length > 64) {
      return apiResponse(res, 400, { error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    const normalizedEmail = rawEmail.toLowerCase();
    const ip = clientIp(req);
    const [emailAllowed, ipAllowed] = await Promise.all([
      checkRateLimitIncr(`ratelimit:auth:login-password:email:${normalizedEmail}`, LIMIT_PER_EMAIL, WINDOW_SECONDS),
      checkRateLimitIncr(`ratelimit:auth:login-password:ip:${ip}`, LIMIT_PER_IP, WINDOW_SECONDS),
    ]);
    if (!emailAllowed || !ipAllowed) {
      return apiResponse(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    }

    const user = await getUser(normalizedEmail);
    const ok = userHasPassword(user) && await verifyPassword(password, user);
    if (!ok) {
      return apiResponse(res, 401, { error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const payload = await issueLoginForEmail(normalizedEmail);
    return apiResponse(res, 200, payload);
  } catch (error) {
    console.error('Login password error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
