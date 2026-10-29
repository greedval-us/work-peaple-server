import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';
import { SERVER_CONFIG } from '../config/configuration.module.js';
import type { ServerConfig } from '../config/environment.js';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: ReturnType<typeof createClient>;
  private readonly commandTimeoutMs: number;

  constructor(@Inject(SERVER_CONFIG) config: ServerConfig) {
    this.commandTimeoutMs = config.healthcheckTimeoutMs;
    this.client = createClient({
      url: config.redisUrl,
      disableOfflineQueue: true,
      commandsQueueMaxLength: 100,
      socket: {
        connectTimeout: config.healthcheckTimeoutMs,
        reconnectStrategy: (attempt) => Math.min(100 * 2 ** Math.min(attempt, 5), 3000),
      },
    });
    // Redis emits errors during reconnect; an event listener is required to keep the API alive.
    this.client.on('error', () => this.logger.warn('Redis connection unavailable; reconnecting'));
  }

  onModuleInit(): void {
    // Startup must not wait indefinitely while Redis is unavailable.
    void this.client.connect().catch(() => this.logger.warn('Redis connection stopped'));
  }

  async ping(): Promise<void> {
    if (!this.client.isReady) throw new Error('Redis is not ready');
    await this.client.withCommandOptions({ timeout: this.commandTimeoutMs }).ping();
  }

  onApplicationShutdown(): void {
    // No business writes exist yet; discard pending health probes and stop reconnect timers.
    if (this.client.isOpen) this.client.destroy();
  }
}
