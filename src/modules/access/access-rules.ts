import type { AuthenticatedActor, RoleDto, UserDto } from '../auth/auth.types.js';

export class AccessRuleError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'AccessRuleError';
    this.code = code;
  }
}

export const invalidArgument = (message: string): never => { throw new AccessRuleError(3, message); };
export const forbidden = (message: string): never => { throw new AccessRuleError(7, message); };

function text(value: unknown, field: string, max: number, required = false): string {
  if (typeof value !== 'string') return invalidArgument(`${field} must be a string`);
  const normalized = value.trim();
  if (normalized.length > max || (required && normalized.length === 0)) {
    return invalidArgument(`${field} must contain ${required ? '1' : '0'} to ${max} characters`);
  }
  return normalized;
}

export function normalizeLogin(value: unknown): string {
  const login = text(value, 'login', 64, true).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(login)) {
    return invalidArgument('login must contain 3 to 64 ASCII letters, digits, dots, underscores or hyphens and start with a letter or digit');
  }
  return login;
}

export function normalizeId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return invalidArgument(`${field} must be a UUID`);
  }
  return value.toLowerCase();
}

function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256 || Buffer.byteLength(value, 'utf8') > 1024) {
    return invalidArgument('password must contain 8 to 256 characters and at most 1024 UTF-8 bytes');
  }
  return value;
}

function email(value: unknown): string | null {
  const normalized = text(value, 'email', 254).toLowerCase();
  if (normalized === '') return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return invalidArgument('email must be a valid email address');
  return normalized;
}

function phone(value: unknown): string | null {
  return text(value, 'phone', 40) || null;
}

function strings(value: unknown, field: string, maxEntries: number, convert: (entry: unknown) => string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxEntries) return invalidArgument(`${field} must be an array with at most ${maxEntries} entries`);
  return [...new Set(value.map(convert))];
}

export function normalizeRoleIds(value: unknown): string[] {
  return strings(value, 'roleIds', 100, (entry) => normalizeId(entry, 'roleId'));
}

export function normalizePermissionCodes(value: unknown): string[] {
  return strings(value, 'permissionCodes', 1000, (entry) => {
    const code = text(entry, 'permissionCode', 100, true);
    if (!/^[a-z][a-z0-9._-]*$/.test(code)) return invalidArgument('permissionCode has an invalid format');
    return code;
  });
}

export interface UserPatch {
  login?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  email?: string | null;
  phone?: string | null;
  isActive?: boolean;
  password?: string;
}

export function normalizeUserPatch(input: Record<string, unknown>): UserPatch {
  const result: UserPatch = {};
  const present = (field: string) => Object.hasOwn(input, field) && input[field] !== undefined;
  if (present('login')) result.login = normalizeLogin(input.login);
  for (const field of ['firstName', 'lastName', 'middleName'] as const) {
    if (present(field)) result[field] = text(input[field], field, 100);
  }
  if (present('email')) result.email = email(input.email);
  if (present('phone')) result.phone = phone(input.phone);
  if (present('password')) result.password = password(input.password);
  if (present('isActive')) {
    if (typeof input.isActive !== 'boolean') return invalidArgument('isActive must be a boolean');
    result.isActive = input.isActive;
  }
  return result;
}

export interface UserCreation {
  login: string;
  password: string;
  firstName: string;
  lastName: string;
  middleName: string;
  email: string | null;
  phone: string | null;
  roleIds: string[];
}

export function normalizeUserCreation(input: Record<string, unknown>): UserCreation {
  return {
    login: normalizeLogin(input.login), password: password(input.password),
    firstName: text(input.firstName ?? '', 'firstName', 100),
    lastName: text(input.lastName ?? '', 'lastName', 100),
    middleName: text(input.middleName ?? '', 'middleName', 100),
    email: email(input.email ?? ''), phone: phone(input.phone ?? ''),
    roleIds: normalizeRoleIds(input.roleIds),
  };
}

export function normalizeRoleCreation(input: Record<string, unknown>): {
  code: string; name: string; description: string; permissionCodes: string[];
} {
  const code = text(input.code, 'code', 64, true);
  if (!/^[a-z][a-z0-9._-]{1,63}$/.test(code)) return invalidArgument('code must contain 2 to 64 lowercase ASCII characters and start with a letter');
  return { code, ...normalizeRoleLabels(input), permissionCodes: normalizePermissionCodes(input.permissionCodes) };
}

export function normalizeRoleLabels(input: Record<string, unknown>): { name: string; description: string } {
  return { name: text(input.name, 'name', 100, true), description: text(input.description ?? '', 'description', 1000) };
}

export function normalizeListUsers(input: Record<string, unknown>): { limit: number; offset: number; search: string } {
  const limit = input.limit === undefined || input.limit === 0 ? 50 : input.limit;
  const offset = input.offset ?? 0;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return invalidArgument('limit must be an integer from 1 to 100');
  }
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 2147483647) {
    return invalidArgument('offset must be a nonnegative 32-bit integer');
  }
  return { limit, offset, search: text(input.search ?? '', 'search', 100) };
}

export function assertPermission(actor: AuthenticatedActor, code: string): void {
  if (!actor.isAdmin && !actor.permissions.includes(code)) forbidden(`Permission required: ${code}`);
}

function assertDelegable(actor: AuthenticatedActor, permissions: string[]): void {
  if (!actor.isAdmin && permissions.some((code) => !actor.permissions.includes(code))) {
    forbidden('Cannot manage rights beyond your own permissions');
  }
}

export function assertCanManageUser(actor: AuthenticatedActor, target: UserDto): void {
  if (actor.isAdmin) return;
  if (target.roles.some((role) => role.code === 'admin' || role.isSystem)) forbidden('Cannot manage an administrator account');
  assertDelegable(actor, target.permissions);
}

export function assertCanGrantRoles(actor: AuthenticatedActor, roles: RoleDto[]): void {
  if (actor.isAdmin) return;
  for (const role of roles) {
    if (role.code === 'admin' || role.isSystem) forbidden('Cannot assign a system role');
    assertDelegable(actor, role.permissionCodes);
  }
}

export function assertCanManageRole(actor: AuthenticatedActor, role: RoleDto, nextPermissions?: string[]): void {
  if (role.isSystem || role.code === 'admin') throw new AccessRuleError(9, 'System roles cannot be changed or deleted');
  assertDelegable(actor, role.permissionCodes);
  if (nextPermissions) assertDelegable(actor, nextPermissions);
}
