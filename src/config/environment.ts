export interface ServerConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly grpcHost: string;
  readonly grpcPort: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly grpcTlsEnabled: boolean;
  readonly grpcTlsCertPath?: string;
  readonly grpcTlsKeyPath?: string;
  readonly healthcheckTimeoutMs: number;
}

type Environment = Record<string, string | undefined>;

function integer(environment: Environment, name: string, fallback: number, max: number): number {
  const value = environment[name] ?? String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return Number(value);
}

function connectionUrl(environment: Environment, name: string, protocols: readonly string[]): string {
  const value = environment[name]?.trim();
  try {
    if (!value) throw new Error('missing');
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol) || !parsed.hostname) throw new Error('invalid');
    return value;
  } catch {
    // Never include a connection string in diagnostics: it may contain credentials.
    throw new Error(`${name} must be a valid ${protocols.join(' or ')} connection URL`);
  }
}

export function parseEnvironment(environment: Environment): ServerConfig {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test or production');
  }
  const grpcHost = (environment.GRPC_HOST ?? '0.0.0.0').trim();
  if (!grpcHost || /[\s/]/.test(grpcHost)) {
    throw new Error('GRPC_HOST must be a hostname or IP address');
  }
  const tls = environment.GRPC_TLS_ENABLED ?? 'false';
  if (tls !== 'true' && tls !== 'false') {
    throw new Error('GRPC_TLS_ENABLED must be true or false');
  }
  const grpcTlsCertPath = environment.GRPC_TLS_CERT_PATH?.trim() || undefined;
  const grpcTlsKeyPath = environment.GRPC_TLS_KEY_PATH?.trim() || undefined;
  if (tls === 'true' && !grpcTlsCertPath) throw new Error('GRPC_TLS_CERT_PATH is required when TLS is enabled');
  if (tls === 'true' && !grpcTlsKeyPath) throw new Error('GRPC_TLS_KEY_PATH is required when TLS is enabled');

  return Object.freeze({
    nodeEnv,
    grpcHost,
    grpcPort: integer(environment, 'GRPC_PORT', 50051, 65535),
    databaseUrl: connectionUrl(environment, 'DATABASE_URL', ['postgres:', 'postgresql:']),
    redisUrl: connectionUrl(environment, 'REDIS_URL', ['redis:', 'rediss:']),
    grpcTlsEnabled: tls === 'true',
    grpcTlsCertPath,
    grpcTlsKeyPath,
    healthcheckTimeoutMs: integer(environment, 'HEALTHCHECK_TIMEOUT_MS', 3000, 30000),
  });
}
