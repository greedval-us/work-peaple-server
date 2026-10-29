import { Controller } from '@nestjs/common';
import { GrpcMethod, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service.js';
import { CurrentActor, Public } from './auth.decorators.js';
import type { AuthenticatedActor } from './auth.types.js';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @GrpcMethod('AuthService', 'Login')
  login(request: { login?: unknown; password?: unknown }) {
    return this.auth.login(request);
  }

  @GrpcMethod('AuthService', 'GetCurrentUser')
  getCurrentUser(@CurrentActor() actor: AuthenticatedActor) {
    return this.auth.getCurrentUser(actor);
  }

  @GrpcMethod('AuthService', 'Logout')
  logout(@CurrentActor() actor: AuthenticatedActor) {
    return this.auth.logout(actor);
  }

  @GrpcMethod('AuthService', 'ChangePassword')
  changePassword(@Payload() request: { currentPassword?: unknown; newPassword?: unknown }, @CurrentActor() actor: AuthenticatedActor) {
    return this.auth.changePassword(request, actor);
  }
}
