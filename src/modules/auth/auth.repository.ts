import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { PostgresService } from '../../infrastructure/postgres.service.js';
import type { QueryExecutor, RoleDto, UserDto } from './auth.types.js';

interface UserRow extends QueryResultRow {
  id: string;
  login: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

interface RoleRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  description: string;
  is_system: boolean;
  permission_codes: string[];
  created_at: Date;
  updated_at: Date;
}

export interface UserCredentials extends QueryResultRow {
  id: string;
  login: string;
  password_hash: string;
  is_active: boolean;
}

function iso(value: Date | null): string {
  return value?.toISOString() ?? '';
}

@Injectable()
export class AuthRepository {
  constructor(private readonly postgres: PostgresService) {}

  async getUser(userId: string, database: QueryExecutor = this.postgres): Promise<UserDto | null> {
    const result = await database.query<UserRow>(
      `SELECT id, login, first_name, last_name, middle_name, email, phone, is_active,
              created_at, updated_at, last_login_at FROM users WHERE id = $1`, [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const roleResult = await database.query<RoleRow>(
      `SELECT r.id, r.code, r.name, r.description, r.is_system, r.created_at, r.updated_at,
              COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permission_codes
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = $1 GROUP BY r.id ORDER BY r.code`, [userId],
    );
    const roles: RoleDto[] = roleResult.rows.map((role) => ({
      id: role.id, code: role.code, name: role.name, description: role.description,
      isSystem: role.is_system, permissionCodes: role.permission_codes,
      createdAt: iso(role.created_at), updatedAt: iso(role.updated_at),
    }));
    let permissions: string[];
    if (roles.some((role) => role.code === 'admin')) {
      const catalog = await database.query<{ code: string }>('SELECT code FROM permissions ORDER BY code');
      permissions = catalog.rows.map((permission) => permission.code);
    } else {
      permissions = [...new Set(roles.flatMap((role) => role.permissionCodes))].sort();
    }
    return {
      id: row.id, login: row.login, firstName: row.first_name, lastName: row.last_name,
      middleName: row.middle_name, email: row.email ?? '', phone: row.phone ?? '', isActive: row.is_active,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), lastLoginAt: iso(row.last_login_at),
      roles, permissions,
    };
  }

  async credentialsByLogin(login: string): Promise<UserCredentials | null> {
    const result = await this.postgres.query<UserCredentials>(
      'SELECT id, login, password_hash, is_active FROM users WHERE login = $1', [login],
    );
    return result.rows[0] ?? null;
  }

  async credentialsById(userId: string): Promise<UserCredentials | null> {
    const result = await this.postgres.query<UserCredentials>(
      'SELECT id, login, password_hash, is_active FROM users WHERE id = $1', [userId],
    );
    return result.rows[0] ?? null;
  }

  async createLoginSession(userId: string, verifiedHash: string, tokenHash: string, ttlSeconds: number): Promise<{ user: UserDto; expiresAt: string } | null> {
    return this.postgres.transaction(async (database) => {
      // Serialize session creation with password resets and user deactivation.
      const locked = await database.query<UserCredentials>(
        'SELECT id, login, password_hash, is_active FROM users WHERE id = $1 FOR UPDATE', [userId],
      );
      const user = locked.rows[0];
      if (!user?.is_active || user.password_hash !== verifiedHash) return null;
      const session = await database.query<{ expires_at: Date }>(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + $3 * interval '1 second') RETURNING expires_at`,
        [userId, tokenHash, ttlSeconds],
      );
      await database.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
      const dto = await this.getUser(userId, database);
      const expiresAt = session.rows[0]?.expires_at;
      if (!dto || !expiresAt) throw new Error('Session creation failed');
      return { user: dto, expiresAt: expiresAt.toISOString() };
    });
  }

  async resolveSession(tokenHash: string): Promise<{ sessionId: string; user: UserDto } | null> {
    const result = await this.postgres.query<{ id: string; user_id: string }>(
      `SELECT s.id, s.user_id FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active = true`,
      [tokenHash],
    );
    const session = result.rows[0];
    if (!session) return null;
    const user = await this.getUser(session.user_id);
    return user?.isActive ? { sessionId: session.id, user } : null;
  }

  async revokeSession(sessionId: string, userId: string): Promise<void> {
    await this.postgres.query(
      'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND user_id = $2',
      [sessionId, userId],
    );
  }

  async replacePassword(userId: string, verifiedHash: string, newHash: string): Promise<boolean> {
    return this.postgres.transaction(async (database) => {
      const result = await database.query<UserCredentials>(
        'SELECT id, login, password_hash, is_active FROM users WHERE id = $1 FOR UPDATE', [userId],
      );
      const user = result.rows[0];
      if (!user?.is_active || user.password_hash !== verifiedHash) return false;
      await database.query(
        'UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1',
        [userId, newHash],
      );
      await database.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      return true;
    });
  }
}
