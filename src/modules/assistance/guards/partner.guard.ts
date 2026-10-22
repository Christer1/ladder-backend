import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../../common/errors/app-error';
import { PARTNER_ID_HEADER } from '../../../config/app.config';
import { EnvironmentVariables } from '../../../config/env.validation';
import { AssistanceRequest } from './assistance-request';

// Every assistance request names its partner in X-Partner-Id. It is a public identifier, not a
// secret: real partner authentication is still an open question (architeture.md §9).
@Injectable()
export class PartnerGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AssistanceRequest>();
    const partnerId = req.header(PARTNER_ID_HEADER)?.trim().toLowerCase();
    const allowed = this.config.get('ASSISTANCE_PARTNER_IDS', { infer: true });
    if (!partnerId || !allowed.includes(partnerId)) throw new AppError('PARTNER_NOT_ALLOWED');

    req.partnerId = partnerId;
    return true;
  }
}
