import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedInitialAccess } from '../scripts/bootstrap.mjs';

test('bootstrap marker prevents recreating the default login after later changes', async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      return { rows: sql.startsWith('SELECT key') ? [{ key: 'initial_admin_v1' }] : [] };
    },
  };
  const result = await seedInitialAccess(client, { hashPassword: () => { throw new Error('must not reset credentials'); } });
  assert.deepEqual(result, { created: false });
  assert.ok(!queries.some((sql) => sql.includes('INSERT INTO users')));
  assert.equal(queries.at(-1), 'COMMIT');
});

test('bootstrap creates only the administrator and persists its completion marker atomically', async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT id FROM roles')) return { rows: [{ id: 'role-admin' }] };
      if (sql.startsWith('INSERT INTO users')) return { rows: [{ id: 'user-admin' }] };
      return { rows: [] };
    },
  };
  const result = await seedInitialAccess(client, { hashPassword: async (password: string) => {
    assert.equal(password, 'admin');
    return 'encoded-password-hash';
  } });
  assert.deepEqual(result, { created: true });
  assert.deepEqual(queries.find(({ sql }) => sql.startsWith('INSERT INTO users'))?.values, ['encoded-password-hash']);
  assert.ok(queries.some(({ sql }) => sql.startsWith('INSERT INTO bootstrap_state')));
  assert.equal(queries.at(-1)?.sql, 'COMMIT');
});

test('bootstrap failure rolls back rather than leaving a partial initial administrator', async () => {
  const queries: string[] = [];
  const client = { async query(sql: string) {
    queries.push(sql);
    return { rows: [] };
  } };
  await assert.rejects(seedInitialAccess(client), /System admin role is missing/);
  assert.equal(queries.at(-1), 'ROLLBACK');
});
