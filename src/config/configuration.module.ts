import { Global, Module } from '@nestjs/common';
import { parseEnvironment } from './environment.js';

export const SERVER_CONFIG = Symbol('SERVER_CONFIG');

@Global()
@Module({
  providers: [{ provide: SERVER_CONFIG, useFactory: () => parseEnvironment(process.env) }],
  exports: [SERVER_CONFIG],
})
export class ConfigurationModule {}
