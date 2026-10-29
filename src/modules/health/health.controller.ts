import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { HealthService } from './health.service.js';
import type { HealthResponse } from './health-check.js';
import { Public } from '../auth/auth.decorators.js';

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @GrpcMethod('HealthService', 'Check')
  @Public()
  check(): Promise<HealthResponse> {
    return this.healthService.check();
  }
}
