import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { HealthService } from './health.service.js';
import type { HealthResponse } from './health-check.js';

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @GrpcMethod('HealthService', 'Check')
  check(): Promise<HealthResponse> {
    return this.healthService.check();
  }
}
