import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { PasswordWorkBusyError } from './password.js';

export function unauthenticated(): RpcException {
  return new RpcException({ code: status.UNAUTHENTICATED, message: 'Invalid credentials or session' });
}

export async function authOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RpcException) throw error;
    if (error instanceof PasswordWorkBusyError) {
      throw new RpcException({ code: status.RESOURCE_EXHAUSTED, message: 'Authentication is busy; try again later' });
    }
    // Database and Redis errors may contain query parameters and connection credentials.
    throw new RpcException({ code: status.UNAVAILABLE, message: 'Authentication service is temporarily unavailable' });
  }
}
