import 'reflect-metadata';
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ServerCredentials } from '@grpc/grpc-js';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';
import { parseEnvironment } from './config/environment.js';

async function bootstrap(): Promise<void> {
  const config = parseEnvironment(process.env);
  let credentials = ServerCredentials.createInsecure();
  if (config.grpcTlsEnabled) {
    const [cert_chain, private_key] = await Promise.all([
      readFile(resolve(config.grpcTlsCertPath!)),
      readFile(resolve(config.grpcTlsKeyPath!)),
    ]);
    credentials = ServerCredentials.createSsl(null, [{ cert_chain, private_key }]);
  }
  const host = config.grpcHost.includes(':') && !config.grpcHost.startsWith('[')
    ? `[${config.grpcHost}]` : config.grpcHost;
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    abortOnError: false,
    transport: Transport.GRPC,
    options: {
      package: 'workpeople.v1',
      protoPath: resolve('proto/workpeople/v1/health.proto'),
      url: `${host}:${config.grpcPort}`,
      credentials,
      loader: { keepCase: false, defaults: true, longs: String, enums: String, oneofs: true },
    },
  });
  try {
    // Nest completes its hooks before exiting; a direct SIGTERM rethrow exits with code 1 on Windows.
    app.enableShutdownHooks(['SIGINT', 'SIGTERM'], { useProcessExit: true });
    await app.listen();
    new Logger('Bootstrap').log(`gRPC listening on ${host}:${config.grpcPort} (TLS: ${config.grpcTlsEnabled})`);
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(error instanceof Error ? error.message : 'Server startup failed');
  process.exitCode = 1;
});
