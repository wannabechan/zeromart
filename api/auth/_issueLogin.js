/**
 * 비밀번호 로그인·비밀번호 저장 성공 후 JWT 발급.
 * verify-code(이메일 코드·사업자번호 뒤 6자리)와 응답 형태만 맞춘다.
 */

const { generateToken, getUserLevel } = require('../_utils');
const { getUser, createUser, updateUserLogin, updateUserLevel } = require('../_redis');

async function issueLoginForEmail(normalizedEmail) {
  let userData = await getUser(normalizedEmail);
  let isFirstLogin = false;
  const level = getUserLevel(normalizedEmail);
  if (!userData) {
    userData = await createUser(normalizedEmail, level);
    isFirstLogin = true;
  } else {
    isFirstLogin = userData.is_first_login === true;
    await updateUserLogin(normalizedEmail);
    if (userData.level !== level) await updateUserLevel(normalizedEmail, level);
    userData = await getUser(normalizedEmail);
  }

  const token = generateToken(normalizedEmail, userData.level);
  return {
    success: true,
    token,
    user: {
      email: userData.email,
      level: userData.level,
    },
    isFirstLogin: isFirstLogin || userData.is_first_login === true,
  };
}

module.exports = { issueLoginForEmail };
