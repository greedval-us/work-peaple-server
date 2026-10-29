import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { runMigrations } from '../scripts/migrations.mjs';

async function migrationDirectory(t: TestContext, files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'work-people-migrations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) await writeFile(join(directory, name), contents);
  return directory;
}

function connection(applied: { filename: string; checksum: string }[] = [], failSql?: string) {
  const statements: string[] = [];
  return {
    statements,
    async query(sql: string, _parameters?: unknown[]) {
      statements.push(sql);
      if (sql === failSql) throw new Error('migration SQL failed');
      return { rows: sql.startsWith('SELECT filename') ? applied : [] };
    },
  };
}

test('migrations validate every applied checksum before running pending SQL', async (t) => {
  const directory = await migrationDirectory(t, { '001_new.sql': 'SELECT 1;', '002_applied.sql': 'changed;' });
  const client = connection([{ filename: '002_applied.sql', checksum: 'old-checksum' }]);
  await assert.rejects(runMigrations(client, directory, () => {}), /changed after it was applied/);
  assert.ok(!client.statements.includes('SELECT 1;'));
  assert.ok(client.statements.at(-1)?.includes('pg_advisory_unlock'));
});

test('migrations lock, skip applied SQL and commit each pending file', async (t) => {
  const appliedSql = 'SELECT 1;';
  const directory = await migrationDirectory(t, { '001_applied.sql': appliedSql, '002_pending.sql': 'SELECT 2;', '.gitkeep': '', 'README.md': 'instructions' });
  const checksum = createHash('sha256').update(appliedSql).digest('hex');
  const client = connection([{ filename: '001_applied.sql', checksum }]);
  await runMigrations(client, directory, () => {});
  assert.ok(client.statements[1]?.includes('pg_advisory_lock'));
  assert.ok(!client.statements.includes(appliedSql));
  const begin = client.statements.indexOf('BEGIN');
  assert.deepEqual(client.statements.slice(begin, begin + 2), ['BEGIN', 'SELECT 2;']);
  assert.ok(client.statements[begin + 2]?.startsWith('INSERT INTO schema_migrations'));
  assert.equal(client.statements[begin + 3], 'COMMIT');
  assert.ok(client.statements.at(-1)?.includes('pg_advisory_unlock'));
});

test('migrations treat CRLF checkout as the same applied LF migration', async (t) => {
  const appliedSql = 'SELECT 1;\nSELECT 2;\n';
  const directory = await migrationDirectory(t, { '001_applied.sql': appliedSql.replaceAll('\n', '\r\n') });
  const checksum = createHash('sha256').update(appliedSql).digest('hex');
  const client = connection([{ filename: '001_applied.sql', checksum }]);
  await runMigrations(client, directory, () => {});
  assert.ok(!client.statements.includes('BEGIN'));
  assert.ok(client.statements.at(-1)?.includes('pg_advisory_unlock'));
});

test('failed migration rolls back and releases its advisory lock', async (t) => {
  const directory = await migrationDirectory(t, { '001_failure.sql': 'broken sql;' });
  const client = connection([], 'broken sql;');
  await assert.rejects(runMigrations(client, directory, () => {}), /migration SQL failed/);
  assert.ok(client.statements.includes('ROLLBACK'));
  assert.ok(!client.statements.includes('COMMIT'));
  assert.ok(client.statements.at(-1)?.includes('pg_advisory_unlock'));
});
