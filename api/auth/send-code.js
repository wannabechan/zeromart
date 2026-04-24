/**
 * POST /api/auth/send-code
 * 이메일로 6자리 인증 코드 생성 및 발송 (Resend)
 */

const { Resend } = require('resend');
const { generateCode, apiResponse } = require('../_utils');
const { saveAuthCode, appendResendLog, checkRateLimitIncr } = require('../_redis');

const resend = new Resend(process.env.RESEND_API_KEY);
const SEND_CODE_LIMIT_PER_EMAIL = 3;
const SEND_CODE_LIMIT_PER_IP = 10;
const SEND_CODE_WINDOW_SECONDS = 60;

module.exports = async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'POST') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;
    const rawEmail = typeof email === 'string' ? email.trim() : '';

    // 이메일 검증 (형식 + 길이 제한으로 과도한 입력 방지)
    if (!rawEmail || rawEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return apiResponse(res, 400, { error: '유효한 이메일을 입력해 주세요.' });
    }

    const normalizedEmail = rawEmail.toLowerCase();
    const rawFwd = typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
    const clientIp = (rawFwd.split(',')[0] || req.socket?.remoteAddress || 'unknown').trim();
    const emailRateKey = `ratelimit:auth:send-code:email:${normalizedEmail}`;
    const ipRateKey = `ratelimit:auth:send-code:ip:${clientIp}`;
    const [emailAllowed, ipAllowed] = await Promise.all([
      checkRateLimitIncr(emailRateKey, SEND_CODE_LIMIT_PER_EMAIL, SEND_CODE_WINDOW_SECONDS),
      checkRateLimitIncr(ipRateKey, SEND_CODE_LIMIT_PER_IP, SEND_CODE_WINDOW_SECONDS),
    ]);
    if (!emailAllowed || !ipAllowed) {
      return apiResponse(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    }

    const code = generateCode();

    // Redis에 코드 저장 (TTL 10분, 기존 코드 덮어쓰기)
    await saveAuthCode(normalizedEmail, code);

    // Resend API Key 확인
    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not set');
      await appendResendLog({
        ok: false,
        kind: 'login_code',
        toEmail: normalizedEmail,
        errorMessage: 'RESEND_API_KEY 미설정',
      });
      return apiResponse(res, 500, { error: '이메일 발송 설정이 되어 있지 않습니다.' });
    }

    // 발신 이메일: 도메인 구입 전에는 Resend 기본 주소 사용, 도메인 인증 후 RESEND_FROM_EMAIL 설정
    const fromEmail = (process.env.RESEND_FROM_EMAIL || '').trim() || 'onboarding@resend.dev';
    const fromName = (process.env.RESEND_FROM_NAME || 'Zero Mart').trim();

    // 이메일 발송
    try {
      const sendResult = await resend.emails.send({
        from: `${fromName} <${fromEmail}>`,
        to: normalizedEmail,
        subject: '[Zero Mart] 로그인 인증 코드',
        html: `
          <div style="font-family: 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2C2C2C;">Zero Mart 로그인 인증</h2>
            <p>안녕하세요,</p>
            <p>아래 6자리 인증 코드를 입력하여 로그인을 완료해 주세요.</p>
            <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
              <h1 style="margin: 0; font-size: 32px; letter-spacing: 8px; color: #2C2C2C;">${code}</h1>
            </div>
            <p style="color: #666; font-size: 14px;">이 코드는 2분간 유효합니다.</p>
            <p style="color: #666; font-size: 14px;">본인이 요청하지 않은 경우 이 메일을 무시해 주세요.</p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #e0e0e0;">
            <p style="color: #999; font-size: 12px;">Zero Mart - B2B 식자재 주문</p>
          </div>
        `,
      });
      if (sendResult.error) {
        const errMsg = sendResult.error.message || JSON.stringify(sendResult.error);
        await appendResendLog({
          ok: false,
          kind: 'login_code',
          toEmail: normalizedEmail,
          errorMessage: errMsg,
        });
        return apiResponse(res, 500, { error: '이메일 발송에 실패했습니다.' });
      }
      await appendResendLog({
        ok: true,
        kind: 'login_code',
        toEmail: normalizedEmail,
        resendId: sendResult.data?.id || null,
      });
    } catch (emailError) {
      console.error('Resend error:', emailError);
      await appendResendLog({
        ok: false,
        kind: 'login_code',
        toEmail: normalizedEmail,
        errorMessage: emailError?.message || String(emailError),
      });
      return apiResponse(res, 500, { error: '이메일 발송에 실패했습니다.' });
    }

    return apiResponse(res, 200, {
      success: true,
      message: '인증 코드가 발송되었습니다.',
    });

  } catch (error) {
    console.error('Send code error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
