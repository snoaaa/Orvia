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
- `PLATFORM_ADMIN_PASSWORD`: Password for the initial administrator (hashed with argon2id)
- `SWAGGER_PROTECTED`: Set to `true` to require basic auth for Swagger docs
- `JWT_ACCESS_SECRET`: Secret signing access tokens (required in production; a dev-only fallback is used otherwise)
- `JWT_ACCESS_TTL_SECONDS`: Access token lifetime (default `900`)
- `JWT_REFRESH_TTL_DAYS`: Session lifetime from login, not extended by refreshing (default `30`)
- `SESSION_RETENTION_DAYS`: Days before the daily job deletes expired/revoked sessions (default `30`)
- `REFRESH_REUSE_GRACE_SECONDS`: Seconds the just-replaced refresh token is still accepted, for network retries (default `10`, `0` = strict)
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
  session is revoked** (`session_revoked` / `token_reuse`).
- **Grace window for retries:** the token replaced by the *last* rotation is still accepted for
  `REFRESH_REUSE_GRACE_SECONDS` (default 10 s) and returns a fresh pair, so an automatic retry after a
  lost response, or two simultaneous refreshes, do not log the user out. Older tokens, or the
  previous one after the window, still revoke the session. Clients should always keep the most
  recent refresh token they received. `0` disables the window (strict rotation).
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

Applied today to users, schools, spaces, documents and the audit trail. A school admin must pass one of
their own `schoolId`s when inviting a user or creating a space.

**Inviting into a school** (`POST /identity/users` with `schoolId`): the new user is assigned to that
school in the same transaction, with `role` (default `STUDENT`), so the inviting school admin sees
them immediately. Any school/group role can be given; platform roles (`PLATFORM_ADMIN`) only by a
platform admin (403 otherwise). Unknown role or `role` without `schoolId` → 400; unknown school → 404.

