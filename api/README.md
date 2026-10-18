# WAMDP Backend API

Backend service built with NestJS, MySQL 8, and Prisma ORM for the WAMDP educational platform.

## Architecture

The codebase follows domain separation matching the system specifications:

- `src/identity-and-access/` – Users, institutions (schools), roles, permissions, session management
- `src/documents/` – Spaces, documents, versions, processing jobs
- `src/conversations/` – Conversations, chat messages, citations, answer reporting
- `src/rag-performance/` – Retrieval telemetry, latency, token metrics
- `src/mobile-sync/` – Device registration, offline cache selections, delta sync
- `src/audit/` – Append-only SHA-256 audit event logging
- `src/database/` – Prisma service and connection lifecycle
- `src/config/` – Swagger, CORS, security, and environment configuration

---

## Requirements

- Node.js 20+ (tested on Node 22 and 24)
- MySQL 8.0+

---

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and fill in your database credentials:

```bash
cp .env.example .env
```

Key variables:
- `DATABASE_URL`: MySQL connection of the **application user** (e.g. `mysql://wamdp_api_user:password@localhost:3306/wamdp_db`)
- `DATABASE_ADMIN_URL`: MySQL connection of an **admin** (e.g. `mysql://root:password@localhost:3306/wamdp_db`), used only by `npm run db:migrate` / `npm run db:harden`
- `PORT`: Server port (defaults to `3000` if omitted)
- `PLATFORM_ADMIN_EMAIL`: Email for the initial platform administrator
- `PLATFORM_ADMIN_PASSWORD`: Password for the initial administrator (hashed with bcrypt)
- `SWAGGER_PROTECTED`: Set to `true` to require basic auth for Swagger docs
- `AUDIT_DEV_TOOLS`: Set to `true` to enable the dev-only audit simulation routes (never in production)

### 3. Database Setup & Seeding

The application user must exist before the first run (once, as MySQL root):

```sql
CREATE DATABASE IF NOT EXISTS wamdp_db;
CREATE USER IF NOT EXISTS 'wamdp_api_user'@'localhost' IDENTIFIED BY 'choose-a-password';
```

```bash
# Generate the Prisma client
npx prisma generate

# Apply migrations as admin, then make audit_events insert-only (see "Audit trail")
npm run db:migrate

# Seed 6 base roles, 42 permissions, role mappings, and the first administrator
npm run seed
```

> **Already have a database created with `prisma db push`?** Mark the initial migration
> as applied once, then run `npm run db:migrate` as above:
> ```bash
> npx prisma migrate resolve --applied 0_init
> ```
> (run it with `DATABASE_URL` pointing to the admin account, e.g. via `$env:DATABASE_URL="<admin url>"` in PowerShell).

### 4. Start the Application

```bash
# Development (watch mode)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

---

## API Endpoints & Docs

- **Swagger UI**: `http://localhost:3000/api/docs`
- **Swagger JSON**: `http://localhost:3000/api/docs-json`
- **Health Check**: `http://localhost:3000/health`

---

## Available Scripts

| Script | Purpose |
|---|---|
| `npm run start:dev` | Start NestJS in watch mode |
| `npm run build` | Compile TypeScript with `nest build` |
| `npm run seed` | Seed roles, permissions, and admin user |
| `npm run db:migrate` | Apply Prisma migrations as admin, then run `db:harden` |
| `npm run db:harden` | Install the audit triggers and least-privilege grants (re-run after new tables) |
| `npm run audit:verify` | Verify the audit hash chain (exit code 1 if tampered) |
| `npm run lint` | Run Oxlint linter (type-aware) |
| `npm run test` | Run unit tests with Vitest |
| `npm run test:e2e` | Run end-to-end integration tests |
| `npm run format` | Format codebase with Prettier |

---

## Audit trail

`src/audit/` implements the non-repudiation requirement (spec section 4.5): an audit of
**people's actions**, kept separate from technical logs and monitoring.

### How it works

