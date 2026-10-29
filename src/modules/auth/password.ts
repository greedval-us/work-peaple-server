import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const COST = 131072;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 256 * 1024 * 1024;

export class PasswordWorkBusyError extends Error {
  constructor() {
    super('Password processing capacity reached');
    this.name = 'PasswordWorkBusyError';
  }
}

// Keep memory-hard work bounded even when callers have different login names.
export class PasswordWorkQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly concurrency: number;
  private readonly maximumWaiting: number;

  constructor(concurrency: number, maximumWaiting: number) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(maximumWaiting) || maximumWaiting < 0) {
      throw new Error('Invalid password work limits');
    }
    this.concurrency = concurrency;
    this.maximumWaiting = maximumWaiting;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maximumWaiting) throw new PasswordWorkBusyError();
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await operation();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

const passwordWork = new PasswordWorkQueue(2, 8);

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return passwordWork.run(() => new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  }));
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 1 || password.length > 256 || Buffer.byteLength(password, 'utf8') > 1024) {
    throw new Error('Password is outside accepted bounds');
  }
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$v1$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length < 1 || password.length > 256 || Buffer.byteLength(password, 'utf8') > 1024) return false;
  if (typeof encoded !== 'string') return false;
  const match = /^scrypt\$v1\$131072\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/.exec(encoded);
  if (!match?.[1] || !match[2]) return false;
  const salt = Buffer.from(match[1], 'base64url');
  const expected = Buffer.from(match[2], 'base64url');
  if (salt.length !== 16 || expected.length !== KEY_LENGTH || salt.toString('base64url') !== match[1] || expected.toString('base64url') !== match[2]) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}

// A valid, deliberately non-user hash keeps unknown and disabled logins on the same expensive path.
export const DUMMY_PASSWORD_HASH = `scrypt$v1$131072$8$1$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(KEY_LENGTH).toString('base64url')}`;
