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

  // WhatsApp help chat. console prints messages instead of sending them (local dev, tests).
  @IsIn(['infobip', 'console'])
  WHATSAPP_PROVIDER: 'infobip' | 'console' = 'console';

  // From Infobip Developer Tools → API keys, e.g. abc123.api.infobip.com (https:// is assumed).
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? `${/^https?:\/\//.test(value) ? '' : 'https://'}${value.trim()}`.replace(/\/$/, '')
      : value,
  )
  @IsOptional()
  @IsUrl()
  INFOBIP_BASE_URL?: string;

  @IsOptional()
  @IsString()
  INFOBIP_API_KEY?: string;

  // The WhatsApp sender, digits only (Infobip's format): 447860088970.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @IsString()
  @IsNotEmpty()
  INFOBIP_WHATSAPP_SENDER = '447860088970';

  // Secret Infobip sends as ?token=... on the webhook URLs. Webhooks are refused without it.
  @IsOptional()
  @IsString()
  INFOBIP_WEBHOOK_TOKEN?: string;

  // This API's public URL without /api/v1, for Infobip delivery reports. Unset or localhost = none.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\/$/, '') : value,
  )
  @IsOptional()
  @IsUrl({ require_tld: false })
  PUBLIC_BASE_URL?: string;

  // Groq writes the WhatsApp replies. Unset = a fixed reply is sent instead.
  @IsOptional()
  @IsString()
  GROQ_API_KEY?: string;

  @IsString()
  GROQ_MODEL = 'openai/gpt-oss-120b';

  // Web help chat on Firestore: the Firebase Admin service account JSON, base64-encoded.
  // Unset = the web chat endpoints answer HELP_CHAT_UNAVAILABLE.
  @IsOptional()
  @IsString()
  FIREBASE_SERVICE_ACCOUNT?: string;
}

// The decoded service account, or null when FIREBASE_SERVICE_ACCOUNT is not a valid one.
export function parseServiceAccount(
  encoded: string,
): { projectId: string; clientEmail: string; privateKey: string } | null {
  try {
    const json = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
    const { type, project_id, client_email, private_key } = json;
    if (
      type !== 'service_account' ||
      typeof project_id !== 'string' ||
      typeof client_email !== 'string' ||
      typeof private_key !== 'string'
    ) {
      return null;
    }
    return { projectId: project_id, clientEmail: client_email, privateKey: private_key };
  } catch {
    return null;
  }
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
  if (env.WHATSAPP_PROVIDER === 'infobip') {
    const missing = (['INFOBIP_BASE_URL', 'INFOBIP_API_KEY', 'INFOBIP_WEBHOOK_TOKEN'] as const)
      .filter((key) => !env[key])
      .map((key) => `${key}: required when WHATSAPP_PROVIDER is infobip`);
    if (missing.length > 0) {
      throw new Error(`Invalid environment variables:\n${missing.join('\n')}`);
    }
  }
  if (env.FIREBASE_SERVICE_ACCOUNT && !parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT)) {
    throw new Error(
      'Invalid environment variables:\nFIREBASE_SERVICE_ACCOUNT: must be a Firebase service account JSON, base64-encoded',
    );
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      `Invalid environment variables:\nIDENTITY_PROVIDER: ${env.IDENTITY_PROVIDER} is test-only and not allowed in production`,
    );
  }

  return env;
}
