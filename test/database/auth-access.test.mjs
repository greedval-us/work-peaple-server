import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { credentials, loadPackageDefinition, Metadata, status } from '@grpc/grpc-js';
import { load } from '@grpc/proto-loader';
import pg from 'pg';
import { runMigrations } from '../../scripts/migrations.mjs';
import { seedInitialAccess } from '../../scripts/bootstrap.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const tokenDigest = (token) => createHash('sha256').update(token).digest('hex');

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

function rpc(client, method, input = {}, token) {
  const metadata = new Metadata();
  if (token) metadata.set('authorization', `Bearer ${token}`);
  return new Promise((resolveResponse, reject) => {
    client[method](input, metadata, { deadline: Date.now() + 15000 }, (error, response) => {
      if (error) reject(error);
      else resolveResponse(response);
    });
  });
}

async function denied(client, method, input, token, expectedCode) {
  try {
    await rpc(client, method, input, token);
  } catch (error) {
    assert.equal(error.code, expectedCode, `${method} must reject with the expected gRPC status`);
    return { code: error.code, details: error.details };
  }
  assert.fail(`${method} must reject the request`);
}

async function startServer(packageTypes, databaseUrl, redisUrl, options = {}) {
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise((resolveClose) => reservation.close(resolveClose));
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    "import './dist/main.js'; process.on('message', (message) => { if (message === 'shutdown') process.emit('SIGTERM'); });"], {
    cwd: repository,
    env: {
      ...process.env,
      NODE_ENV: 'test', GRPC_HOST: '127.0.0.1', GRPC_PORT: String(port),
      DATABASE_URL: databaseUrl, REDIS_URL: redisUrl, GRPC_TLS_ENABLED: 'false',
      HEALTHCHECK_TIMEOUT_MS: '300', AUTH_SESSION_TTL_SECONDS: '43200',
      AUTH_LOGIN_MAX_ATTEMPTS: String(options.maximumAttempts ?? 20), AUTH_LOGIN_WINDOW_SECONDS: '300',
    },
    // The test prints assertions only; child logs must not expose connection strings or credentials.
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  });
  const exited = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  void exited.catch(() => undefined);
  const address = `127.0.0.1:${port}`;
  const auth = new packageTypes.AuthService(address, credentials.createInsecure());
  const access = new packageTypes.AccessService(address, credentials.createInsecure());
  const health = new packageTypes.HealthService(address, credentials.createInsecure());
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    auth.close(); access.close(); health.close();
    if (child.exitCode === null && child.signalCode === null) {
      if (child.connected) child.send('shutdown');
      try {
        await within(exited, 4000, 'API test process did not shut down');
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    }
    await within(exited, 3000, 'API test process cleanup timed out');
  };
  try {
    await new Promise((resolveReady, reject) => {
      auth.waitForReady(Date.now() + 10000, (error) => error ? reject(new Error('Scratch API did not become ready')) : resolveReady());
    });
    if (options.waitForDependencies !== false) {
      const deadline = Date.now() + 8000;
      while ((await rpc(health, 'check')).status !== 'ok') {
        if (Date.now() >= deadline) throw new Error('Scratch API dependencies did not become ready');
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
    }
    return { auth, access, health, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

test('real PostgreSQL and Redis enforce authentication and role boundaries without touching application data', { timeout: 180000 }, async (t) => {
  const databaseUrl = process.env.DATABASE_URL;
  const passedRedisUrl = process.env.REDIS_URL;
  assert.ok(databaseUrl && passedRedisUrl, 'DATABASE_URL and REDIS_URL are required for isolated database tests');
  const scratchName = `workpeople_auth_test_${randomBytes(8).toString('hex')}`;
  const validScratchName = () => /^workpeople_auth_test_[0-9a-f]{16}$/.test(scratchName);
  assert.ok(validScratchName(), 'Only a generated scratch database name is allowed');
  const scratchUrl = new URL(databaseUrl);
  scratchUrl.pathname = `/${scratchName}`;
  const redisUrl = new URL(passedRedisUrl);
  redisUrl.pathname = '/15';
  const administrator = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 15000 });
  const database = new pg.Client({ connectionString: scratchUrl.href, connectionTimeoutMillis: 5000, query_timeout: 15000 });
  const servers = [];
  let created = false;
  let databaseConnected = false;
  let administratorConnected = false;
  let blackhole;
  const blackholeSockets = new Set();
  const suffix = randomBytes(4).toString('hex');
  const fixturePassword = 'FixturePassword123!';
  const resetPassword = 'ResetPassword123!';
  const changedPassword = 'ChangedPassword123!';
  const adminPassword = 'ChangedAdministrator123!';
  let adminToken;
  let admin;
  let adminRole;
  let reader;
  let readerRole;
  let readerToken;
  let readerSecondToken;
  let api;
  let packageTypes;
  try {
    await administrator.connect(); administratorConnected = true;
    // The supplied database connection is used only to create and remove this generated scratch database.
    await administrator.query(`CREATE DATABASE "${scratchName}"`);
    created = true;
    await database.connect(); databaseConnected = true;
    await runMigrations(database, resolve(repository, 'migrations'), () => undefined);
    assert.deepEqual(await seedInitialAccess(database), { created: true });
    const definition = await load(['health.proto', 'auth.proto', 'access.proto'].map((file) => resolve(repository, 'proto/workpeople/v1', file)), {
      keepCase: false, defaults: true, longs: String, enums: String, oneofs: true,
    });
    packageTypes = loadPackageDefinition(definition).workpeople.v1;
    api = await startServer(packageTypes, scratchUrl.href, redisUrl.href); servers.push(api);

    await t.test('seed creates one administrator and private RPCs deny missing credentials', async () => {
      const users = await database.query('SELECT login FROM users ORDER BY login');
      assert.deepEqual(users.rows, [{ login: 'admin' }]);
      const roles = await database.query('SELECT code, is_system FROM roles ORDER BY code');
      assert.deepEqual(roles.rows, [{ code: 'admin', is_system: true }]);
      await denied(api.auth, 'getCurrentUser', {}, undefined, status.UNAUTHENTICATED);
      await denied(api.access, 'listUsers', {}, undefined, status.UNAUTHENTICATED);
      await new Promise((resolveResponse, reject) => {
        api.auth.makeUnaryRequest('/workpeople.v1.AuthService/Register', (value) => value, (value) => value,
          Buffer.alloc(0), new Metadata(), { deadline: Date.now() + 5000 }, (error) => {
            try { assert.equal(error?.code, status.UNIMPLEMENTED); resolveResponse(); } catch (assertion) { reject(assertion); }
          });
      });
      const login = await rpc(api.auth, 'login', { login: ' ADMIN ', password: 'admin' });
      adminToken = login.sessionToken; admin = login.user;
      assert.equal(admin.login, 'admin');
      assert.equal(/^[A-Za-z0-9_-]{43}$/.test(adminToken), true, 'Login returns a bounded opaque session token');
      const lifetime = Date.parse(login.expiresAt) - Date.now();
      assert.ok(lifetime > 43190000 && lifetime <= 43200000, 'Default session lifetime is twelve hours');
      assert.equal(Object.hasOwn(admin, 'passwordHash'), false);
      assert.equal(admin.roles.length, 1);
      adminRole = admin.roles[0];
      assert.equal(adminRole.code, 'admin');
      const sessions = await database.query('SELECT token_hash FROM auth_sessions WHERE user_id = $1', [admin.id]);
      assert.equal(sessions.rows.length, 1);
      assert.equal(sessions.rows[0].token_hash === adminToken, false);
      assert.equal(sessions.rows[0].token_hash === tokenDigest(adminToken), true);
      assert.match(sessions.rows[0].token_hash, /^[0-9a-f]{64}$/);
      assert.deepEqual(await seedInitialAccess(database), { created: false });
    });

    let genericLoginFailure;
    await t.test('unknown users and wrong passwords return the same generic rejection', async () => {
      genericLoginFailure = await denied(api.auth, 'login', { login: 'admin', password: 'wrong-password' }, undefined, status.UNAUTHENTICATED);
      const unknown = await denied(api.auth, 'login', { login: `missing_${suffix}`, password: 'wrong-password' }, undefined, status.UNAUTHENTICATED);
      assert.deepEqual(unknown, genericLoginFailure);
    });

    await t.test('read-only users can read but cannot create roles and existing sessions see permission edits', async () => {
      readerRole = await rpc(api.access, 'createRole', {
        code: `reader_${suffix}`, name: 'Read only', permissionCodes: ['users.read'],
      }, adminToken);
      reader = await rpc(api.access, 'createUser', {
        login: `reader_${suffix}`, password: fixturePassword, firstName: 'Original', lastName: 'Family',
        middleName: 'Middle', email: `reader_${suffix}@example.invalid`, phone: '+10000000000', roleIds: [readerRole.id],
      }, adminToken);
      readerToken = (await rpc(api.auth, 'login', { login: reader.login, password: fixturePassword })).sessionToken;
      assert.ok((await rpc(api.access, 'listUsers', {}, readerToken)).users.some((user) => user.id === reader.id));
      await denied(api.access, 'createRole', { code: `forbidden_${suffix}`, name: 'Forbidden' }, readerToken, status.PERMISSION_DENIED);
      await rpc(api.access, 'setRolePermissions', { roleId: readerRole.id, permissionCodes: [] }, adminToken);
      assert.deepEqual((await rpc(api.auth, 'getCurrentUser', {}, readerToken)).permissions, []);
      await denied(api.access, 'listUsers', {}, readerToken, status.PERMISSION_DENIED);
      await rpc(api.access, 'setRolePermissions', { roleId: readerRole.id, permissionCodes: ['users.read'] }, adminToken);
      assert.equal((await rpc(api.access, 'listUsers', {}, readerToken)).total, 2);
      // New permission catalog entries are effective for the administrator role immediately.
      await database.query("INSERT INTO permissions (code, resource, name) VALUES ('reports.review', 'reports', 'Review reports')");
      assert.ok((await rpc(api.auth, 'getCurrentUser', {}, adminToken)).permissions.includes('reports.review'));
    });

    await t.test('unknown role and permission references reject atomically', async () => {
      const before = (await database.query('SELECT count(*)::integer AS total FROM users')).rows[0].total;
      await denied(api.access, 'createUser', {
        login: `unknown_role_${suffix}`, password: fixturePassword, roleIds: [randomUUID()],
      }, adminToken, status.INVALID_ARGUMENT);
      assert.equal((await database.query('SELECT count(*)::integer AS total FROM users')).rows[0].total, before);
      await denied(api.access, 'setUserRoles', { userId: reader.id, roleIds: [randomUUID()] }, adminToken, status.INVALID_ARGUMENT);
      assert.deepEqual((await rpc(api.auth, 'getCurrentUser', {}, readerToken)).roles.map((role) => role.id), [readerRole.id]);
      await denied(api.access, 'createRole', {
        code: `unknown_permission_${suffix}`, name: 'Invalid role', permissionCodes: ['unimplemented.permission'],
      }, adminToken, status.INVALID_ARGUMENT);
      assert.equal((await database.query('SELECT id FROM roles WHERE code = $1', [`unknown_permission_${suffix}`])).rowCount, 0);
      await denied(api.access, 'setRolePermissions', {
        roleId: readerRole.id, permissionCodes: ['unimplemented.permission'],
      }, adminToken, status.INVALID_ARGUMENT);
      assert.deepEqual((await rpc(api.auth, 'getCurrentUser', {}, readerToken)).permissions, ['users.read']);
    });

    await t.test('system roles and the last active administrator are protected', async () => {
      await denied(api.access, 'updateRole', { id: adminRole.id, name: 'Changed' }, adminToken, status.FAILED_PRECONDITION);
      await denied(api.access, 'deleteRole', { id: adminRole.id }, adminToken, status.FAILED_PRECONDITION);
      await denied(api.access, 'setRolePermissions', { roleId: adminRole.id, permissionCodes: [] }, adminToken, status.FAILED_PRECONDITION);
      await denied(api.access, 'updateUser', { id: admin.id, isActive: false }, adminToken, status.FAILED_PRECONDITION);
      await denied(api.access, 'setUserRoles', { userId: admin.id, roleIds: [] }, adminToken, status.FAILED_PRECONDITION);
      const current = await rpc(api.auth, 'getCurrentUser', {}, adminToken);
      assert.equal(current.isActive, true);
      assert.deepEqual(current.roles.map((role) => role.code), ['admin']);
    });

    await t.test('delegated management cannot reset administrators or grant administrator and higher rights', async () => {
      const delegateRole = await rpc(api.access, 'createRole', {
        code: `delegate_${suffix}`, name: 'Delegated management', permissionCodes: ['users.read', 'users.update', 'users.roles.assign'],
      }, adminToken);
      const higherRole = await rpc(api.access, 'createRole', {
        code: `higher_${suffix}`, name: 'Higher rights', permissionCodes: ['roles.create'],
      }, adminToken);
      const delegate = await rpc(api.access, 'createUser', {
        login: `delegate_${suffix}`, password: fixturePassword, roleIds: [delegateRole.id],
      }, adminToken);
      const token = (await rpc(api.auth, 'login', { login: delegate.login, password: fixturePassword })).sessionToken;
      await denied(api.access, 'updateUser', { id: admin.id, password: 'ForbiddenReset123!' }, token, status.PERMISSION_DENIED);
      await denied(api.access, 'setUserRoles', { userId: reader.id, roleIds: [adminRole.id] }, token, status.PERMISSION_DENIED);
      await denied(api.access, 'setUserRoles', { userId: reader.id, roleIds: [higherRole.id] }, token, status.PERMISSION_DENIED);
      assert.deepEqual((await rpc(api.auth, 'getCurrentUser', {}, readerToken)).permissions, ['users.read']);
    });

    await t.test('partial profile changes preserve absent fields and explicit empty values clear contacts', async () => {
      const updated = await rpc(api.access, 'updateUser', { id: reader.id, firstName: 'Changed name' }, adminToken);
      assert.equal(updated.firstName, 'Changed name');
      assert.equal(updated.login, reader.login);
      assert.equal(updated.isActive, true);
      assert.equal(updated.lastName, 'Family');
      assert.equal(updated.middleName, 'Middle');
      assert.equal(updated.email, reader.email);
      assert.equal(updated.phone, reader.phone);
      readerSecondToken = (await rpc(api.auth, 'login', { login: reader.login, password: fixturePassword })).sessionToken;
      const cleared = await rpc(api.access, 'updateUser', { id: reader.id, email: '', phone: '' }, adminToken);
      assert.equal(cleared.email, ''); assert.equal(cleared.phone, '');
      assert.equal(cleared.login, reader.login); assert.equal(cleared.isActive, true);
    });

    await t.test('disabling and administrative password reset revoke every affected session', async () => {
      const disabled = await rpc(api.access, 'updateUser', { id: reader.id, isActive: false }, adminToken);
      assert.equal(disabled.isActive, false);
      for (const token of [readerToken, readerSecondToken]) await denied(api.auth, 'getCurrentUser', {}, token, status.UNAUTHENTICATED);
      const disabledFailure = await denied(api.auth, 'login', { login: reader.login, password: fixturePassword }, undefined, status.UNAUTHENTICATED);
      assert.deepEqual(disabledFailure, genericLoginFailure);
      await rpc(api.access, 'updateUser', { id: reader.id, isActive: true }, adminToken);
      const first = (await rpc(api.auth, 'login', { login: reader.login, password: fixturePassword })).sessionToken;
      const second = (await rpc(api.auth, 'login', { login: reader.login, password: fixturePassword })).sessionToken;
      await rpc(api.access, 'updateUser', { id: reader.id, password: resetPassword }, adminToken);
      for (const token of [first, second]) await denied(api.auth, 'getCurrentUser', {}, token, status.UNAUTHENTICATED);
      await denied(api.auth, 'login', { login: reader.login, password: fixturePassword }, undefined, status.UNAUTHENTICATED);
      readerToken = (await rpc(api.auth, 'login', { login: reader.login, password: resetPassword })).sessionToken;
    });

    await t.test('logout and expiry reject otherwise valid session tokens', async () => {
      await rpc(api.auth, 'logout', {}, readerToken);
      await denied(api.auth, 'getCurrentUser', {}, readerToken, status.UNAUTHENTICATED);
      const expiring = (await rpc(api.auth, 'login', { login: reader.login, password: resetPassword })).sessionToken;
      await database.query(
        "UPDATE auth_sessions SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE token_hash = $1",
        [tokenDigest(expiring)],
      );
      await denied(api.auth, 'getCurrentUser', {}, expiring, status.UNAUTHENTICATED);
    });

    await t.test('changing a password verifies the current value and revokes all sessions atomically', async () => {
      const first = (await rpc(api.auth, 'login', { login: reader.login, password: resetPassword })).sessionToken;
      const second = (await rpc(api.auth, 'login', { login: reader.login, password: resetPassword })).sessionToken;
      await denied(api.auth, 'changePassword', { currentPassword: 'wrong-password', newPassword: changedPassword }, first, status.UNAUTHENTICATED);
      await denied(api.auth, 'changePassword', { currentPassword: resetPassword, newPassword: 'short' }, first, status.INVALID_ARGUMENT);
      assert.equal((await rpc(api.auth, 'getCurrentUser', {}, first)).id, reader.id);
      await rpc(api.auth, 'changePassword', { currentPassword: resetPassword, newPassword: changedPassword }, first);
      for (const token of [first, second]) await denied(api.auth, 'getCurrentUser', {}, token, status.UNAUTHENTICATED);
      await denied(api.auth, 'login', { login: reader.login, password: resetPassword }, undefined, status.UNAUTHENTICATED);
      assert.equal((await rpc(api.auth, 'login', { login: reader.login, password: changedPassword })).user.id, reader.id);
    });

    await t.test('bootstrap reruns preserve a changed administrator password and renamed login', async () => {
      await rpc(api.auth, 'changePassword', { currentPassword: 'admin', newPassword: adminPassword }, adminToken);
      await denied(api.auth, 'getCurrentUser', {}, adminToken, status.UNAUTHENTICATED);
      await denied(api.auth, 'login', { login: 'admin', password: 'admin' }, undefined, status.UNAUTHENTICATED);
      adminToken = (await rpc(api.auth, 'login', { login: 'admin', password: adminPassword })).sessionToken;
      assert.deepEqual(await seedInitialAccess(database), { created: false });
      admin = await rpc(api.access, 'updateUser', { id: admin.id, login: `owner_${suffix}` }, adminToken);
      const count = (await database.query('SELECT count(*)::integer AS total FROM users')).rows[0].total;
      await runMigrations(database, resolve(repository, 'migrations'), () => undefined);
      assert.deepEqual(await seedInitialAccess(database), { created: false });
      assert.equal((await database.query("SELECT id FROM users WHERE login = 'admin'")).rowCount, 0);
      assert.equal((await database.query('SELECT count(*)::integer AS total FROM users')).rows[0].total, count);
      await denied(api.auth, 'login', { login: 'admin', password: 'admin' }, undefined, status.UNAUTHENTICATED);
      adminToken = (await rpc(api.auth, 'login', { login: admin.login, password: adminPassword })).sessionToken;
    });

    await t.test('concurrent administrator self-disables cannot remove the final active administrator', async () => {
      const secondAdmin = await rpc(api.access, 'createUser', {
        login: `second_admin_${suffix}`, password: fixturePassword, roleIds: [adminRole.id],
      }, adminToken);
      const secondToken = (await rpc(api.auth, 'login', { login: secondAdmin.login, password: fixturePassword })).sessionToken;
      const results = await Promise.allSettled([
        rpc(api.access, 'updateUser', { id: admin.id, isActive: false }, adminToken),
        rpc(api.access, 'updateUser', { id: secondAdmin.id, isActive: false }, secondToken),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = results.find((result) => result.status === 'rejected');
      assert.equal(rejected.reason.code, status.FAILED_PRECONDITION);
      const active = await database.query(`
        SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id WHERE u.is_active = true AND r.code = 'admin'`);
      assert.equal(active.rows.length, 1);
    });

    await t.test('login throttling rejects attempts after the configured budget', async () => {
      const limited = await startServer(packageTypes, scratchUrl.href, redisUrl.href, { maximumAttempts: 2 }); servers.push(limited);
      const request = { login: `limited_${suffix}`, password: 'wrong-password' };
      await denied(limited.auth, 'login', request, undefined, status.UNAUTHENTICATED);
      await denied(limited.auth, 'login', request, undefined, status.UNAUTHENTICATED);
      await denied(limited.auth, 'login', request, undefined, status.RESOURCE_EXHAUSTED);
      await limited.stop();
    });

    await t.test('Redis failure closes login with a bounded unavailable response and health remains public', async () => {
      blackhole = createServer((socket) => {
        blackholeSockets.add(socket);
        socket.on('close', () => blackholeSockets.delete(socket));
      });
      const port = await listen(blackhole);
      const unavailable = await startServer(packageTypes, scratchUrl.href, `redis://127.0.0.1:${port}/15`, { waitForDependencies: false }); servers.push(unavailable);
      const count = (await database.query('SELECT count(*)::integer AS total FROM auth_sessions')).rows[0].total;
      const started = performance.now();
      await denied(unavailable.auth, 'login', { login: `redis_failure_${suffix}`, password: fixturePassword }, undefined, status.UNAVAILABLE);
      assert.ok(performance.now() - started < 2000, 'Redis outage must not leave login waiting indefinitely');
      assert.equal((await database.query('SELECT count(*)::integer AS total FROM auth_sessions')).rows[0].total, count);
      assert.equal((await rpc(unavailable.health, 'check')).dependencies.redis, 'down');
      await unavailable.stop();
    });
  } finally {
    const cleanupErrors = [];
    for (const server of servers.reverse()) {
      try { await server.stop(); } catch { cleanupErrors.push('API cleanup failed'); }
    }
    for (const socket of blackholeSockets) socket.destroy();
    if (blackhole?.listening) await new Promise((resolveClose) => blackhole.close(resolveClose));
    if (databaseConnected) {
      try { await database.end(); } catch { cleanupErrors.push('Scratch connection cleanup failed'); }
    }
    if (created) {
      // Validate immediately before the destructive statement, and never use the supplied database name.
      assert.ok(validScratchName(), 'Refusing to drop a database outside the generated scratch prefix');
      try { await administrator.query(`DROP DATABASE "${scratchName}" WITH (FORCE)`); } catch { cleanupErrors.push('Scratch database cleanup failed'); }
    }
    if (administratorConnected) {
      try { await administrator.end(); } catch { cleanupErrors.push('Administrator connection cleanup failed'); }
    }
    assert.deepEqual(cleanupErrors, [], 'Isolated database test resources must be removed');
  }
});