**Changing a role** (`PATCH /identity/users/{id}/role`, `users:assign_role`) with
`{ "role": "SCHOOL_ADMIN", "schoolId": "<uuid>" }` creates or replaces the user's assignment in that
school; their other schools are untouched. Re-assigning the role already held is a no-op. Unknown
role → 400, unknown user or school → 404, a platform-scoped role (or a target school outside the
actor's own) without platform-wide `users:assign_role` → 403. Audited as `identity_access/role_assigned`
with the previous role.

**Email domains** are per school (`school_domains`). `POST /identity/schools` takes
`allowedDomains: "polytechnic.edu,yahoo.org"`; `PATCH /identity/schools/{id}` replaces the list
(an empty value clears it, which means the school restricts nothing; a domain already used by another
school → 409). They gate invites (`validateDomainForSchool`) and Google sign-in
(`validateDomainForUser`). `SchoolEntity` returns the rows as `domains: string[]` next to the legacy
comma-separated `allowedDomains`.

### Pagination contract

Every list endpoint shares one contract: `page` (default `1`) and `limit` (default `10`, capped at
`100`), returning `{ data, total, page, limit, totalPages }`. `total` is the count **after** filtering,
so one call per filter also gives a counter (e.g. `GET /identity/users?status=INVITED&limit=1` →
`.total` = pending invitations).

| Endpoint | Filters / sorting |
|---|---|
| `GET /identity/users` | `status`, `search` (email or full name), `sortBy` (`createdAt`/`email`/`fullName`/`status`), `sortOrder` |
| `GET /schools`, `GET /identity/schools` | `status`, `search` (name) |
| `GET /documents` | newest first (`created_at DESC, id DESC`, indexed) |
| `GET /documents/spaces` | alphabetical (`name`, then `id`) |
| `GET /audit/events`, `GET /identity/permissions` | **not paginated** — `audit` takes `limit` (≤500); `permissions` returns the matrix with holder counts (see below) |

### Permission overview

`GET /identity/permissions` (`users:assign_role`) returns one row per permission with the roles that
grant it and `holdersTotal` — a count of **distinct users** (per user and school), scoped to the
caller's schools.

`GET /identity/permissions?code=users:invite&limit=50` drills into one permission and adds `holders[]`,
grouped per user and school: someone holding the permission through two roles, or in two schools,
appears **once**, with every granting role in `roles[]`. The list is capped by `limit` (1–200,
default 50), so the response stays small however many users the platform has.

### Dashboard overview

`GET /admin/overview?range=7d|30d|12m` (`users:read`) is the single call behind the admin dashboard:
user/school/session/document counts, a zero-filled time series of successful logins, failed logins and
new sessions (daily for `7d`/`30d`, monthly for `12m`), the 7 spaces with the most documents, and the
10 most recent audit events.

Each section is included only if the caller may read it — users (`users:read`), schools
(`schools:read`), sessions (`users:suspend`), documents (`documents:read`), spaces (`spaces:read`),
series and recent activity (`audit:read`) — and every number is scoped like the matching list endpoint,
so a school admin gets their own school's numbers from the same URL.

### Dev-only routes (until #8 / #10 exist)

With `AUTH_DEV_TOOLS=true` (and `NODE_ENV` not `production`), Swagger shows
**Authentication (dev tools)**; otherwise these answer 404:

- `POST /auth/dev/token` `{ "email": "..." }` → logs in as any existing user without a password:
  creates a real session and returns an access token **and a refresh token**
- `POST /auth/dev/cleanup-sessions` → runs the daily session cleanup now
- `POST /auth/dev/fixtures` → creates *Demo School A/B* with users `admin.a@demo.test` (SCHOOL_ADMIN),
  `student.a@demo.test`, `suspended.a@demo.test` (SUSPENDED), `invited.a@demo.test` (INVITED),
  `admin.b@demo.test`, `student.b@demo.test`

## User administration

`src/identity-and-access/controllers/users.controller.ts`, under the **Users** tag in Swagger
(Section 4.5). Platform admins act on every school, school admins on their own school(s) only;
other roles have no `users:*` permission and get 403.

### Search and list users: `GET /users` (#38, `users:read`)

| Query | Meaning |
|---|---|
| `search` | Part of the full name or email, case-insensitive |
| `schoolId`, `role`, `groupId` | Combinable; school, role and group must match the **same** assignment ("STAFF in school A"). A group also matches through a group membership |
| `status` | `INVITED`, `ACTIVE` or `SUSPENDED` |
| `page`, `limit` | Default 1 and 10, `limit` at most 100 |
| `sortBy`, `order` | `createdAt` (default), `fullName`, `email`, `status`; `asc` / `desc` (default) |

Answer: `{ data, total, page, limit, totalPages }`. Each user carries its `assignments`
(school, role, group). School admins only get users with an assignment in their schools, and only
those assignments; filtering on another school or one of its groups is 403. Users without any school
are visible to platform admins only. Password hashes, tokens and Google ids are never returned.
Unknown role → 400, unknown group → 404.

### View a user: `GET /users/{id}` (#39, `users:read`)

Returns the profile, `status`, `hasPassword`, `googleLinked`, `assignments`, `groups` and the active
`sessions` with their devices (IP, user agent, created, last used, expiry). School admins only get
users of their own school(s), and only those assignments and groups; another school, or a user
without a school, is 403. Sessions belong to the user, not to a school, so all active ones are listed.
Password hashes, tokens and Google ids are never returned. Invalid UUID → 400, unknown user → 404.

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
  secrets, API keys, cookies, JWTs, bearer headers and legacy `$2b$` hashes with `[REDACTED]`. Do not
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
| `identity_access` | `role_assigned` | A user's role in a school is created or replaced (`PATCH /identity/users/{id}/role`) | the assigning admin | `user` | `email`, `schoolId`, `role`, `previousRole` |
| `security` | `access_denied` | Any HTTP 403 | the user if authenticated | `route` (`METHOD /path`) | `reason`, `requiredPermission` |
| `security` | `account_locked` | An account is locked (e.g. too many failed logins) | anonymous | `user` | `email`, `reason`, `failedAttempts`, `lockedUntil` |

**Reading is school-scoped:** `GET /audit/events` returns every event to a platform administrator,
but a school administrator only the events whose `school_id` is one of their own schools. Events
without a school (platform actions, unknown-user login failures) stay invisible to them.
`GET /audit/verify` and `npm run audit:verify` still check the **whole** chain regardless of the caller.

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
