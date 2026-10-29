import { createParamDecorator, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedActor } from './auth.types.js';
import { unauthenticated } from './auth.errors.js';

export const PUBLIC_RPC = 'workpeople:public-rpc';
export const REQUIRED_PERMISSIONS = 'workpeople:required-permissions';
const actors = new WeakMap<object, AuthenticatedActor>();

export const Public = () => SetMetadata(PUBLIC_RPC, true);
export const RequirePermissions = (...codes: string[]) => SetMetadata(REQUIRED_PERMISSIONS, codes);

export function setCurrentActor(call: unknown, actor: AuthenticatedActor): void {
  if (!call || (typeof call !== 'object' && typeof call !== 'function')) throw unauthenticated();
  actors.set(call, Object.freeze({ ...actor, permissions: Object.freeze([...actor.permissions]) as unknown as string[] }));
}

export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedActor => {
  const call: unknown = context.getArgByIndex(2);
  const actor = call && (typeof call === 'object' || typeof call === 'function') ? actors.get(call) : undefined;
  if (!actor) throw unauthenticated();
  return actor;
});
