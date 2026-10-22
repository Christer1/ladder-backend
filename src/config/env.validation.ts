import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 4000;

  // Comma-separated list of ladder-web origins allowed by CORS (no trailing slash).
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((origin) => origin.trim().replace(/\/$/, ''))
          .filter(Boolean)
      : value,
  )
  @IsUrl({ require_tld: false }, { each: true })
  @ArrayNotEmpty()
  WEB_ORIGIN: string[];

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  // Used by Prisma CLI for migrations; not read by the app.
  @IsOptional()
  @IsString()
  DIRECT_URL?: string;

  @IsString()
  @IsNotEmpty()
  ENCRYPTION_KEY: string;

  @IsString()
  SESSION_COOKIE_NAME = 'ladder_session';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  SESSION_TTL_HOURS = 24;

  // 'none' when ladder-web is served from a different site (e.g. Vercel + Render); forces Secure.
  @IsIn(['lax', 'strict', 'none'])
  COOKIE_SAME_SITE: 'lax' | 'strict' | 'none' = 'lax';

  // Both are test sources; a real vendor adapter is required in production.
  @IsIn(['mock', 'registry'])
  IDENTITY_PROVIDER: 'mock' | 'registry' = 'registry';

  // Partners allowed to use the assistance flow; ladder-assistance sends one as X-Partner-Id.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : value,
  )
  @IsString({ each: true })
  @ArrayNotEmpty()
  ASSISTANCE_PARTNER_IDS: string[] = ['zenith'];

  @IsString()
  ASSISTANCE_COOKIE_NAME = 'ladder_assistance_session';

  @IsString()
  @IsNotEmpty()
  BREVO_API_KEY: string;

  @IsEmail()
  EMAIL_FROM: string;

  @IsString()
  EMAIL_FROM_NAME = 'Ladder';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  // Empty strings in .env mean "not set".
  const cleaned = Object.fromEntries(Object.entries(config).filter(([, value]) => value !== ''));
  const env = plainToInstance(EnvironmentVariables, cleaned);
  const errors = validateSync(env, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors.map(
      (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    );
    throw new Error(`Invalid environment variables:\n${details.join('\n')}`);
  }

  if (Buffer.from(env.ENCRYPTION_KEY, 'base64').length !== 32) {
    throw new Error(
      'Invalid environment variables:\nENCRYPTION_KEY: must be 32 bytes, base64-encoded',
    );
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      `Invalid environment variables:\nIDENTITY_PROVIDER: ${env.IDENTITY_PROVIDER} is test-only and not allowed in production`,
    );
  }

  return env;
}
