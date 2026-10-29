import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({ imports: [InfrastructureModule], controllers: [HealthController], providers: [HealthService] })
export class HealthModule {}
