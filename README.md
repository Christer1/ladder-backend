# Ladder Backend

NestJS + Prisma API for `ladder-web`, on Supabase Postgres with Brevo for email. Rules and structure: [architeture.md](architeture.md).

## Setup

```bash
pnpm install
cp .env.example .env     # fill DATABASE_URL, DIRECT_URL, ENCRYPTION_KEY, BREVO_API_KEY
pnpm prisma:deploy       # apply migrations
pnpm db:seed             # load the mock BVN/NIN registry (prints the test data)
pnpm start:dev           # http://localhost:4000/api/v1
```

## Test data (BVN / NIN)

`pnpm db:seed` creates 20 BVNs and 20 NINs in the `identity_records` table (14 valid and 6 invalid of each) and prints them. The data is the same every run. Copy a number and its date of birth from the output or from Supabase:

| You send | Result |
|---|---|
| A valid record's number + its `date_of_birth` | `VERIFIED`, and the Ladder ID is issued |
| A valid record's number + any other date | `BVN_DOB_MISMATCH` / `NIN_DOB_MISMATCH` |
| A record with `is_valid = false` | `BVN_INVALID` / `NIN_INVALID` |
| A number that is not in the table | `BVN_NOT_FOUND` / `NIN_NOT_FOUND` |

## Scripts

| Command | What it does |
|---|---|
| `pnpm start:dev` | Run with reload |
| `pnpm build` / `pnpm start` | Build and run `dist/` |
| `pnpm test` | Unit tests (no network, no real email) |
| `pnpm test:e2e` | End-to-end tests on the local `ladder_test` database (override with `TEST_DATABASE_URL`); email is faked |
| `pnpm lint` / `pnpm typecheck` | Lint / type check |
| `pnpm prisma:migrate` | Create a migration after editing `prisma/schema.prisma` (point it at a local database, not Supabase) |
| `pnpm prisma:deploy` | Apply migrations to the database in `.env` |
| `pnpm db:seed` | Load or refresh the mock BVN/NIN registry |
