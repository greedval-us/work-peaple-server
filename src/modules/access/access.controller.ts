import { Controller } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';
import { CurrentActor, RequirePermissions } from '../auth/auth.decorators.js';
import type { AuthenticatedActor } from '../auth/auth.types.js';
import { AccessService } from './access.service.js';

@Controller()
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @GrpcMethod('AccessService', 'ListUsers')
  @RequirePermissions('users.read')
  listUsers(@Payload() input: Record<string, unknown>) {
    return this.access.listUsers(input);
  }

  @GrpcMethod('AccessService', 'CreateUser')
  @RequirePermissions('users.create')
  createUser(@Payload() input: Record<string, unknown>, @CurrentActor() actor: AuthenticatedActor) {
    return this.access.createUser(input, actor);
  }

  @GrpcMethod('AccessService', 'UpdateUser')
  @RequirePermissions('users.update')
  updateUser(@Payload() input: Record<string, unknown>, @CurrentActor() actor: AuthenticatedActor) {
    return this.access.updateUser(input, actor);
  }

  @GrpcMethod('AccessService', 'SetUserRoles')
  @RequirePermissions('users.roles.assign')
  setUserRoles(@Payload() input: Record<string, unknown>, @CurrentActor() actor: AuthenticatedActor) {
    return this.access.setUserRoles(input, actor);
  }

  @GrpcMethod('AccessService', 'ListRoles')
  @RequirePermissions('roles.read')
  listRoles() {
    return this.access.listRoles();
  }

  @GrpcMethod('AccessService', 'CreateRole')
  @RequirePermissions('roles.create')
  createRole(@Payload() input: Record<string, unknown>, @CurrentActor() actor: AuthenticatedActor) {
    return this.access.createRole(input, actor);
  }

  @GrpcMethod('AccessService', 'UpdateRole')
  @RequirePermissions('roles.update')
  updateRole(@Payload() input: Record<string, unknown>, @CurrentActor() actor: AuthenticatedActor) {
    return this.access.updateRole(input, actor);
  }

  @GrpcMethod('AccessService', 'DeleteRole')
  @RequirePermissions('roles.delete')
  deleteRole(@Payload() input: Record<string, unknown>, @CurrentActor() actor: AuthenticatedActor) {
    return this.access.deleteRole(input, actor);
  }

  @GrpcMethod('AccessService', 'SetRolePermissions')
  @RequirePermissions('roles.permissions.assign')
  setRolePermissions(@Payload() input: Record<string, unknown>, @CurrentActor() actor: AuthenticatedActor) {
    return this.access.setRolePermissions(input, actor);
  }

  @GrpcMethod('AccessService', 'ListPermissions')
  @RequirePermissions('permissions.read')
  listPermissions() {
    return this.access.listPermissions();
  }
}
