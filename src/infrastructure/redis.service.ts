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

  async consumeLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    if (!this.client.isReady) throw new Error('Redis is not ready');
    const count = await this.client.withCommandOptions({ timeout: this.commandTimeoutMs }).eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return count`,
      { keys: [key], arguments: [String(windowSeconds)] },
    );
    if (typeof count !== 'number') throw new Error('Invalid rate limiter response');
    return count <= limit;
  }

  onApplicationShutdown(): void {
    // Discard pending commands and stop reconnect timers during application shutdown.
    if (this.client.isOpen) this.client.destroy();
  }
}
