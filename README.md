# Ladder Backend

The API behind [`ladder-web`](../ladder-web). Ladder checks who a person is once, then gives them a reusable **Ladder ID** (for example `LID-7F3A-9K2D`).

Built with NestJS and Prisma, on PostgreSQL (Supabase). Email is sent through Brevo.

## How it works

A user goes through four steps:

1. **Sign up** with email and password. The API emails a 6-digit code that expires after 10 minutes.
2. **Verify the email** by entering that code. This signs them in with a session cookie.
3. **Verify their identity** with one of:
   - **BVN or NIN** plus date of birth. The number and date are checked against an identity registry. The first BVN or NIN that passes issues the Ladder ID.
   - **Government ID** (national ID card, passport, driver's licence or voter's card). The user uploads photos of the document.
4. **Liveness check**: the user uploads a selfie. This issues the Ladder ID for users who verified with a Government ID.

Progress is saved on the server. When users sign in again, on any device, `GET /api/v1/verification/status` tells the web app where to send them: to their profile if they already have a Ladder ID, otherwise back to the step they left.

### Not finished yet

- **Identity checks use test data.** BVNs and NINs are checked against mock records in the `identity_records` table (see [Test data](#test-data-bvn--nin)). No real verification provider is connected yet, and the app refuses to start in production without one.
- **Government ID and liveness are placeholders.** Uploaded files are checked for type, size and required sides, then thrown away. Nothing reviews the documents or the selfie.

## API

All routes start with `/api/v1`. Every route needs a session except signup, login and the OTP routes.

| Area | Routes |
|---|---|
| Auth | `POST /auth/signup`, `/auth/otp/resend`, `/auth/otp/verify`, `/auth/login`, `/auth/logout` |
| Verification | `POST /verification/bvn`, `/verification/nin`, `/verification/government-id`, `/verification/liveness`; `PUT /verification/last-step`; `GET /verification/status` |
| Profile | `GET /profile/me` |

Every response uses the same shape:

```json
{ "success": true, "message": "...", "data": {} }
{ "success": false, "message": "...", "code": "OTP_INVALID", "errors": {} }
```

The request bodies, error codes and status codes for each route are in [architeture.md §5](architeture.md#5-api-rules).

## Security

- Passwords and OTP codes are hashed with argon2.
- BVNs and NINs are encrypted (AES-256-GCM). Responses only show the last 4 digits.
- Sessions use an httpOnly cookie. The database stores only a hash of the session token.
- Auth routes are rate-limited, and an OTP is locked after 5 wrong attempts.
- Row Level Security is on for every table, so Supabase's public REST API can't read them.

## Getting started

You need Node.js 22 or later, and a PostgreSQL database (a Supabase project, or a local Postgres).

```bash
npm install
cp .env.example .env     # then fill in the values below
npm run prisma:deploy    # create the tables
npm run db:seed          # load the test BVNs and NINs (prints them)
npm run dev              # http://localhost:4000/api/v1
```

### Environment variables

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Pooled database connection, used by the app |
| `DIRECT_URL` | Direct database connection, used by migrations |
| `ENCRYPTION_KEY` | 32 random bytes, base64, used to encrypt BVNs and NINs. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `BREVO_API_KEY` | Sends the OTP emails |
| `WEB_ORIGIN` | URL of `ladder-web`, for CORS and cookies (default `http://localhost:3000`) |
| `IDENTITY_PROVIDER` | Where BVNs and NINs are checked: `registry` (the seeded test table) or `mock` |

The rest of `.env.example` has working defaults.

## Test data (BVN / NIN)

`npm run db:seed` creates 20 BVNs and 20 NINs in the `identity_records` table (14 valid and 6 invalid of each) and prints them. The data is the same on every run. Copy a number and its date of birth from the output or from Supabase:

| You send | Result |
|---|---|
| A valid record's number + its `date_of_birth` | `VERIFIED`, and the Ladder ID is issued |
| A valid record's number + any other date | `BVN_DOB_MISMATCH` / `NIN_DOB_MISMATCH` |
| A record with `is_valid = false` | `BVN_INVALID` / `NIN_INVALID` |
| A number that is not in the table | `BVN_NOT_FOUND` / `NIN_NOT_FOUND` |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run with reload |
| `npm run build` / `npm start` | Build and run `dist/` |
| `npm test` | Unit tests (no network, no real email) |
| `npm run test:e2e` | End-to-end tests on a local Postgres database named `ladder_test` (override with `TEST_DATABASE_URL`). Email is faked |
| `npm run lint` / `npm run typecheck` | Lint / type check |
| `npm run prisma:migrate` | Create a migration after editing `prisma/schema.prisma` (point it at a local database, not Supabase) |
| `npm run prisma:deploy` | Apply migrations to the database in `.env` |
| `npm run db:seed` | Load or refresh the test BVN/NIN records |

## Project layout

```
prisma/          Database schema, migrations, seed data
src/
  modules/       auth, verification, users (profile)
  integrations/  identity provider and Brevo email, each behind an interface
  common/        Response format, errors, session guard, crypto helpers
  config/        Environment validation and constants
test/            End-to-end tests
```

Before changing code, read [architeture.md](architeture.md). It covers the layer rules, naming, data model and the checklist for finishing a change.
