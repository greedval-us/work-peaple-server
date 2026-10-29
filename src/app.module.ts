import { Module } from '@nestjs/common';
import { ConfigurationModule } from './config/configuration.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DepartmentsModule } from './modules/departments/departments.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AccessModule } from './modules/access/access.module.js';

@Module({ imports: [ConfigurationModule, HealthModule, AuthModule, AccessModule, EmployeesModule, DepartmentsModule] })
export class AppModule {}
