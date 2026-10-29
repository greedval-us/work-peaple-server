import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Shared by every deployment of this application, scoped to its PostgreSQL database.
const migrationLock = 1464873040;

export async function runMigrations(client, directory, log = console.log) {
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name).sort();
  let locked = false;
  try {
    await client.query("SET lock_timeout = '30s'");
    await client.query('SELECT pg_advisory_lock($1)', [migrationLock]);
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations');
    const applied = new Map(rows.map((row) => [row.filename, row.checksum]));
    const migrations = await Promise.all(names.map(async (name) => {
      const sql = (await readFile(join(directory, name), 'utf8')).replaceAll('\r\n', '\n');
      const checksum = createHash('sha256').update(sql).digest('hex');
      return { name, sql, checksum };
    }));
    // Detect modified history before applying any new SQL in this run.
    for (const { name, checksum } of migrations) {
      if (applied.has(name)) {
        if (applied.get(name) !== checksum) {
          throw new Error(`Migration ${name} changed after it was applied; restore it and add a new migration`);
        }
      }
    }
    for (const { name, sql, checksum } of migrations) {
      if (applied.has(name)) continue;
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      log(`Applied ${name}`);
    }
    if (names.length === 0) log('No SQL migrations to apply');
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [migrationLock]);
  }
}
