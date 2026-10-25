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
- `src/auth/` – JWT authentication, permission guards, school scoping, `@CurrentUser()`
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
- `JWT_ACCESS_SECRET`: Secret signing access tokens (required in production; a dev-only fallback is used otherwise)
- `JWT_ACCESS_TTL_SECONDS`: Access token lifetime (default `900`)
- `JWT_REFRESH_TTL_DAYS`: Session lifetime from login, not extended by refreshing (default `30`)
- `SESSION_RETENTION_DAYS`: Days before the daily job deletes expired/revoked sessions (default `30`)
- `AUTH_DEV_TOOLS`: Set to `true` to enable the dev-only `/auth/dev/*` routes (never in production)
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

> **MySQL with binary logging (`log_bin=ON`, the default in MySQL 8).** Creating the audit
> triggers then requires the `SUPER` privilege. If `DATABASE_ADMIN_URL` is not `root` (or another
> `SUPER` account), `npm run db:harden` stops with *"MySQL binary logging is ON and the admin
> account ... does not have the SUPER privilege"*. Run this once as MySQL root, then re-run
> `npm run db:harden`:
> ```sql
> SET GLOBAL log_bin_trust_function_creators = 1;   -- until the next MySQL restart
> SET PERSIST log_bin_trust_function_creators = 1;  -- or permanently (MySQL 8+)
> ```
> Check the current value with `SHOW VARIABLES LIKE 'log_bin%';`.

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

## Authentication & authorization