- **One writer:** `AuditService.record()` is the only way to write an event. Use the builders
  in `AuditEvents` so every event has the same shape:

  ```ts
  await this.audit.record(
    AuditEvents.loginFailure(
      { email: dto.email, reason: 'invalid_credentials', method: 'password' },
      auditContextFromRequest(req),
    ),
  );
  ```
- **Insert-only:** `npm run db:harden` (run by `db:migrate`) installs two triggers that reject any
  `UPDATE`/`DELETE` on `audit_events` for every MySQL user, and gives the application user only
  `SELECT, INSERT` on that table (no DDL, `TRIGGER` or `DROP`, so it cannot remove the triggers or
  `TRUNCATE`). The API exposes no endpoint to create, edit or delete events.
- **Hash chain:** each row stores `prev_hash` (the previous row's hash) and
  `hash = SHA-256(canonical JSON of the row + prev_hash)`. Editing, deleting or inserting a row
  directly in the database breaks the chain. `prev_hash` is unique, so concurrent writers cannot
  fork it (the loser retries on the new head).
- **No secrets:** `details` goes through `redactSecrets()`, which replaces passwords, tokens,
  secrets, API keys, cookies, JWTs, bearer headers and bcrypt hashes with `[REDACTED]`. Do not
  pass them anyway.
- **One row per event:** the global exception filter records `access_denied` for a 403 only if the
  request has not already recorded its own event (e.g. a `login_failure`).
- **No foreign keys** on `actor_id` / `school_id`: deleting a user or school must not modify
  audit rows.

### Event catalogue

| Category | Action | Recorded when | Actor | Entity | `details` |
|---|---|---|---|---|---|
| `authentication` | `login_success` | Successful login (password or Google) | the user | `user` | `method`, `sessionId` |
| `authentication` | `login_failure` | Rejected login | anonymous | `user` (if known) | attempted `email`, `reason`, `method` — **never the password** |
| `authentication` | `logout` | User logs out | the user | `session` | — |
| `authentication` | `token_refresh_failure` | Refresh token rejected (invalid, expired, revoked, reused, suspended user) | the user if known | `session` | `reason` — **never the token** |
| `authentication` | `session_revoked` | A session is revoked (admin action, suspension, token reuse) | the admin, or anonymous if automatic | `session` | `ownerUserId`, `reason` |
| `identity_access` | `user_invited` | A user is created/invited (`POST /identity/users`) | the inviting admin | `user` | `email`, `schoolId` |
| `security` | `access_denied` | Any HTTP 403 | the user if authenticated | `route` (`METHOD /path`) | `reason`, `requiredPermission` |
| `security` | `account_locked` | An account is locked (e.g. too many failed logins) | anonymous | `user` | `email`, `reason`, `failedAttempts`, `lockedUntil` |

Every event also stores `ip`, `device_id` (from the `X-Device-Id` header) and the user agent
(in `details.userAgent`).

> Login, refresh, logout, session revocation and lockout are built in #8, #10, #12 and #13; they only
> need to call the matching `AuditEvents` builder. Until then, the dev-only routes below simulate them.

### Verifying the chain

```bash
npm run audit:verify          # CLI, exit code 1 if tampering is detected
```

or `GET /audit/verify` in Swagger. The result names the first broken event:
`hash_mismatch` = the row was edited, `broken_link` = a row before it was deleted or inserted.
Deleting the newest rows cannot be seen from the chain alone: keep a copy of the returned
`headHash` elsewhere (e.g. a daily export) to detect that too.

### Dev-only simulation routes

With `AUDIT_DEV_TOOLS=true` (and `NODE_ENV` not `production`), Swagger shows
**Audit Trail (dev tools)**:

- `POST /audit/dev/simulate/{event}` – records `login-success`, `login-failure`, `logout`,
  `token-refresh-failure`, `session-revoked`, `user-invited` or `account-locked`
- `GET /audit/dev/forbidden` – always answers 403 (recorded as `access_denied`)

Otherwise these routes answer 404. Remove them once the real auth endpoints exist.
