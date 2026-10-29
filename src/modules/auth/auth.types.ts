import type { QueryResult, QueryResultRow } from 'pg';

export interface QueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

export interface PermissionDto {
  id: string;
  code: string;
  resource: string;
  name: string;
  description: string;
}

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissionCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserDto {
  id: string;
  login: string;
  firstName: string;
  lastName: string;
  middleName: string;
  email: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  roles: RoleDto[];
  permissions: string[];
}

export interface AuthenticatedActor {
  sessionId: string;
  userId: string;
  login: string;
  isAdmin: boolean;
  permissions: string[];
}
