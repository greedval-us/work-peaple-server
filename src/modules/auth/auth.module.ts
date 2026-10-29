import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [InfrastructureModule],
  controllers: [AuthController],
  providers: [AuthRepository, AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthRepository, AuthService],
})
export class AuthModule {}
