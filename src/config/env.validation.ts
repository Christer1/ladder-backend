import { plainToInstance, Type } from 'class-transformer';
import {
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

  @IsUrl({ require_tld: false })
  WEB_ORIGIN: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  ENCRYPTION_KEY: string;

  @IsString()
  SESSION_COOKIE_NAME = 'ladder_session';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  SESSION_TTL_HOURS = 24;

  @IsIn(['mock'])
  IDENTITY_PROVIDER = 'mock' as const;

  @IsString()
  S3_BUCKET: string;

  @IsString()
  S3_REGION = 'us-east-1';

  @IsOptional()
  @IsString()
  S3_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  S3_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  S3_SECRET_ACCESS_KEY?: string;

  @IsString()
  SMTP_HOST: string;

  @Type(() => Number)
  @IsInt()
  SMTP_PORT = 1025;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsString()
  MAIL_FROM: string;
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
  if (env.NODE_ENV === 'production' && env.IDENTITY_PROVIDER === 'mock') {
    throw new Error(
      'Invalid environment variables:\nIDENTITY_PROVIDER: mock is not allowed in production',
    );
  }

  return env;
}
