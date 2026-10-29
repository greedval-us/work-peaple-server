import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionToken, hashSessionToken, readBearerToken, normalizeLogin, validPassword } from '../src/modules/auth/auth.security.ts';

test('session tokens contain 256 bits of randomness and persist only a digest', () => {
  const first = createSessionToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, createSessionToken());
  assert.equal(hashSessionToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(hashSessionToken(first), first);
});

test('authorization accepts exactly one bounded bearer token', () => {
  const token = 'A'.repeat(43);
  assert.equal(readBearerToken([`Bearer ${token}`]), token);
  assert.equal(readBearerToken([`bearer ${token}`]), token);
  for (const values of [[], [`Bearer ${token}`, `Bearer ${token}`], ['Bearer short'], [Buffer.from(token)], [`Basic ${token}`], [`Bearer ${token} extra`]]) {
    assert.equal(readBearerToken(values), null);
  }
});

test('logins normalize case and whitespace but reject unusable or oversized values', () => {
  assert.equal(normalizeLogin('  Admin  '), 'admin');
  assert.equal(normalizeLogin('some.user-2'), 'some.user-2');
  for (const value of ['', 'ab', 'a'.repeat(65), 'admin@example.test', '../admin', null, {}]) {
    assert.equal(normalizeLogin(value), null);
  }
});

test('password validation permits the seed password for login and requires eight for changes', () => {
  assert.equal(validPassword('admin'), true);
  assert.equal(validPassword('admin', 8), false);
  assert.equal(validPassword('eight123', 8), true);
  for (const value of ['', 'a'.repeat(257), null, {}]) assert.equal(validPassword(value), false);
});
