# Ladder Backend — Architecture & Rules

Read this before writing code in `ladder-backend`. If a rule changes, update this file in the same change.

## 1. What it does

Serves `ladder-web`. A user signs up (email + password), verifies their email with an OTP, sets a 6-digit PIN, verifies a BVN or NIN together with their date of birth, and receives a reusable **Ladder ID** (e.g. `LID-7F3A-9K2D`). Government ID upload and liveness (selfie) are **out of scope**. The API contract is in `../ladder-web/SCOPE_AND_RULES.md` §8. Keep the two in sync.

## 2. Stack

| Concern | Choice |
|---|---|
| Runtime / language | Node.js 22 LTS, TypeScript (`strict`) |
| Framework | NestJS |
| Database / ORM | PostgreSQL on Supabase (schema `public`) + Prisma. `DATABASE_URL` = pooled (app), `DIRECT_URL` = direct (migrations) |
| Validation | `class-validator` DTOs + global `ValidationPipe` |
| Auth | Opaque session token in an httpOnly, SameSite cookie (Secure in production); only its SHA-256 hash is stored |
| Email | Brevo transactional API, sender `official@bovaplay.com` |
| Rate limiting | `@nestjs/throttler` |
| Tests | Jest + Supertest |
| Package manager | pnpm |

Server runs on port `4000`, all routes prefixed `/api/v1`.

## 3. Folder structure

```
ladder-backend/
├── prisma/
│   ├── schema.prisma          All models
│   ├── seed.ts                Mock BVN/NIN registry (pnpm db:seed)
│   └── migrations/
├── src/
│   ├── main.ts                Bootstrap + listen
│   ├── app.setup.ts           Prefix, CORS, cookies (shared with e2e tests)
│   ├── app.module.ts          Global guards, pipe, interceptor, filter
│   ├── config/                env.validation.ts (validated env), app.config.ts (constants)
│   ├── database/              prisma.module.ts, prisma.service.ts
│   ├── common/                Shared, feature-agnostic code
│   │   ├── filters/           http-exception.filter.ts  → error envelope
│   │   ├── interceptors/      response.interceptor.ts   → success envelope
│   │   ├── guards/            session.guard.ts
│   │   ├── decorators/        current-user.decorator.ts, public.decorator.ts
│   │   ├── errors/            app-error.ts, error-codes.ts
│   │   └── utils/             crypto.ts, mask.ts, ladder-id.ts
│   ├── integrations/          Third parties, always behind an interface
│   │   ├── identity/          identity.provider.ts (interface), registry.provider.ts (seeded table), mock.provider.ts
│   │   └── mail/              mail.service.ts (Brevo), templates/
│   └── modules/               One folder per domain
│       ├── auth/              signup, login, OTP, PIN, session
│       ├── verification/      BVN, NIN, status
│       └── users/             profile (/profile/me)
└── test/                      e2e tests (*.e2e-spec.ts)
```

Every module has the same shape:

```
modules/<name>/
├── <name>.module.ts
├── <name>.controller.ts       Routes only
├── <name>.service.ts          Business logic
├── <name>.repository.ts       The only file that calls Prisma for this module
├── dto/                       <action>.dto.ts (request) and <name>.response.ts
└── <name>.service.spec.ts     Unit tests next to the code
```

## 4. Layer rules

```
Controller → Service → Repository → Prisma
                   ↘ integrations/* (via interface)
```

- **Controller**: reads the request, validates via DTO, calls one service method, returns plain data. No Prisma, no business logic, no try/catch.
- **Service**: all business rules. Throws `AppError(code)`. Never touches `req`/`res`.
- **Repository**: database access only. Returns Prisma models; no HTTP errors.
- **Integrations**: services depend on the interface (e.g. `IdentityProvider`), never on a vendor SDK directly, so the vendor can be swapped or mocked.
- A module uses another module only through that module's exported service, never its repository.

## 5. API rules

- REST, plural nouns, kebab-case paths: `/auth/otp/verify`, `/verification/bvn`.
- Every response uses one envelope (added by the interceptor/filter, not by hand):

```ts
{ success: true,  message: string, data: T }
{ success: false, message: string, code: 'OTP_INVALID', errors?: Record<string, string[]> }
```

- Error codes live in `common/errors/error-codes.ts` as UPPER_SNAKE_CASE. `message` must be safe to show to users.
- Status codes: `200` read/ok, `201` created, `400` validation, `401` no session, `403` forbidden, `404`, `409` conflict (email taken), `422` verification failed, `429` rate limited.
- Routes require a session by default. Opt out with `@Public()` (signup, login, OTP).
- Dates are ISO 8601 strings; field names are camelCase.

