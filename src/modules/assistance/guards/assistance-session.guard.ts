import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../../config/env.validation';
import { AssistanceService } from '../assistance.service';
import { AssistanceRequest } from './assistance-request';

// Needs the assistance cookie set on identify. Runs after PartnerGuard.
@Injectable()
export class AssistanceSessionGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly assistanceService: AssistanceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AssistanceRequest>();
    const token: unknown =
      req.cookies?.[this.config.get('ASSISTANCE_COOKIE_NAME', { infer: true })];

    req.assistanceSession = await this.assistanceService.validateSession(
      typeof token === 'string' ? token : '',
      req.partnerId as string,
    );
    return true;
  }
}
