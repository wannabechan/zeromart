/**
 * POST /api/auth/password-status
 * 이 이메일에 저장된 로그인 비밀번호가 있는지. 인증 코드 검증과 무관하다.
 */

const { apiResponse } = require('../_utils');
const { getUser, checkRateLimitIncr } = require('../_redis');
const { userHasPassword } = require('./_password');

const LIMIT_PER_EMAIL = 10;
const LIMIT_PER_IP = 30;
const WINDOW_SECONDS = 60;

function clientIp(req) {
  const rawFwd = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
  return (rawFwd.split(',')[0] || req.socket?.remoteAddress || 'unknown').trim();
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return apiResponse(res, 200, {});
  if (req.method !== 'POST') return apiResponse(res, 405, { error: 'Method not allowed' });

  try {
    const rawEmail = req.body && typeof req.body.email === 'string' ? req.body.email.trim() : '';
    if (!rawEmail || rawEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return apiResponse(res, 400, { error: '유효한 이메일을 입력해 주세요.' });
    }
    const normalizedEmail = rawEmail.toLowerCase();
    const ip = clientIp(req);
    const [emailAllowed, ipAllowed] = await Promise.all([
      checkRateLimitIncr(`ratelimit:auth:password-status:email:${normalizedEmail}`, LIMIT_PER_EMAIL, WINDOW_SECONDS),
      checkRateLimitIncr(`ratelimit:auth:password-status:ip:${ip}`, LIMIT_PER_IP, WINDOW_SECONDS),
    ]);
    if (!emailAllowed || !ipAllowed) {
      return apiResponse(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    }

    const user = await getUser(normalizedEmail);
    return apiResponse(res, 200, { hasPassword: userHasPassword(user) });
  } catch (error) {
    console.error('Password status error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
