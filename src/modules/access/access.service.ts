import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { AuthRepository } from '../auth/auth.repository.js';
import type { AuthenticatedActor, PermissionDto, QueryExecutor, RoleDto, UserDto } from '../auth/auth.types.js';
import { hashPassword } from '../auth/password.js';
import { AccessRepository } from './access.repository.js';
import {
  AccessRuleError, assertCanGrantRoles, assertCanManageRole, assertCanManageUser, assertPermission,
  invalidArgument, normalizeId, normalizeListUsers, normalizePermissionCodes, normalizeRoleCreation,
  normalizeRoleIds, normalizeRoleLabels, normalizeUserCreation, normalizeUserPatch,
} from './access-rules.js';

@Injectable()
export class AccessService {
  constructor(private readonly repository: AccessRepository, private readonly auth: AuthRepository) {}

  listUsers(input: Record<string, unknown>): Promise<{ users: UserDto[]; total: number }> {
    return this.operation(async () => {
      const result = await this.repository.listUserIds(normalizeListUsers(input));
      const users = await Promise.all(result.ids.map((id) => this.requireUser(id)));
      return { users, total: result.total };
    });
  }

  createUser(input: Record<string, unknown>, actor: AuthenticatedActor): Promise<UserDto> {
    return this.operation(async () => {
      const normalized = normalizeUserCreation(input);
      const passwordHash = await hashPassword(normalized.password);
      return this.mutate(actor, 'users.create', async (currentActor, database) => {
        if (normalized.roleIds.length > 0) assertPermission(currentActor, 'users.roles.assign');
        const roles = await this.requireRoles(normalized.roleIds, database);
        assertCanGrantRoles(currentActor, roles);
        const id = await this.repository.createUser(normalized, passwordHash, currentActor.userId, database);
        await this.repository.setUserRoles(id, normalized.roleIds, currentActor.userId, database);
        return this.requireUser(id, database);
      });
    });
  }

  updateUser(input: Record<string, unknown>, actor: AuthenticatedActor): Promise<UserDto> {
    return this.operation(async () => {
      const id = normalizeId(input.id);
      const patch = normalizeUserPatch(input);
      const passwordHash = patch.password === undefined ? undefined : await hashPassword(patch.password);
      return this.mutate(actor, 'users.update', async (currentActor, database) => {
        const target = await this.requireUser(id, database);
        assertCanManageUser(currentActor, target);
        await this.repository.updateUser(id, patch, passwordHash, database);
        return this.requireUser(id, database);
      });
    });
  }

  setUserRoles(input: Record<string, unknown>, actor: AuthenticatedActor): Promise<UserDto> {
    return this.operation(async () => {
      const id = normalizeId(input.userId, 'userId');
      const roleIds = normalizeRoleIds(input.roleIds);
      return this.mutate(actor, 'users.roles.assign', async (currentActor, database) => {
        const target = await this.requireUser(id, database);
        assertCanManageUser(currentActor, target);
        const roles = await this.requireRoles(roleIds, database);
        assertCanGrantRoles(currentActor, roles);
        await this.repository.setUserRoles(id, roleIds, currentActor.userId, database);
        return this.requireUser(id, database);
      });
    });
  }

  listRoles(): Promise<{ roles: RoleDto[] }> {
    return this.operation(async () => ({ roles: await this.repository.listRoles() }));
  }

  createRole(input: Record<string, unknown>, actor: AuthenticatedActor): Promise<RoleDto> {
    return this.operation(async () => {
      const normalized = normalizeRoleCreation(input);
      return this.mutate(actor, 'roles.create', async (currentActor, database) => {
        if (normalized.permissionCodes.length > 0) assertPermission(currentActor, 'roles.permissions.assign');
        await this.requirePermissions(normalized.permissionCodes, database);
        // A new role has no existing rights; the same delegation rule checks the requested set.
        assertCanGrantRoles(currentActor, [{
          id: '', code: normalized.code, name: normalized.name, description: normalized.description,
          isSystem: false, permissionCodes: normalized.permissionCodes, createdAt: '', updatedAt: '',
        }]);
        const id = await this.repository.createRole(normalized, currentActor.userId, database);
        await this.repository.setRolePermissions(id, normalized.permissionCodes, database);
        return this.requireRole(id, database);
      });
    });
  }

