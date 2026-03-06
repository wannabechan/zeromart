/**
 * POST /api/auth/verify-code
 * 인증 코드 검증 및 JWT 토큰 발급
 */

const { generateToken, getUserLevel, apiResponse } = require('../_utils');
const { getAndDeleteAuthCode, getUser, createUser, updateUserLogin } = require('../_redis');

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

    if (!email || !code) {
      return apiResponse(res, 400, { error: '이메일과 코드를 입력해 주세요.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 코드 검증 및 삭제 (1회용)
    const valid = await getAndDeleteAuthCode(normalizedEmail, code);
    if (!valid) {
      return apiResponse(res, 401, { error: '인증 코드가 유효하지 않거나 만료되었습니다.' });
    }

    // 사용자 확인 및 생성
    let userData = await getUser(normalizedEmail);
    let isFirstLogin = false;

    if (!userData) {
      // 신규 사용자 생성
      const level = getUserLevel(normalizedEmail);
      userData = await createUser(normalizedEmail, level);
      isFirstLogin = true;
    } else {
      // 기존 사용자 - 로그인 업데이트
      isFirstLogin = userData.is_first_login === true;
      await updateUserLogin(normalizedEmail);
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
