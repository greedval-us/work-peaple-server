import { Module } from '@nestjs/common';
import { PostgresService } from './postgres.service.js';
import { RedisService } from './redis.service.js';

@Module({ providers: [PostgresService, RedisService], exports: [PostgresService, RedisService] })
export class InfrastructureModule {}
