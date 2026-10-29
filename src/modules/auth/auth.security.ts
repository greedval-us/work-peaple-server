import { createHash, randomBytes } from 'node:crypto';

export function normalizeLogin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 128) return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized) ? normalized : null;
}

export function validPassword(value: unknown, minimumLength = 1): value is string {
  return typeof value === 'string' && value.length >= minimumLength && value.length <= 256 && Buffer.byteLength(value, 'utf8') <= 1024;
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readBearerToken(values: readonly unknown[]): string | null {
  if (values.length !== 1 || typeof values[0] !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(values[0]);
  return match?.[1] ?? null;
}
