import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
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

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
