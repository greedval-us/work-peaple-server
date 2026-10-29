import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnvironment } from '../src/config/environment.ts';

const required = {
  DATABASE_URL: 'postgresql://work_people:password@localhost:5432/work_people',
  REDIS_URL: 'redis://localhost:6379',
};

test('environment provides documented local defaults', () => {
  const config = parseEnvironment(required);
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.grpcHost, '0.0.0.0');
  assert.equal(config.grpcPort, 50051);
  assert.equal(config.grpcTlsEnabled, false);
  assert.equal(config.healthcheckTimeoutMs, 3000);
  assert.equal(config.sessionTtlSeconds, 43200);
  assert.equal(config.authLoginMaxAttempts, 5);
  assert.equal(config.authLoginWindowSeconds, 300);
});

test('environment rejects invalid ports, timeouts and booleans', () => {
  for (const port of ['0', '65536', '1.5', '50051suffix', '']) {
    assert.throws(() => parseEnvironment({ ...required, GRPC_PORT: port }), /GRPC_PORT/);
  }
  for (const timeout of ['0', '-1', '1.5', '30001']) {
    assert.throws(
      () => parseEnvironment({ ...required, HEALTHCHECK_TIMEOUT_MS: timeout }),
      /HEALTHCHECK_TIMEOUT_MS/,
    );
  }
  assert.throws(
    () => parseEnvironment({ ...required, GRPC_TLS_ENABLED: 'yes' }),
    /GRPC_TLS_ENABLED/,
  );
  for (const name of ['AUTH_SESSION_TTL_SECONDS', 'AUTH_LOGIN_MAX_ATTEMPTS', 'AUTH_LOGIN_WINDOW_SECONDS']) {
    assert.throws(() => parseEnvironment({ ...required, [name]: '0' }), new RegExp(name));
    assert.throws(() => parseEnvironment({ ...required, [name]: 'not-an-integer' }), new RegExp(name));
  }
});

test('environment requires database URLs without echoing credentials', () => {
  assert.throws(() => parseEnvironment({}), /DATABASE_URL/);
  assert.throws(() => parseEnvironment({ ...required, REDIS_URL: 'http://secret:password@localhost' }),
    (error: unknown) => error instanceof Error && /REDIS_URL/.test(error.message)
      && !error.message.includes('secret') && !error.message.includes('password'));
  assert.throws(() => parseEnvironment({ ...required, DATABASE_URL: 'redis://localhost' }), /DATABASE_URL/);
});

test('TLS requires both certificate and key paths', () => {
  assert.throws(() => parseEnvironment({ ...required, GRPC_TLS_ENABLED: 'true' }), /GRPC_TLS_CERT_PATH/);
  assert.throws(() => parseEnvironment({ ...required, GRPC_TLS_ENABLED: 'true', GRPC_TLS_CERT_PATH: 'server.crt' }), /GRPC_TLS_KEY_PATH/);
  const config = parseEnvironment({ ...required, GRPC_TLS_ENABLED: 'true', GRPC_TLS_CERT_PATH: 'server.crt', GRPC_TLS_KEY_PATH: 'server.key' });
  assert.equal(config.grpcTlsEnabled, true);
});
