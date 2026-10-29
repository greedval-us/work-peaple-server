import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword, PasswordWorkQueue } from '../src/modules/auth/password.ts';

test('password hashes use random salts and reject a different password', async () => {
  const first = await hashPassword('correct horse battery staple');
  const second = await hashPassword('correct horse battery staple');
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$v1\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
  assert.equal(await verifyPassword('correct horse battery staple', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
});

test('password verification rejects malformed and attacker-selected work factors', async () => {
  for (const hash of ['', 'plain-password', 'scrypt$v1$2$8$1$bad$bad', 'scrypt$v2$131072$8$1$bad$bad']) {
    assert.equal(await verifyPassword('admin', hash), false);
  }
});

test('password work queue bounds active work and rejects excess queued work', async () => {
  const queue = new PasswordWorkQueue(1, 1);
  let finishFirst!: () => void;
  let secondStarted = false;
  const first = queue.run(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
  const second = queue.run(async () => { secondStarted = true; return 'second'; });
  assert.equal(secondStarted, false);
  await assert.rejects(queue.run(async () => 'overflow'), { name: 'PasswordWorkBusyError' });
  finishFirst();
  await first;
  assert.equal(await second, 'second');
});

test('failed password work releases the next queued operation', async () => {
  const queue = new PasswordWorkQueue(1, 1);
  let rejectFirst!: (reason: Error) => void;
  const first = queue.run(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }));
  const second = queue.run(async () => 'recovered');
  rejectFirst(new Error('failure'));
  await assert.rejects(first, /failure/);
  assert.equal(await second, 'recovered');
});
