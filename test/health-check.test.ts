import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkDependencies } from '../src/modules/health/health-check.ts';

test('health reports dependency failures without rejecting the gRPC request', async () => {
  const result = await checkDependencies({
    postgres: async () => { throw new Error('database unavailable'); },
    redis: async () => undefined,
  }, 100);
  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.dependencies, { postgres: 'down', redis: 'up' });
  assert.equal(result.service, 'work-people-server');
  assert.equal(result.version, '0.1.0');
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
});

test('health bounds dependencies that never settle', async () => {
  const startedAt = performance.now();
  const result = await checkDependencies({
    postgres: () => new Promise<void>(() => {}),
    redis: () => new Promise<void>(() => {}),
  }, 30);
  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.dependencies, { postgres: 'down', redis: 'down' });
  assert.ok(performance.now() - startedAt < 500);
});

test('health reports ok only when every dependency succeeds', async () => {
  const result = await checkDependencies({ postgres: async () => undefined, redis: async () => undefined }, 100);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.dependencies, { postgres: 'up', redis: 'up' });
});
