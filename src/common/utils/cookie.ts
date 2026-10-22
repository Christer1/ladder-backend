import { ConfigService } from '@nestjs/config';
import { CookieOptions } from 'express';
import { EnvironmentVariables } from '../../config/env.validation';

// httpOnly session cookie settings shared by the Ladder Web and assistance sessions.
export function sessionCookieOptions(
  config: ConfigService<EnvironmentVariables, true>,
): CookieOptions {
  const sameSite = config.get('COOKIE_SAME_SITE', { infer: true });
  return {
    httpOnly: true,
    secure: sameSite === 'none' || config.get('NODE_ENV', { infer: true }) === 'production',
    sameSite,
    path: '/',
  };
}
