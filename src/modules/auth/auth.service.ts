import { status } from '@grpc/grpc-js';
import { Inject, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { SERVER_CONFIG } from '../../config/configuration.module.js';
import type { ServerConfig } from '../../config/environment.js';
import { RedisService } from '../../infrastructure/redis.service.js';
import { AuthRepository } from './auth.repository.js';
import type { AuthenticatedActor, UserDto } from './auth.types.js';
import { authOperation, unauthenticated } from './auth.errors.js';
import { createSessionToken, hashSessionToken, normalizeLogin, validPassword } from './auth.security.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password.js';

interface LoginRequest { login?: unknown; password?: unknown }
interface ChangePasswordRequest { currentPassword?: unknown; newPassword?: unknown }

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly redis: RedisService,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  login(request: LoginRequest): Promise<{ sessionToken: string; expiresAt: string; user: UserDto }> {
    return authOperation(async () => {
      const login = normalizeLogin(request.login);
      if (!login || !validPassword(request.password)) {
        throw new RpcException({ code: status.INVALID_ARGUMENT, message: 'Invalid login request' });
      }
      await this.consumePasswordLimits(`login:${login}`);
      const credentials = await this.repository.credentialsByLogin(login);
      const verified = await verifyPassword(request.password, credentials?.is_active ? credentials.password_hash : DUMMY_PASSWORD_HASH);
      if (!credentials?.is_active || !verified) throw unauthenticated();
      const sessionToken = createSessionToken();
      const session = await this.repository.createLoginSession(
        credentials.id, credentials.password_hash, hashSessionToken(sessionToken), this.config.sessionTtlSeconds,
      );
      if (!session) throw unauthenticated();
      return { sessionToken, ...session };
    });
  }

  authenticate(sessionToken: string): Promise<AuthenticatedActor> {
    return authOperation(async () => {
      const session = await this.repository.resolveSession(hashSessionToken(sessionToken));
      if (!session) throw unauthenticated();
      return {
        sessionId: session.sessionId, userId: session.user.id, login: session.user.login,
        isAdmin: session.user.roles.some((role) => role.code === 'admin'), permissions: session.user.permissions,
      };
    });
  }

  getCurrentUser(actor: AuthenticatedActor): Promise<UserDto> {
    return authOperation(async () => {
      const user = await this.repository.getUser(actor.userId);
      if (!user?.isActive) throw unauthenticated();
      return user;
    });
  }

  logout(actor: AuthenticatedActor): Promise<Record<string, never>> {
    return authOperation(async () => {
      await this.repository.revokeSession(actor.sessionId, actor.userId);
      return {};
    });
  }

  changePassword(request: ChangePasswordRequest, actor: AuthenticatedActor): Promise<Record<string, never>> {
    return authOperation(async () => {
      if (!validPassword(request.currentPassword) || !validPassword(request.newPassword, 8)) {
        throw new RpcException({ code: status.INVALID_ARGUMENT, message: 'New password must contain 8 to 256 characters' });
      }
      await this.consumePasswordLimits(`password-change:${actor.userId}`);
      const credentials = await this.repository.credentialsById(actor.userId);
      const verified = await verifyPassword(request.currentPassword, credentials?.is_active ? credentials.password_hash : DUMMY_PASSWORD_HASH);
      if (!credentials?.is_active || !verified) throw unauthenticated();
      const hash = await hashPassword(request.newPassword);
      if (!await this.repository.replacePassword(actor.userId, credentials.password_hash, hash)) throw unauthenticated();
      return {};
    });
  }

  private async consumePasswordLimits(subject: string): Promise<void> {
    const windowSeconds = this.config.authLoginWindowSeconds;
    const limit = this.config.authLoginMaxAttempts;
    const globalAllowed = await this.redis.consumeLimit('workpeople:auth:global', Math.max(limit * 20, 100), windowSeconds);
    if (!globalAllowed) throw new RpcException({ code: status.RESOURCE_EXHAUSTED, message: 'Too many authentication attempts; try again later' });
    const allowed = await this.redis.consumeLimit(`workpeople:auth:${hashSessionToken(subject)}`, limit, windowSeconds);
    if (!allowed) throw new RpcException({ code: status.RESOURCE_EXHAUSTED, message: 'Too many authentication attempts; try again later' });
  }
}
