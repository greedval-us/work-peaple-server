import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { PostgresService } from '../../infrastructure/postgres.service.js';
import type { PermissionDto, QueryExecutor, RoleDto } from '../auth/auth.types.js';
import type { UserCreation, UserPatch } from './access-rules.js';

interface RoleRow extends QueryResultRow {
  id: string; code: string; name: string; description: string; is_system: boolean;
  permission_codes: string[]; created_at: Date; updated_at: Date;
}

const rolesQuery = `
  SELECT r.id, r.code, r.name, r.description, r.is_system, r.created_at, r.updated_at,
    COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permission_codes
  FROM roles r
  LEFT JOIN role_permissions rp ON rp.role_id = r.id
  LEFT JOIN permissions p ON p.id = rp.permission_id`;

function roleDto(row: RoleRow): RoleDto {
  return {
    id: row.id, code: row.code, name: row.name, description: row.description, isSystem: row.is_system,
    permissionCodes: row.permission_codes, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

@Injectable()
export class AccessRepository {
  constructor(private readonly postgres: PostgresService) {}

  transaction<T>(operation: (database: QueryExecutor) => Promise<T>): Promise<T> {
    return this.postgres.transaction(operation);
  }

  async lockAccessChanges(database: QueryExecutor): Promise<void> {
    await database.query('SELECT pg_advisory_xact_lock(1464873042)');
  }

  async hasActiveAdministrator(database: QueryExecutor): Promise<boolean> {
    const result = await database.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id WHERE u.is_active = true AND r.code = 'admin'
      ) AS exists`);
    return result.rows[0]?.exists === true;
  }

  async listUserIds(input: { limit: number; offset: number; search: string }): Promise<{ ids: string[]; total: number }> {
    const pattern = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
    const filter = "concat_ws(' ', login, first_name, last_name, middle_name, email, phone) ILIKE $1";
    const count = await this.postgres.query<{ total: number }>(`SELECT count(*)::integer AS total FROM users WHERE ${filter}`, [pattern]);
    const result = await this.postgres.query<{ id: string }>(
      `SELECT id FROM users WHERE ${filter} ORDER BY created_at, id LIMIT $2 OFFSET $3`, [pattern, input.limit, input.offset],
    );
    return { ids: result.rows.map((row) => row.id), total: count.rows[0]?.total ?? 0 };
  }

  async createUser(input: UserCreation, passwordHash: string, actorId: string, database: QueryExecutor): Promise<string> {
    const result = await database.query<{ id: string }>(`
      INSERT INTO users (login, password_hash, first_name, last_name, middle_name, email, phone, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [input.login, passwordHash, input.firstName, input.lastName, input.middleName, input.email, input.phone, actorId]);
    return result.rows[0]!.id;
  }

  async updateUser(id: string, patch: UserPatch, passwordHash: string | undefined, database: QueryExecutor): Promise<void> {
    const assignments: string[] = [];
    const values: unknown[] = [id];
    const columns = {
      login: 'login', firstName: 'first_name', lastName: 'last_name', middleName: 'middle_name',
      email: 'email', phone: 'phone', isActive: 'is_active',
    } as const;
    for (const key of Object.keys(columns) as (keyof typeof columns)[]) {
      if (patch[key] !== undefined) {
        values.push(patch[key]);
        assignments.push(`${columns[key]} = $${values.length}`);
      }
    }
    if (passwordHash !== undefined) {
      values.push(passwordHash);
      assignments.push(`password_hash = $${values.length}`, 'password_changed_at = now()');
    }
    if (assignments.length > 0) {
      await database.query(`UPDATE users SET ${assignments.join(', ')}, updated_at = now() WHERE id = $1`, values);
    }
    if (patch.isActive === false || passwordHash !== undefined) {
      await database.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    }
  }

  async setUserRoles(userId: string, roleIds: string[], actorId: string, database: QueryExecutor): Promise<void> {
    await database.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await database.query(`
      INSERT INTO user_roles (user_id, role_id, assigned_by)
      SELECT $1::uuid, role_id, $3::uuid FROM unnest($2::uuid[]) AS role_id`, [userId, roleIds, actorId]);
    await database.query('UPDATE users SET updated_at = now() WHERE id = $1', [userId]);
  }

  async listRoles(database: QueryExecutor = this.postgres): Promise<RoleDto[]> {
    const result = await database.query<RoleRow>(`${rolesQuery} GROUP BY r.id ORDER BY r.is_system DESC, r.code`);
    return result.rows.map(roleDto);
  }

  async getRoles(ids: string[], database: QueryExecutor): Promise<RoleDto[]> {
    if (ids.length === 0) return [];
    const result = await database.query<RoleRow>(`${rolesQuery} WHERE r.id = ANY($1::uuid[]) GROUP BY r.id ORDER BY r.code`, [ids]);
    return result.rows.map(roleDto);
  }

  async createRole(input: { code: string; name: string; description: string }, actorId: string, database: QueryExecutor): Promise<string> {
    const result = await database.query<{ id: string }>(`
      INSERT INTO roles (code, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.code, input.name, input.description, actorId]);
    return result.rows[0]!.id;
  }

  async updateRole(id: string, labels: { name: string; description: string }, database: QueryExecutor): Promise<void> {
    await database.query('UPDATE roles SET name = $2, description = $3, updated_at = now() WHERE id = $1', [id, labels.name, labels.description]);
  }

  async isRoleAssigned(id: string, database: QueryExecutor): Promise<boolean> {
    const result = await database.query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM user_roles WHERE role_id = $1) AS exists', [id]);
    return result.rows[0]?.exists === true;
  }

  async deleteRole(id: string, database: QueryExecutor): Promise<void> {
    await database.query('DELETE FROM roles WHERE id = $1', [id]);
  }

  async listPermissions(database: QueryExecutor = this.postgres): Promise<PermissionDto[]> {
    const result = await database.query<PermissionDto & QueryResultRow>('SELECT id, code, resource, name, description FROM permissions ORDER BY resource, code');
    return result.rows;
  }

  async setRolePermissions(roleId: string, permissionCodes: string[], database: QueryExecutor): Promise<void> {
    await database.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    await database.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT $1::uuid, id FROM permissions WHERE code = ANY($2::text[])`, [roleId, permissionCodes]);
    await database.query('UPDATE roles SET updated_at = now() WHERE id = $1', [roleId]);
  }
}
