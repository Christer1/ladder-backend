import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AssistanceSession } from '@prisma/client';
import { Request } from 'express';

// Set on the request by PartnerGuard and AssistanceSessionGuard.
export interface AssistanceRequest extends Request {
  partnerId?: string;
  assistanceSession?: AssistanceSession;
}

export const PartnerId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<AssistanceRequest>().partnerId as string,
);

export const CurrentAssistanceSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AssistanceSession =>
    ctx.switchToHttp().getRequest<AssistanceRequest>().assistanceSession as AssistanceSession,
);
