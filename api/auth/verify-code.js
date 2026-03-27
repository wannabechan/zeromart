/**
 * POST /api/auth/verify-code
 * 인증 코드 검증 및 JWT 토큰 발급
 */

const { generateToken, getUserLevel, apiResponse } = require('../_utils');
const { getAndDeleteAuthCode, getUser, createUser, updateUserLogin, updateUserLevel, getRedis } = require('../_redis');

const VERIFY_CODE_LIMIT_PER_EMAIL = 10;
const VERIFY_CODE_LIMIT_PER_IP = 30;
const VERIFY_CODE_WINDOW_SECONDS = 60;

async function checkRateLimit(key, limit, windowSeconds) {
  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count <= limit;
}

module.exports = async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'POST') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { email, code } = req.body;
    const rawEmail = typeof email === 'string' ? email.trim() : '';
    const rawCode = (code != null && code !== '') ? String(code).trim() : '';

    if (!rawEmail || !rawCode) {
      return apiResponse(res, 400, { error: '이메일과 코드를 입력해 주세요.' });
    }
    if (rawEmail.length > 320 || rawCode.length > 10) {
      return apiResponse(res, 400, { error: '입력이 올바르지 않습니다.' });
    }

    const normalizedEmail = rawEmail.toLowerCase();
    const codeTrimmed = rawCode;
    const rawFwd = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
    const clientIp = (rawFwd.split(',')[0] || req.socket?.remoteAddress || 'unknown').trim();
    const emailRateKey = `ratelimit:auth:verify-code:email:${normalizedEmail}`;
    const ipRateKey = `ratelimit:auth:verify-code:ip:${clientIp}`;
    const [emailAllowed, ipAllowed] = await Promise.all([
      checkRateLimit(emailRateKey, VERIFY_CODE_LIMIT_PER_EMAIL, VERIFY_CODE_WINDOW_SECONDS),
      checkRateLimit(ipRateKey, VERIFY_CODE_LIMIT_PER_IP, VERIFY_CODE_WINDOW_SECONDS),
    ]);
    if (!emailAllowed || !ipAllowed) {
      return apiResponse(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    }

    let valid = await getAndDeleteAuthCode(normalizedEmail, codeTrimmed);
    if (!valid) {
      return apiResponse(res, 401, { error: '인증 코드가 유효하지 않거나 만료되었습니다.' });
    }

    // 사용자 확인 및 생성
    let userData = await getUser(normalizedEmail);
    let isFirstLogin = false;

    const level = getUserLevel(normalizedEmail);
    if (!userData) {
      // 신규 사용자 생성
      userData = await createUser(normalizedEmail, level);
      isFirstLogin = true;
    } else {
      // 기존 사용자 - 로그인 업데이트 + EMAIL_ADMIN 기준으로 레벨 동기화
      isFirstLogin = userData.is_first_login === true;
      await updateUserLogin(normalizedEmail);
      if (userData.level !== level) await updateUserLevel(normalizedEmail, level);
      userData = await getUser(normalizedEmail);
    }

    const token = generateToken(normalizedEmail, userData.level);

    return apiResponse(res, 200, {
      success: true,
      token,
      user: {
        email: userData.email,
        level: userData.level,
      },
      isFirstLogin: isFirstLogin || userData.is_first_login === true,
    });

  } catch (error) {
    console.error('Verify code error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
