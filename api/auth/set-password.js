/**
 * POST /api/auth/set-password
 * 이메일로 발송한 6자리 코드 확인 후 비밀번호를 저장하고 로그인한다.
 * 사업자등록번호 뒤 6자리는 이 경로에서 코드로 인정하지 않는다.
 * 최초 설정과 "기억이 안나요" 재설정이 같은 조건이다.
 */

const { apiResponse, isValidTestAccountCode, getUserLevel } = require('../_utils');
const { getUser, createUser, getAndDeleteAuthCode, setUserPassword, checkRateLimitIncr } = require('../_redis');
const { validatePassword, createPasswordRecord } = require('./_password');
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
    const code = body.code != null ? String(body.code).trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const passwordConfirm = typeof body.passwordConfirm === 'string' ? body.passwordConfirm : '';

    if (!rawEmail || rawEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return apiResponse(res, 400, { error: '유효한 이메일을 입력해 주세요.' });
    }
    if (!code || code.length > 10) {
      return apiResponse(res, 400, { error: '인증 코드가 유효하지 않거나 만료되었습니다.' });
    }
    const passwordError = validatePassword(password);
    if (passwordError) return apiResponse(res, 400, { error: passwordError });
    if (password !== passwordConfirm) {
      return apiResponse(res, 400, { error: '비밀번호 확인이 일치하지 않습니다.' });
    }

    const normalizedEmail = rawEmail.toLowerCase();
    const ip = clientIp(req);
    const [emailAllowed, ipAllowed] = await Promise.all([
      checkRateLimitIncr(`ratelimit:auth:set-password:email:${normalizedEmail}`, LIMIT_PER_EMAIL, WINDOW_SECONDS),
      checkRateLimitIncr(`ratelimit:auth:set-password:ip:${ip}`, LIMIT_PER_IP, WINDOW_SECONDS),
    ]);
    if (!emailAllowed || !ipAllowed) {
      return apiResponse(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    }

    const codeOk = isValidTestAccountCode(normalizedEmail, code) || await getAndDeleteAuthCode(normalizedEmail, code);
    if (!codeOk) {
      return apiResponse(res, 401, { error: '인증 코드가 유효하지 않거나 만료되었습니다.' });
    }

    let user = await getUser(normalizedEmail);
    if (!user) {
      user = await createUser(normalizedEmail, getUserLevel(normalizedEmail));
    }
    const record = await createPasswordRecord(password);
    const saved = await setUserPassword(normalizedEmail, record.password_hash, record.password_salt);
    if (!saved) {
      return apiResponse(res, 500, { error: '비밀번호를 저장하지 못했습니다.' });
    }

    const payload = await issueLoginForEmail(normalizedEmail);
    return apiResponse(res, 200, payload);
  } catch (error) {
    console.error('Set password error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
