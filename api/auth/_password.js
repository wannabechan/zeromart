/**
 * 로그인 비밀번호 해시·검증.
 * 인증 코드(이메일 6자리, 사업자번호 뒤 6자리)와 별도 경로에서만 사용한다.
 */

const crypto = require('crypto');

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 64;
const SCRYPT_KEYLEN = 32;

function validatePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return '비밀번호를 입력해 주세요.';
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상 ${PASSWORD_MAX_LENGTH}자 이하여야 합니다.`;
  }
  if (!password.trim()) {
    return '비밀번호를 입력해 주세요.';
  }
  return null;
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, { N: 16384, r: 8, p: 1 }, (err, buf) => {
      if (err) reject(err);
      else resolve(buf.toString('hex'));
    });
  });
}

async function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const password_hash = await hashPassword(password, salt);
  return { password_hash, password_salt: salt };
}

async function verifyPassword(password, user) {
  if (!user || typeof user.password_hash !== 'string' || typeof user.password_salt !== 'string') return false;
  if (typeof password !== 'string' || !password) return false;
  let actual;
  try {
    actual = Buffer.from(await hashPassword(password, user.password_salt), 'hex');
  } catch (_) {
    return false;
  }
  const expected = Buffer.from(user.password_hash, 'hex');
  if (actual.length !== expected.length || actual.length === 0) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function userHasPassword(user) {
  return !!(user && typeof user.password_hash === 'string' && user.password_hash && typeof user.password_salt === 'string' && user.password_salt);
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  validatePassword,
  createPasswordRecord,
  verifyPassword,
  userHasPassword,
};
