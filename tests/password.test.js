/**
 * 비밀번호 규칙 (api/auth/_password.js)
 * 실행: npm test
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validatePassword, createPasswordRecord, verifyPassword, PASSWORD_MIN_LENGTH } = require('../api/auth/_password');

test('validatePassword rejects short and accepts 8+', () => {
  assert.ok(validatePassword('short'));
  assert.strictEqual(validatePassword('a'.repeat(PASSWORD_MIN_LENGTH)), null);
  assert.ok(validatePassword('a'.repeat(65)));
  assert.ok(validatePassword('        '));
});

test('verifyPassword matches only the stored password', async () => {
  const record = await createPasswordRecord('correct-password');
  assert.strictEqual(await verifyPassword('correct-password', record), true);
  assert.strictEqual(await verifyPassword('other-password', record), false);
  assert.strictEqual(await verifyPassword('123456', record), false);
});
