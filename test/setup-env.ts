// e2e tests use a separate local database and never send real email.
// Both URLs are overridden so Prisma (app and CLI) can never reach the Supabase database from .env.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://${process.env.USER}@localhost:5432/ladder_test?schema=public`;
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.IDENTITY_PROVIDER = 'registry';
process.env.BREVO_API_KEY = 'test-key-not-used';
// WhatsApp help chat: messages are logged, not sent, and Groq is never called.
process.env.WHATSAPP_PROVIDER = 'console';
process.env.INFOBIP_WEBHOOK_TOKEN = 'test-webhook-token';
process.env.GROQ_API_KEY = '';