Endpoints:

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/signup` | `{ email, password }` | `{ otpExpiresIn, resendAvailableIn }` |
| POST | `/auth/otp/resend` | `{ email }` | same as signup |
| POST | `/auth/otp/verify` | `{ email, code }` | sets session cookie |
| POST | `/auth/login` | `{ email, password }` | sets session cookie |
| POST | `/auth/pin` | `{ pin, confirmPin }` | `{}` |
| POST | `/auth/logout` | – | clears cookie |
| POST | `/verification/bvn` | `{ bvn, dateOfBirth }` | `{ status, ladderId }` |
| POST | `/verification/nin` | `{ nin, dateOfBirth }` | `{ status, ladderId }` |
| GET | `/verification/status` | – | `{ bvn, nin, ladderId }` (`NOT_STARTED`/`PENDING`/`VERIFIED`/`FAILED`) |
| GET | `/profile/me` | – | profile with masked numbers |

Rules: password ≥ 8 chars with a letter and a number. Login needs a verified email. BVN/NIN need the PIN first. `dateOfBirth` is `YYYY-MM-DD` and must match the registry record; after the first verified credential, the second must use the same date. The first verified BVN **or** NIN issues the Ladder ID.

BVN/NIN errors (`422`): `BVN_NOT_FOUND`, `BVN_INVALID`, `BVN_DOB_MISMATCH` (and the `NIN_` equivalents). Brevo failure: `502 EMAIL_SEND_FAILED`.

## 6. Model rules

- Table/model names are singular PascalCase in Prisma (`User`), mapped to snake_case plural in SQL (`@@map("users")`). Columns camelCase in code, snake_case in DB (`@map`).
- Every model has `id String @id @default(uuid())`, `createdAt`, `updatedAt`.
- Statuses are Prisma enums, never free strings.
- Secrets are **hashed** (password, PIN, OTP: argon2). Identity numbers are **encrypted** (AES-256-GCM) and stored with a `last4` column for display.
- Every table has Row Level Security enabled with no policies, so Supabase's REST API cannot read it. The backend connects as the owner.
- Schema changes only via `prisma migrate`; never edit an applied migration.

Starting models:

| Model | Key fields |
|---|---|
| `User` | `email` (unique), `passwordHash`, `pinHash?`, `dateOfBirth?` (from the first verified credential), `emailVerifiedAt?`, `ladderId?` (unique), `status` (`PENDING`/`VERIFIED`/`SUSPENDED`) |
| `Otp` | `email`, `codeHash`, `purpose` (`SIGNUP`), `expiresAt`, `attempts`, `consumedAt?` |
| `Verification` | `userId`, `type` (`BVN`/`NIN`), `status` (`PENDING`/`VERIFIED`/`FAILED`), `valueEncrypted?`, `last4?`, `provider`, `providerRef?`, `failureReason?` (`NOT_FOUND`/`INVALID`/`DOB_MISMATCH`), `verifiedAt?`. Unique on `(userId, type)` |
| `Session` | `userId`, `tokenHash`, `expiresAt`, `revokedAt?` |
| `IdentityRecord` | Mock registry: `type`, `number` (unique per type), `dateOfBirth`, `firstName`, `lastName`, `isValid` |

## 7. Naming

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case + role suffix | `verify-bvn.dto.ts`, `auth.service.ts` |
| Classes | PascalCase + role | `VerifyBvnDto`, `AuthService` |
| Methods / variables | camelCase, verbs for methods | `verifyBvn()`, `isExpired` |
| Constants / error codes | UPPER_SNAKE_CASE | `OTP_TTL_SECONDS`, `BVN_DOB_MISMATCH` |
| Env vars | UPPER_SNAKE_CASE | `DATABASE_URL` |

## 8. Security (non-negotiable)

- Never log passwords, PINs, OTPs, BVNs or NINs. Mask identity numbers in responses (`*******8901`).
- Rate-limit all `/auth` endpoints. Lock OTP after 5 wrong attempts.
- Tests never send real email: unit tests stub `fetch`, e2e tests replace `MailService`, and e2e runs on the local `ladder_test` database only.
- Secrets come from env only; `.env` is never committed (`.env.example` is).
- CORS allows only the `ladder-web` origin, with credentials.

## 9. Open questions

1. Identity vendor: `IDENTITY_PROVIDER=registry` (seeded test data) until a real vendor is chosen. Both `registry` and `mock` are blocked in production.
2. The previous project's tables were moved to the `old_public` schema in Supabase; nothing in this backend reads them.

## 10. Definition of done

- [ ] Follows the layer rules (§4) and envelope (§5)
- [ ] DTO validation on every input
- [ ] Service unit tests + one e2e test per endpoint (success and main failure)
- [ ] Migration included if the schema changed
- [ ] Web contract (`ladder-web` §8) still matches
- [ ] `pnpm lint`, `pnpm test`, `pnpm build` pass