  updateRole(input: Record<string, unknown>, actor: AuthenticatedActor): Promise<RoleDto> {
    return this.operation(async () => {
      const id = normalizeId(input.id);
      const labels = normalizeRoleLabels(input);
      return this.mutate(actor, 'roles.update', async (currentActor, database) => {
        const role = await this.requireRole(id, database);
        assertCanManageRole(currentActor, role);
        await this.repository.updateRole(id, labels, database);
        return this.requireRole(id, database);
      });
    });
  }

  deleteRole(input: Record<string, unknown>, actor: AuthenticatedActor): Promise<Record<string, never>> {
    return this.operation(async () => {
      const id = normalizeId(input.id);
      return this.mutate(actor, 'roles.delete', async (currentActor, database) => {
        const role = await this.requireRole(id, database);
        assertCanManageRole(currentActor, role);
        if (await this.repository.isRoleAssigned(id, database)) {
          throw new AccessRuleError(9, 'An assigned role cannot be deleted; remove its user assignments first');
        }
        await this.repository.deleteRole(id, database);
        return {};
      });
    });
  }

  setRolePermissions(input: Record<string, unknown>, actor: AuthenticatedActor): Promise<RoleDto> {
    return this.operation(async () => {
      const id = normalizeId(input.roleId, 'roleId');
      const permissionCodes = normalizePermissionCodes(input.permissionCodes);
      return this.mutate(actor, 'roles.permissions.assign', async (currentActor, database) => {
        const role = await this.requireRole(id, database);
        assertCanManageRole(currentActor, role, permissionCodes);
        await this.requirePermissions(permissionCodes, database);
        await this.repository.setRolePermissions(id, permissionCodes, database);
        return this.requireRole(id, database);
      });
    });
  }

  listPermissions(): Promise<{ permissions: PermissionDto[] }> {
    return this.operation(async () => ({ permissions: await this.repository.listPermissions() }));
  }

  private async mutate<T>(
    actor: AuthenticatedActor,
    permission: string,
    operation: (currentActor: AuthenticatedActor, database: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    return this.repository.transaction(async (database) => {
      // All management writes share this lock so their authorization checks and the
      // last-administrator invariant remain valid until the transaction commits.
      await this.repository.lockAccessChanges(database);
      const identity = await this.auth.getUser(actor.userId, database);
      if (!identity?.isActive) throw new AccessRuleError(16, 'Account is no longer active');
      const currentActor: AuthenticatedActor = {
        sessionId: actor.sessionId, userId: identity.id, login: identity.login,
        isAdmin: identity.roles.some((role) => role.code === 'admin'), permissions: identity.permissions,
      };
      assertPermission(currentActor, permission);
      const result = await operation(currentActor, database);
      if (!await this.repository.hasActiveAdministrator(database)) {
        throw new AccessRuleError(9, 'At least one active administrator is required');
      }
      return result;
    });
  }

  private async requireUser(id: string, database?: QueryExecutor): Promise<UserDto> {
    const user = await this.auth.getUser(id, database);
    if (!user) throw new AccessRuleError(5, 'User not found');
    return user;
  }

  private async requireRoles(ids: string[], database: QueryExecutor): Promise<RoleDto[]> {
    const roles = await this.repository.getRoles(ids, database);
    if (roles.length !== ids.length) invalidArgument('One or more role IDs do not exist');
    return roles;
  }

  private async requireRole(id: string, database: QueryExecutor): Promise<RoleDto> {
    const role = (await this.repository.getRoles([id], database))[0];
    if (!role) throw new AccessRuleError(5, 'Role not found');
    return role;
  }

  private async requirePermissions(codes: string[], database: QueryExecutor): Promise<void> {
    const knownCodes = new Set((await this.repository.listPermissions(database)).map((permission) => permission.code));
    if (codes.some((code) => !knownCodes.has(code))) invalidArgument('One or more permission codes do not exist');
  }

  private async operation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RpcException) throw error;
      if (error instanceof AccessRuleError) throw new RpcException({ code: error.code, message: error.message });
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === '23505') throw new RpcException({ code: 6, message: 'Login, email or role code already exists' });
      if (code === '23503') throw new RpcException({ code: 9, message: 'A referenced record is in use or no longer exists' });
      if (code === '23514' || code === '22001' || code === '22P02') {
        throw new RpcException({ code: 3, message: 'Invalid account or role data' });
      }
      throw new RpcException({ code: 13, message: 'Access operation failed' });
    }
  }
}
