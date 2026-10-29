import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AccessController } from './access.controller.js';
import { AccessRepository } from './access.repository.js';
import { AccessService } from './access.service.js';

@Module({
  imports: [InfrastructureModule, AuthModule],
  controllers: [AccessController],
  providers: [AccessRepository, AccessService],
})
export class AccessModule {}
