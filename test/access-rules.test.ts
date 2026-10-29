import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AccessRuleError,
  assertCanManageUser,
  assertCanGrantRoles,
  assertCanManageRole,
  normalizeLogin,
  normalizeUserPatch,
  normalizeUserCreation,
  normalizeRoleCreation,
  normalizeListUsers,
} from '../src/modules/access/access-rules.ts';
import type { AuthenticatedActor, RoleDto, UserDto } from '../src/modules/auth/auth.types.ts';

const actor: AuthenticatedActor = {
  sessionId: 'session', userId: 'manager', login: 'manager', isAdmin: false,
  permissions: ['users.read', 'users.update', 'users.roles.assign'],
};
const role = (code: string, permissionCodes: string[], isSystem = false): RoleDto => ({
  id: '432f39c5-2244-434b-b33e-13a32dd6a832', code, name: code, description: '', isSystem,
  permissionCodes, createdAt: '', updatedAt: '',
});
const user = (roles: RoleDto[], permissions: string[]): UserDto => ({
  id: 'target', login: 'target', firstName: '', lastName: '', middleName: '', email: '', phone: '',
  isActive: true, createdAt: '', updatedAt: '', lastLoginAt: '', roles, permissions,
});
const rejected = (operation: () => unknown) => assert.throws(operation, AccessRuleError);

test('login normalization enforces the ASCII database identity format', () => {
  assert.equal(normalizeLogin('  Manager.ONE  '), 'manager.one');
  for (const input of ['ab', '_manager', 'админ', 'a b', 'a'.repeat(65)]) {
    rejected(() => normalizeLogin(input));
  }
});

test('user patches preserve absent values and explicit false or clearing a field', () => {
  assert.deepEqual(normalizeUserPatch({ id: '432f39c5-2244-434b-b33e-13a32dd6a832' }), {});
  assert.deepEqual(normalizeUserPatch({ isActive: false, email: '', phone: '', firstName: '' }), {
    isActive: false, email: null, phone: null, firstName: '',
  });
  rejected(() => normalizeUserPatch({ isActive: 'false' }));
  rejected(() => normalizeUserPatch({ email: 'broken-email' }));
  rejected(() => normalizeUserPatch({ password: 'short' }));
});

test('normal user creation validates password and profile bounds', () => {
  const result = normalizeUserCreation({ login: ' New.User ', password: 'a secure password', email: ' Person@Example.test ' });
  assert.equal(result.login, 'new.user');
  assert.equal(result.email, 'person@example.test');
  assert.deepEqual(result.roleIds, []);
  rejected(() => normalizeUserCreation({ login: 'new.user', password: 'admin' }));
  rejected(() => normalizeUserCreation({ login: 'new.user', password: 'a'.repeat(257) }));
  rejected(() => normalizeUserCreation({ login: 'new.user', password: 'a'.repeat(1025) }));
  rejected(() => normalizeUserCreation({ login: 'new.user', password: 'valid password', firstName: 'a'.repeat(101) }));
});

test('list pagination is bounded and malformed role codes are rejected', () => {
  assert.deepEqual(normalizeListUsers({ limit: 0, offset: 0, search: ' Person ' }), { limit: 50, offset: 0, search: 'Person' });
  rejected(() => normalizeListUsers({ limit: 101 }));
  rejected(() => normalizeListUsers({ offset: -1 }));
  rejected(() => normalizeRoleCreation({ code: 'admin role', name: 'A role' }));
});

test('delegated user updates cannot take over admin or higher privilege accounts', () => {
  rejected(() => assertCanManageUser(actor, user([role('admin', [], true)], [])));
  rejected(() => assertCanManageUser(actor, user([], ['roles.permissions.assign'])));
  assert.doesNotThrow(() => assertCanManageUser(actor, user([], ['users.read'])));
});

test('delegated role assignment rejects admin roles and rights the actor does not hold', () => {
  rejected(() => assertCanGrantRoles(actor, [role('admin', [], true)]));
  rejected(() => assertCanGrantRoles(actor, [role('roles-manager', ['roles.permissions.assign'])]));
  assert.doesNotThrow(() => assertCanGrantRoles(actor, [role('reader', ['users.read'])]));
});

test('delegated role edits require both existing and requested rights to be in scope', () => {
  rejected(() => assertCanManageRole(actor, role('higher', ['roles.delete']), []));
  rejected(() => assertCanManageRole(actor, role('reader', ['users.read']), ['roles.delete']));
  rejected(() => assertCanManageRole({ ...actor, isAdmin: true }, role('admin', [], true), []));
  assert.doesNotThrow(() => assertCanManageRole(actor, role('reader', ['users.read']), []));
});
