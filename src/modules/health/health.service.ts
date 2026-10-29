import { Inject, Injectable } from '@nestjs/common';
import { SERVER_CONFIG } from '../../config/configuration.module.js';
import type { ServerConfig } from '../../config/environment.js';
import { PostgresService } from '../../infrastructure/postgres.service.js';
import { RedisService } from '../../infrastructure/redis.service.js';
import { checkDependencies } from './health-check.js';
import type { HealthResponse } from './health-check.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly redis: RedisService,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  check(): Promise<HealthResponse> {
    // Leave time for gRPC serialization before a caller using the same timeout expires.
    const responseMarginMs = Math.min(100, Math.ceil(this.config.healthcheckTimeoutMs / 10));
    return checkDependencies({
      postgres: () => this.postgres.ping(),
      redis: () => this.redis.ping(),
    }, Math.max(1, this.config.healthcheckTimeoutMs - responseMarginMs));
  }
}
