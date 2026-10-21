# Ladder Backend — Architecture & Rules

Read this before writing code in `ladder-backend`. If a rule changes, update this file in the same change.

## 1. What it does

Serves `ladder-web`. A user signs up (email + DOB), verifies with an OTP, sets a 6-digit PIN, verifies identity (BVN / NIN / Government ID + liveness) and receives a reusable **Ladder ID** (e.g. `LID-7F3A-9K2D`). The API contract is in `../ladder-web/SCOPE_AND_RULES.md` §8. Keep the two in sync.

## 2. Stack

| Concern | Choice |
|---|---|
| Runtime / language | Node.js 22 LTS, TypeScript (`strict`) |
| Framework | NestJS |
| Database / ORM | PostgreSQL + Prisma |
| Validation | `class-validator` DTOs + global `ValidationPipe` |
| Auth | Opaque session token in an httpOnly, SameSite cookie (Secure in production); only its SHA-256 hash is stored |
| File storage | S3-compatible bucket (private) |
| Email | Nodemailer over SMTP |
| Rate limiting | `@nestjs/throttler` |
| Tests | Jest + Supertest |
| Package manager | pnpm |

Server runs on port `4000`, all routes prefixed `/api/v1`.

## 3. Folder structure

```
ladder-backend/
├── prisma/
│   ├── schema.prisma          All models
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
│   │   └── utils/             crypto.ts, mask.ts, ladder-id.ts, file-signature.ts
│   ├── integrations/          Third parties, always behind an interface
│   │   ├── identity/          identity.provider.ts (interface) + <vendor>.provider.ts (mock.provider.ts for dev)
│   │   ├── storage/           storage.service.ts
│   │   └── mail/              mail.service.ts
│   └── modules/               One folder per domain
│       ├── auth/              signup, OTP, PIN, session
│       ├── verification/      BVN, NIN, government ID, liveness, status
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

- REST, plural nouns, kebab-case paths: `/auth/otp/verify`, `/verification/government-id`.
- Every response uses one envelope (added by the interceptor/filter, not by hand):

```ts
{ success: true,  message: string, data: T }
{ success: false, message: string, code: 'OTP_INVALID', errors?: Record<string, string[]> }
```

- Error codes live in `common/errors/error-codes.ts` as UPPER_SNAKE_CASE. `message` must be safe to show to users.
- Status codes: `200` read/ok, `201` created, `400` validation, `401` no session, `403` forbidden, `404`, `409` conflict (email taken), `422` verification failed, `429` rate limited.
- Routes require a session by default. Opt out with `@Public()` (signup, OTP).
- Dates are ISO 8601 strings; field names are camelCase.

Initial endpoints (same as the web contract):

| Method | Path | Module |
|---|---|---|
| POST | `/auth/signup` | auth |
| POST | `/auth/otp/verify` · `/auth/otp/resend` | auth |
| POST | `/auth/pin` | auth |
| POST | `/auth/logout` | auth |
| POST | `/verification/bvn` · `/verification/nin` | verification |
| POST | `/verification/government-id` (multipart) | verification |
| POST | `/verification/liveness` (multipart) | verification |
| GET | `/verification/status` | verification |
| GET | `/profile/me` | users |

## 6. Model rules

- Table/model names are singular PascalCase in Prisma (`User`), mapped to snake_case plural in SQL (`@@map("users")`). Columns camelCase in code, snake_case in DB (`@map`).
- Every model has `id String @id @default(uuid())`, `createdAt`, `updatedAt`.
- Statuses are Prisma enums, never free strings.
- Secrets are **hashed** (PIN, OTP: argon2). Identity numbers are **encrypted** (AES-256-GCM) and stored with a `last4` column for display.
- Files are never stored in the DB, only the storage key.
- Schema changes only via `prisma migrate`; never edit an applied migration.

Starting models:

| Model | Key fields |
|---|---|
| `User` | `email` (unique), `dateOfBirth`, `pinHash?`, `emailVerifiedAt?`, `ladderId?` (unique), `status` (`PENDING`/`VERIFIED`/`SUSPENDED`) |
| `Otp` | `email`, `codeHash`, `purpose` (`SIGNUP`), `expiresAt`, `attempts`, `consumedAt?` |
| `Verification` | `userId`, `type` (`BVN`/`NIN`/`GOVERNMENT_ID`/`LIVENESS`), `status` (`PENDING`/`VERIFIED`/`FAILED`), `valueEncrypted?`, `last4?`, `provider`, `providerRef?`, `failureReason?`, `verifiedAt?`. Unique on `(userId, type)` |
| `Document` | `verificationId`, `idType`, `storageKey`, `mimeType`, `sizeBytes` |
| `Session` | `userId`, `tokenHash`, `expiresAt`, `revokedAt?` |

## 7. Naming

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case + role suffix | `verify-bvn.dto.ts`, `auth.service.ts` |
| Classes | PascalCase + role | `VerifyBvnDto`, `AuthService` |
| Methods / variables | camelCase, verbs for methods | `verifyBvn()`, `isExpired` |
| Constants / error codes | UPPER_SNAKE_CASE | `OTP_TTL_SECONDS`, `BVN_MISMATCH` |
| Env vars | UPPER_SNAKE_CASE | `DATABASE_URL` |

## 8. Security (non-negotiable)

- Never log PIN, OTP, BVN, NIN, documents or selfies. Mask identity numbers in responses (`*******8901`).
- Rate-limit signup, OTP and PIN endpoints. Lock OTP after 5 wrong attempts.
- Uploads: accept only PNG/JPEG/PDF, max 5 MB, checked by file signature, not just the extension. Bucket is private.
- Secrets come from env only; `.env` is never committed (`.env.example` is).
- CORS allows only the `ladder-web` origin, with credentials.

## 9. Open questions

Defaults are in code (marked `TODO`) until product confirms:
1. Minimum age: 18 (`MIN_AGE_YEARS`).
2. Government ID types (`GOVERNMENT_ID_TYPES`).
3. One verified credential (BVN, NIN or Gov ID) is enough to start liveness.
4. Identity vendor: `IDENTITY_PROVIDER=mock` until chosen (mock is blocked in production).

## 10. Definition of done

- [ ] Follows the layer rules (§4) and envelope (§5)
- [ ] DTO validation on every input
- [ ] Service unit tests + one e2e test per endpoint (success and main failure)
- [ ] Migration included if the schema changed
- [ ] Web contract (`ladder-web` §8) still matches
- [ ] `pnpm lint`, `pnpm test`, `pnpm build` pass
