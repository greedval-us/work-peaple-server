import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import { load } from '@grpc/proto-loader';

const repository = fileURLToPath(new URL('../', import.meta.url));

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return server.address().port;
}

async function within(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('compiled Nest gRPC server returns bounded degraded health and shuts down', { timeout: 20000 }, async () => {
  const sockets = new Set();
  // Accept TCP connections without replying, proving blackholed dependencies cannot block the API.
  const unavailableDependencies = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const dependencyPort = await listen(unavailableDependencies);
  const portReservation = createServer();
  const grpcPort = await listen(portReservation);
  await new Promise((resolveClose) => portReservation.close(resolveClose));

  let output = '';
  let client;
  // Emit the real shutdown signal event on every platform. Windows child.kill(SIGTERM)
  // forcibly terminates a process and would bypass Nest's shutdown hooks.
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    "import './dist/main.js'; process.on('message', (message) => { if (message === 'shutdown') process.emit('SIGTERM'); });"], {
    cwd: repository,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      GRPC_HOST: '127.0.0.1',
      GRPC_PORT: String(grpcPort),
      DATABASE_URL: `postgresql://test:test@127.0.0.1:${dependencyPort}/test`,
      REDIS_URL: `redis://127.0.0.1:${dependencyPort}`,
      GRPC_TLS_ENABLED: 'false',
      HEALTHCHECK_TIMEOUT_MS: '300',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-16000); });
  child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-16000); });
  const exited = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  try {
    const definition = await load(resolve(repository, 'proto/workpeople/v1/health.proto'), {
      keepCase: false, defaults: true, longs: String, enums: String, oneofs: true,
    });
    const { workpeople } = loadPackageDefinition(definition);
    client = new workpeople.v1.HealthService(`127.0.0.1:${grpcPort}`, credentials.createInsecure());
    await new Promise((resolveReady, reject) => {
      client.waitForReady(Date.now() + 10000, (error) => error ? reject(new Error(`${error.message}\n${output}`)) : resolveReady());
    });
    const startedAt = performance.now();
    const response = await new Promise((resolveResponse, reject) => {
      client.check({}, { deadline: Date.now() + 1500 }, (error, result) => error ? reject(error) : resolveResponse(result));
    });
    assert.equal(response.status, 'degraded');
    assert.equal(response.service, 'work-people-server');
    assert.equal(response.version, '0.1.0');
    assert.deepEqual(response.dependencies, { postgres: 'down', redis: 'down' });
    assert.ok(Number.isFinite(Date.parse(response.checkedAt)));
    assert.ok(performance.now() - startedAt < 1000, 'health must stay responsive with blackholed dependencies');

    client.close();
    client = undefined;
    child.send('shutdown');
    const exit = await within(exited, 4000, `Nest shutdown did not close dependency handles\n${output}`);
    assert.ok(exit.signal === 'SIGTERM' || exit.code === 0, `Unexpected exit: ${JSON.stringify(exit)}\n${output}`);
  } finally {
    client?.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await within(exited, 3000, 'Child process cleanup timed out');
    }
    for (const socket of sockets) socket.destroy();
    await new Promise((resolveClose) => unavailableDependencies.close(resolveClose));
  }
});
