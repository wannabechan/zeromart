/**
 * 관리자 이메일 정규화·판별 (api/_utils.js)
 * 실행: npm test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const UTILS_PATH = path.join(__dirname, '..', 'api', '_utils.js');

function loadUtils(env) {
  process.env.JWT_SECRET = env.JWT_SECRET || '01234567890123456789012345678901';
  if (Object.prototype.hasOwnProperty.call(env, 'EMAIL_ADMIN')) {
    process.env.EMAIL_ADMIN = env.EMAIL_ADMIN;
  } else {
    delete process.env.EMAIL_ADMIN;
  }
  delete require.cache[require.resolve(UTILS_PATH)];
  return require(UTILS_PATH);
}

test('getNormalizedAdminEmail strips quotes and lowercases', () => {
  const u = loadUtils({ EMAIL_ADMIN: '"Admin@Example.COM"' });
  assert.strictEqual(u.getNormalizedAdminEmail(), 'admin@example.com');
});

test('isAdminEmail matches EMAIL_ADMIN case-insensitively', () => {
  const u = loadUtils({ EMAIL_ADMIN: 'boss@co.kr' });
  assert.strictEqual(u.isAdminEmail('boss@co.kr'), true);
  assert.strictEqual(u.isAdminEmail('Boss@Co.Kr'), true);
  assert.strictEqual(u.isAdminEmail('other@co.kr'), false);
});

test('getUserLevel returns admin only for EMAIL_ADMIN', () => {
  const u = loadUtils({ EMAIL_ADMIN: 'a@b.c' });
  assert.strictEqual(u.getUserLevel('a@b.c'), 'admin');
  assert.strictEqual(u.getUserLevel('x@y.z'), 'user');
});

test('empty EMAIL_ADMIN: no admin match', () => {
  const u = loadUtils({ EMAIL_ADMIN: '' });
  assert.strictEqual(u.getNormalizedAdminEmail(), '');
  assert.strictEqual(u.isAdminEmail('any@where.com'), false);
});
