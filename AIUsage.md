# Ladder Backend — Architecture & Rules

> **AI usage:** We used Claude AI (by Anthropic) as a development assistant on this project. The rules below are the guidelines the team wrote and followed while building it, with Claude's help.

Read this before writing code in `ladder-backend`. If a rule changes, update this file in the same change.

## 1. What it does

Serves `ladder-web` and `ladder-assistance` (partner account opening, §5 "Assistance"). A user signs up (email + password + confirm password), verifies their email with an OTP, verifies their identity with a BVN or NIN (plus date of birth) **or** a Government ID, completes a liveness check, and receives a reusable **Ladder ID** (e.g. `LID-7F3A-9K2D`). There is no PIN: users sign in with email and password. Government ID and liveness are recorded by the backend but are **placeholders**: uploaded files are checked (sides, type, size) and then discarded; no document storage, review or liveness provider exists yet. The API contract is in `../ladder-web/rules.md` §8. Keep the two in sync.

## 2. Stack

| Concern | Choice |
|---|---|
| Runtime / language | Node.js 22 LTS, TypeScript (`strict`) |
| Framework | NestJS |
| Database / ORM | PostgreSQL on Supabase (schema `public`) + Prisma. `DATABASE_URL` = pooled (app), `DIRECT_URL` = direct (migrations) |
| Validation | `class-validator` DTOs + global `ValidationPipe` |
| Auth | Opaque session token in an httpOnly, SameSite cookie (Secure in production); only its SHA-256 hash is stored |
| Email | Brevo transactional API; the sender is `EMAIL_FROM` (an address verified in Brevo) |
| Rate limiting | `@nestjs/throttler` |
| Tests | Jest + Supertest |
| Package manager | npm |

Server runs on port `4000`, all routes prefixed `/api/v1`.

## 3. Folder structure

