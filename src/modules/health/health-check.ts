export type DependencyState = 'up' | 'down';
export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'work-people-server';
  version: '0.1.0';
  checkedAt: string;
  dependencies: { postgres: DependencyState; redis: DependencyState };
}

type Probe = () => Promise<void>;
type DependencyProbes = { postgres: Probe; redis: Probe };

async function probeWithTimeout(probe: Probe, timeoutMs: number): Promise<DependencyState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(probe),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Health probe timed out')), timeoutMs);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

export async function checkDependencies(probes: DependencyProbes, timeoutMs: number): Promise<HealthResponse> {
  const [postgres, redis] = await Promise.all([
    probeWithTimeout(probes.postgres, timeoutMs),
    probeWithTimeout(probes.redis, timeoutMs),
  ]);
  return {
    status: postgres === 'up' && redis === 'up' ? 'ok' : 'degraded',
    service: 'work-people-server',
    version: '0.1.0',
    checkedAt: new Date().toISOString(),
    dependencies: { postgres, redis },
  };
}
