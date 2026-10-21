# Ladder Backend

NestJS + Prisma + PostgreSQL API for `ladder-web`. Rules and structure: [architeture.md](architeture.md).

## Setup

```bash
pnpm install
cp .env.example .env          # then fill DATABASE_URL and ENCRYPTION_KEY
pnpm prisma:migrate           # create tables
pnpm start:dev                # http://localhost:4000/api/v1
```

OTP emails go to SMTP (`SMTP_HOST`/`SMTP_PORT`). Locally, run [Mailpit](https://mailpit.axllent.org) on port 1025 to read them.

## Scripts

| Command | What it does |
|---|---|
| `pnpm start:dev` | Run with reload |
| `pnpm build` / `pnpm start` | Build and run `dist/` |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | End-to-end tests against the `ladder_test` database (override with `TEST_DATABASE_URL`) |
| `pnpm lint` / `pnpm typecheck` | Lint / type check |
| `pnpm prisma:migrate` | Create and apply a migration after editing `prisma/schema.prisma` |

## Mock identity provider

With `IDENTITY_PROVIDER=mock`, any BVN/NIN passes except numbers ending in `0000`, which fail so error screens can be tested.
