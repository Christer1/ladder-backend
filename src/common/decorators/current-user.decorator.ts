import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

// Set on the request by SessionGuard.
export interface AuthUser {
  id: string;
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user as AuthUser;
  },
);
