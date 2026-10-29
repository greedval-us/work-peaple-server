import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { SERVER_CONFIG } from '../config/configuration.module.js';
import type { ServerConfig } from '../config/environment.js';

@Injectable()
export class PostgresService implements OnApplicationShutdown {
  private readonly logger = new Logger(PostgresService.name);
  private readonly pool: Pool;

  constructor(@Inject(SERVER_CONFIG) config: ServerConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      connectionTimeoutMillis: config.healthcheckTimeoutMs,
      idleTimeoutMillis: 30000,
      query_timeout: config.healthcheckTimeoutMs,
      statement_timeout: config.healthcheckTimeoutMs,
      application_name: 'work-people-server',
    });
    this.pool.on('error', () => this.logger.warn('PostgreSQL idle connection failed'));
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discardConnection = false;
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discardConnection = true;
        this.logger.warn('PostgreSQL transaction rollback failed');
      }
      throw error;
    } finally {
      client.release(discardConnection);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
