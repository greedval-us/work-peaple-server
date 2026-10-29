import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import { load } from '@grpc/proto-loader';

function positiveInteger(name, fallback, maximum) {
  const value = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return Number(value);
}

async function check() {
  const port = positiveInteger('GRPC_PORT', 50051, 65535);
  const timeoutMs = positiveInteger('HEALTHCHECK_TIMEOUT_MS', 3000, 30000);
  const tls = process.env.GRPC_TLS_ENABLED ?? 'false';
  if (tls !== 'true' && tls !== 'false') throw new Error('GRPC_TLS_ENABLED must be true or false');
  const rootCa = tls === 'true' && process.env.GRPC_TLS_CA_PATH
    ? await readFile(resolve(process.env.GRPC_TLS_CA_PATH)) : undefined;
  const definition = await load(resolve('proto/workpeople/v1/health.proto'), {
    keepCase: false, defaults: true, longs: String, enums: String, oneofs: true,
  });
  const { workpeople } = loadPackageDefinition(definition);
  const options = {};
  const serverName = process.env.GRPC_TLS_SERVER_NAME?.trim();
  if (tls === 'true' && serverName) {
    options['grpc.ssl_target_name_override'] = serverName;
    options['grpc.default_authority'] = serverName;
  }
  const client = new workpeople.v1.HealthService(
    process.env.GRPC_HEALTHCHECK_TARGET || `127.0.0.1:${port}`,
    tls === 'true' ? credentials.createSsl(rootCa) : credentials.createInsecure(),
    options,
  );
  try {
    const result = await new Promise((resolveResult, reject) => {
      client.check({}, { deadline: Date.now() + timeoutMs }, (error, response) => {
        if (error) reject(error);
        else resolveResult(response);
      });
    });
    console.log(JSON.stringify(result));
    if (result.status !== 'ok') process.exitCode = 1;
  } finally {
    client.close();
  }
}

void check().catch((error) => {
  console.error(`Healthcheck failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
