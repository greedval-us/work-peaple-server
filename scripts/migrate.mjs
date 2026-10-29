import 'dotenv/config';
import { resolve } from 'node:path';
import pg from 'pg';
import { runMigrations } from './migrations.mjs';

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  try {
    const parsed = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('invalid');
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    query_timeout: 120000,
    application_name: 'work-people-migrations',
  });
  try {
    await client.connect();
    await runMigrations(client, resolve('migrations'));
  } finally {
    await client.end();
  }
}

void migrate().catch((error) => {
  console.error(`Migration failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