```
ladder-backend/
├── prisma/
│   ├── schema.prisma          All models
│   ├── seed.ts                Mock BVN/NIN registry (npm run db:seed)
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
│       ├── auth/              signup, login, OTP, logout, session cookie
│       ├── verification/      BVN, NIN, Government ID, liveness, status
│       ├── assistance/        partner account opening (ladder-assistance), own cookie + guards
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
| POST | `/auth/signup` | `{ email, password, confirmPassword }` | `{ otpExpiresIn, resendAvailableIn }`. `400 PASSWORD_MISMATCH` (field `confirmPassword`) |
| POST | `/auth/otp/resend` | `{ email }` | same as signup |
| POST | `/auth/otp/verify` | `{ email, code }` | sets session cookie |
| POST | `/auth/login` | `{ email, password }` | sets session cookie. `401 INVALID_CREDENTIALS`, `403 EMAIL_NOT_VERIFIED` |
| POST | `/auth/logout` | – | clears cookie |
| POST | `/verification/bvn` | `{ bvn, dateOfBirth }` | `{ status, ladderId }` |
| POST | `/verification/nin` | `{ nin, dateOfBirth }` | `{ status, ladderId }` |
| POST | `/verification/government-id` | multipart: `idType` + files `front`, `back` (back required except `international-passport`) | `{ status, ladderId }`. `FILE_REQUIRED` / `FILE_TYPE_INVALID` (field per side), `413 FILE_TOO_LARGE` |
| POST | `/verification/liveness` | multipart: file `selfie` (JPG/PNG) + `challenges` (JSON array) | `{ status, ladderId }`. `409 IDENTITY_REQUIRED` until a BVN, NIN or Government ID is verified. Issues the Ladder ID if none yet |
| PUT | `/verification/last-step` | `{ step }` = `CREDENTIALS` / `UPLOAD_ID` / `LIVENESS` | `{}`. Remembers the onboarding page the user is on |
| GET | `/verification/status` | – | `{ bvn, nin, governmentId, liveness, ladderId, lastStep }` (`NOT_STARTED`/`PENDING`/`VERIFIED`/`FAILED`; `lastStep` or `null`). The client resumes onboarding from this |
| GET | `/profile/me` | – | profile with masked numbers |

Rules: password ≥ 8 chars with a letter and a number. Login needs a verified email.

**Signing in and resuming.** Users sign in with email + password (`POST /auth/login`); unverified emails get `EMAIL_NOT_VERIFIED` and finish OTP first. Every step's progress lives here, so `GET /verification/status` is the single source the client uses to send a returning user back, on any device: a user **with a Ladder ID goes to their profile**; otherwise to `lastStep` (the page they were on, saved with `PUT /verification/last-step`) or the first step left. `dateOfBirth` is `YYYY-MM-DD` and must match the registry record; after the first verified credential, the second must use the same date. The first verified BVN **or** NIN issues the Ladder ID; for a Government ID, liveness issues it. All `/auth` routes have the strict limit (5/min per route and client).

**Uploads (placeholder).** Multer in memory, max 5 MB per file (`UPLOAD_MAX_BYTES`). ID files: PNG/JPG/PDF; selfie: JPG/PNG. Files are validated, then dropped: never written to disk, the database or logs. Replace with a document store + review/provider before production.

**Assistance (`ladder-assistance`).** A partner's customer identifies with BVN or NIN, BVN and NIN, or a Ladder ID, passes liveness and reviews the details on file. Routes are `@Public()` to `SessionGuard` and use their own guards: `PartnerGuard` (header `X-Partner-Id` must be in `ASSISTANCE_PARTNER_IDS`, else `403 PARTNER_NOT_ALLOWED`) and `AssistanceSessionGuard` (httpOnly cookie `ASSISTANCE_COOKIE_NAME`, 30 minutes, bound to the partner; else `401 ASSISTANCE_SESSION_EXPIRED`). Statuses are lowercase to match the ladder-assistance contract.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/assistance/identify/bvn` | `{ bvn, dateOfBirth }` | `{ status }` + cookie. `422 INFORMATION_MISMATCH` |
| POST | `/assistance/identify/nin` | `{ nin, dateOfBirth }` | same |
| POST | `/assistance/identify/bvn-and-nin` | `{ bvn, nin, dateOfBirth }` | same; both must match the date of birth and the same name |
| POST | `/assistance/identify/ladder-id` | `{ ladderId }` (6–32 letters, digits, dashes; any case) | same. `422 LADDER_ID_NOT_FOUND` |
| POST | `/assistance/liveness` | multipart file `selfie` | `{ status }` (placeholder, like `/verification/liveness`) |
| GET | `/assistance/status` | – | `{ method, identity, liveness }` |
| GET | `/assistance/details` | – | `{ fullName, dateOfBirth, gender, phoneNumber, email, stateOfOrigin, stateOfResidence, town, residentialAddress }`. Name, date of birth, phone and address come from the BVN/NIN record; gender, email (except a Ladder user's account email), states and town are fixed placeholders for now. `403 LIVENESS_REQUIRED` before liveness |
| POST | `/assistance/confirm` | `{ residentialAddress? }` (only when none on file) | `{}` |
| POST | `/assistance/session/end` | – | clears cookie |

Rules: a wrong number, an unknown number, an invalid record and a wrong date of birth all answer `INFORMATION_MISMATCH`, so the screen can't be used to find out which numbers exist. Unknown and unverified Ladder IDs share `LADDER_ID_NOT_FOUND`. A Ladder ID qualifies when its user is `VERIFIED` with a verified BVN (else NIN); details come from that record via `IdentityProvider.getPerson(providerRef)`, with the user's account email. Identify is limited to 10/min. The session stores only the token hash and the provider ref, never identity numbers. Handing confirmed details to the partner is not built yet.

BVN/NIN errors (`422`): `BVN_NOT_FOUND`, `BVN_INVALID`, `BVN_DOB_MISMATCH` (and the `NIN_` equivalents). Brevo failure: `502 EMAIL_SEND_FAILED`.

## 6. Model rules

- Table/model names are singular PascalCase in Prisma (`User`), mapped to snake_case plural in SQL (`@@map("users")`). Columns camelCase in code, snake_case in DB (`@map`).
- Every model has `id String @id @default(uuid())`, `createdAt`, `updatedAt`.
- Statuses are Prisma enums, never free strings.
- Secrets are **hashed** (password, OTP: argon2). Identity numbers are **encrypted** (AES-256-GCM) and stored with a `last4` column for display.
- Every table has Row Level Security enabled with no policies, so Supabase's REST API cannot read it. The backend connects as the owner.
- Schema changes only via `prisma migrate`; never edit an applied migration.

Starting models:

| Model | Key fields |
|---|---|
| `User` | `email` (unique), `passwordHash`, `lastOnboardingStep?` (`CREDENTIALS`/`UPLOAD_ID`/`LIVENESS`), `dateOfBirth?` (from the first verified credential), `emailVerifiedAt?`, `ladderId?` (unique), `status` (`PENDING`/`VERIFIED`/`SUSPENDED`) |
| `Otp` | `email`, `codeHash`, `purpose` (`SIGNUP`), `expiresAt`, `attempts`, `consumedAt?` |
| `Verification` | `userId`, `type` (`BVN`/`NIN`/`GOVERNMENT_ID`/`LIVENESS`), `status` (`PENDING`/`VERIFIED`/`FAILED`), `valueEncrypted?`, `last4?`, `documentType?` (Government ID type), `provider`, `providerRef?` (liveness: the challenges), `failureReason?` (`NOT_FOUND`/`INVALID`/`DOB_MISMATCH`), `verifiedAt?`. Unique on `(userId, type)` |
| `Session` | `userId`, `tokenHash`, `expiresAt`, `revokedAt?` |
| `IdentityRecord` | Mock registry: `type`, `number` (unique per type), `dateOfBirth`, `firstName`, `lastName`, `isValid`, plus optional `phoneNumber` and `residentialAddress` shown by assistance. The seed adds 6 people with both a BVN and a NIN (same name and date of birth) |
| `AssistanceSession` | `tokenHash`, `partnerId`, `method` (`BVN`/`NIN`/`BVN_AND_NIN`/`LADDER_ID`), `providerRef`, `userId?` (Ladder ID), `livenessVerifiedAt?`, `confirmedAt?`, `expiresAt`, `revokedAt?` |

## 7. Naming

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case + role suffix | `verify-bvn.dto.ts`, `auth.service.ts` |
| Classes | PascalCase + role | `VerifyBvnDto`, `AuthService` |
| Methods / variables | camelCase, verbs for methods | `verifyBvn()`, `isExpired` |
| Constants / error codes | UPPER_SNAKE_CASE | `OTP_TTL_SECONDS`, `BVN_DOB_MISMATCH` |
| Env vars | UPPER_SNAKE_CASE | `DATABASE_URL` |

## 8. Security (non-negotiable)

- Never log passwords, OTPs, BVNs, NINs, ID images or selfies. Mask identity numbers in responses (`*******8901`).
- Rate-limit all `/auth` endpoints. Lock OTP after 5 wrong attempts.
- Tests never send real email: unit tests stub `fetch`, e2e tests replace `MailService`, and e2e runs on the local `ladder_test` database only.
- Secrets come from env only; `.env` is never committed (`.env.example` is).
- CORS allows only the `WEB_ORIGIN` list (ladder-web and ladder-assistance), with credentials.

## 9. Open questions

1. Identity vendor: `IDENTITY_PROVIDER=registry` (seeded test data) until a real vendor is chosen. Both `registry` and `mock` are blocked in production.

## 10. Definition of done

- [ ] Follows the layer rules (§4) and envelope (§5)
- [ ] DTO validation on every input
- [ ] Service unit tests + one e2e test per endpoint (success and main failure)
- [ ] Migration included if the schema changed
- [ ] Web contract (`ladder-web` §8) still matches
- [ ] `npm run lint`, `npm run test`, `npm run build` pass
