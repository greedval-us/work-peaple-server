import { status } from '@grpc/grpc-js';
import type { Metadata } from '@grpc/grpc-js';
import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RpcException } from '@nestjs/microservices';
import { PUBLIC_RPC, REQUIRED_PERMISSIONS, setCurrentActor } from './auth.decorators.js';
import { unauthenticated } from './auth.errors.js';
import { readBearerToken } from './auth.security.js';
import { AuthService } from './auth.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_RPC, targets)) return true;
    const metadata = context.getArgByIndex<Metadata | undefined>(1);
    const token = readBearerToken(metadata?.get?.('authorization') ?? []);
    if (!token) throw unauthenticated();
    const actor = await this.auth.authenticate(token);
    const permissions = this.reflector.getAllAndMerge<string[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    if (permissions.some((permission) => !actor.permissions.includes(permission))) {
      throw new RpcException({ code: status.PERMISSION_DENIED, message: 'Permission denied' });
    }
    setCurrentActor(context.getArgByIndex(2), actor);
    return true;
  }
}