Implemented in `src/auth/` (issue #13, spec sections 4.6 and 4.7).

### Every route is protected by default

Two global guards run on every request:

1. **`JwtAuthGuard`** needs `Authorization: Bearer <access token>`.
   - no token, malformed, forged or expired token, unknown user → **401**
   - user `SUSPENDED` → **403** `Account suspended`; user still `INVITED` → **403** `Account not activated`
   - The user, their role assignments and permissions are **reloaded from the database on every
     request**, so a suspension or role change applies immediately, even to tokens already issued.
2. **`PermissionsGuard`** enforces `@RequirePermission(...)` → **403** `Missing permission: ...`

Open a route with `@Public()` (login, refresh, health). Swagger UI is always reachable; use its
**Authorize** button to paste a token.

```ts
@Get('users')
@RequirePermission('users:read')          // codes from prisma/seed.ts
async getUsers(@CurrentUser() actor: AuthenticatedUser) { ... }
```

### Access tokens

`TokenService.issueAccessToken(userId, sessionId?)` signs an HS256 JWT `{ sub, type: 'access', sid? }`
with `JWT_ACCESS_SECRET`. Nothing but the user id (and session id) is trusted from the token.
Login must not call it directly: use `SessionService.createSession()` (see Sessions).

### Sessions & refresh tokens (#12)

The access token is stateless (15 min); the **refresh token is stateful**, one per session row:

- Format `<sessionId>.<secret>` (32 random bytes). Only **SHA-256(secret)** is stored, in
  `sessions.refresh_token_hash`.
- **Login** (#8, #10): `sessionService.createSession(userId, auditContextFromRequest(req), deviceId?)`
  returns `{ accessToken, refreshToken, expiresIn, sessionId, refreshExpiresAt }`.
- **`POST /auth/refresh`** `{ refreshToken }` (public): the session must exist, not be revoked or expired,
  and the user must not be suspended. Returns a **new pair**; the presented refresh token stops working
  (rotation, compare-and-swap on the stored hash).
- **Reuse detection:** a refresh token that was already rotated means it was copied: the **whole
  session is revoked** (`session_revoked` / `token_reuse`). Clients must therefore never send two
  refreshes in parallel with the same token.
- **`POST /auth/logout`** revokes the current session. Because the guard checks the session on every
  request, logout and revocation cut the access token immediately too (`401 Session has ended`).
- **Sessions are absolute:** they end `JWT_REFRESH_TTL_DAYS` after login whatever the refreshes.
- Every rejected refresh is audited as `token_refresh_failure` with its reason; the HTTP answer is
  always the generic `401 Invalid refresh token` (or `403 Account suspended`).

| Endpoint | Who | Purpose |
|---|---|---|
| `POST /auth/refresh` | public | Rotate the token pair |
| `POST /auth/logout` | logged in | End the current session |
| `GET /auth/sessions` | logged in | My active sessions + devices (`current: true` = this one) |
| `DELETE /auth/sessions/{id}` | logged in | Revoke one of my sessions |
| `GET /identity/users/{id}/sessions` | `users:read`, school-scoped | A user's active sessions |
| `DELETE /identity/users/{id}/sessions[/{sessionId}]` | `users:suspend`, school-scoped | Revoke all / one |

Suspending a user (`PATCH /identity/users/{id}` with `status: SUSPENDED`) revokes all their sessions.
A daily job (03:00) deletes sessions expired or revoked more than `SESSION_RETENTION_DAYS` ago.

### School scoping

Roles with scope `platform` (`PLATFORM_ADMIN`) act on every school. Every other role only acts in the
school of its assignment, and permissions are checked **per school** (a school admin in A who is a
student in B cannot read users of B). Helpers in `src/auth/utils/school-scope.util.ts`:

| Helper | Use |
|---|---|
| `assertSchoolAccess(user, permission, schoolId[s])` | Before reading/changing one record: 403 if outside scope |
| `schoolIdFilter(user, permission)` | In list queries: `undefined` (all) or `{ in: [...] }` |
| `schoolsWithPermission(user, permission)` | `'all'` or the list of school ids (also for the RAG filters, 4.7) |

Applied today to users, schools, spaces and documents. A school admin must pass one of their own
`schoolId`s when inviting a user or creating a space.

### Permission overview

`GET /identity/permissions[?code=users:invite]` (`users:assign_role`) lists every permission, the
roles granting it, and the users holding it. School admins only see holders in their own schools.

### Dev-only routes (until #8 / #10 exist)

With `AUTH_DEV_TOOLS=true` (and `NODE_ENV` not `production`), Swagger shows
**Authentication (dev tools)**; otherwise these answer 404:

- `POST /auth/dev/token` `{ "email": "..." }` → logs in as any existing user without a password:
  creates a real session and returns an access token **and a refresh token**
- `POST /auth/dev/cleanup-sessions` → runs the daily session cleanup now
- `POST /auth/dev/fixtures` → creates *Demo School A/B* with users `admin.a@demo.test` (SCHOOL_ADMIN),
  `student.a@demo.test`, `suspended.a@demo.test` (SUSPENDED), `invited.a@demo.test` (INVITED),
  `admin.b@demo.test`, `student.b@demo.test`

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
  `TRUNCATE`). The API exposes no endpoint to create, edit or delete events. With binary logging
  on, installing the triggers needs `SUPER` or `log_bin_trust_function_creators = 1` (see
  "Database Setup & Seeding").
- **Hash chain:** each row stores `prev_hash` (the previous row's hash) and
  `hash = SHA-256(canonical JSON of the row + prev_hash)`. Editing, deleting or inserting a row
  directly in the database breaks the chain. Writers lock the single `audit_chain_head` row
  (`SELECT ... FOR UPDATE`) while appending, so concurrent events queue up instead of racing, even
  across several API instances; `prev_hash` is also unique, so the chain can never fork.
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
`hash_mismatch` = the row was edited, `broken_link` = a row before it was deleted or inserted,
`head_mismatch` = the newest event(s) were deleted (`audit_chain_head` still points at them).
Someone with full database rights could also rewrite the head row, so for strong guarantees keep a
copy of the returned `headHash` outside the database (e.g. a daily export).

### Dev-only simulation routes

With `AUDIT_DEV_TOOLS=true` (and `NODE_ENV` not `production`), Swagger shows
**Audit Trail (dev tools)**:

- `POST /audit/dev/simulate/{event}` – records `login-success`, `login-failure`, `logout`,
  `token-refresh-failure`, `session-revoked`, `user-invited` or `account-locked`
- `GET /audit/dev/forbidden` – always answers 403 (recorded as `access_denied`)

Otherwise these routes answer 404. Remove them once the real auth endpoints exist.
