/**
 * POST /api/auth/send-code
 * 이메일로 6자리 인증 코드 생성 및 발송 (Resend)
 */

const { Resend } = require('resend');
const { generateCode, apiResponse } = require('../_utils');
const { saveAuthCode } = require('../_redis');

const resend = new Resend(process.env.RESEND_API_KEY);

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

    // 이메일 검증
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return apiResponse(res, 400, { error: '유효한 이메일을 입력해 주세요.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const code = generateCode();

    // Redis에 코드 저장 (TTL 10분, 기존 코드 덮어쓰기)
    await saveAuthCode(normalizedEmail, code);

    // Resend API Key 확인
    if (!process.env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not set');
      return apiResponse(res, 500, { error: '이메일 발송 설정이 되어 있지 않습니다.' });
    }

    // 발신 이메일 (Resend에서 bzcat.co 도메인 인증 후 사용)
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'no-reply@bzcat.co';
    const fromName = process.env.RESEND_FROM_NAME || 'BzCat';

    // 이메일 발송
    try {
      await resend.emails.send({
        from: `${fromName} <${fromEmail}>`,
        to: normalizedEmail,
        subject: '[BzCat] 로그인 인증 코드',
        html: `
          <div style="font-family: 'Noto Sans KR', sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #e67b19;">BzCat 로그인 인증</h2>
            <p>안녕하세요,</p>
            <p>아래 6자리 인증 코드를 입력하여 로그인을 완료해 주세요.</p>
            <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
              <h1 style="margin: 0; font-size: 32px; letter-spacing: 8px; color: #e67b19;">${code}</h1>
            </div>
            <p style="color: #666; font-size: 14px;">이 코드는 2분간 유효합니다.</p>
            <p style="color: #666; font-size: 14px;">본인이 요청하지 않은 경우 이 메일을 무시해 주세요.</p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #e0e0e0;">
            <p style="color: #999; font-size: 12px;">BzCat - 비즈니스 케이터링</p>
          </div>
        `,
      });
    } catch (emailError) {
      console.error('Resend error:', emailError);
      return apiResponse(res, 500, { error: '이메일 발송에 실패했습니다.' });
    }

    return apiResponse(res, 200, {
      success: true,
      message: '인증 코드가 발송되었습니다.',
      // 개발 모드에서만 코드 노출 (테스트용)
      ...(process.env.NODE_ENV !== 'production' && { devCode: code }),
    });

  } catch (error) {
    console.error('Send code error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
