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
their own `schoolId`s when inviting a user. Creating a space always needs a `schoolId`, for platform
admins too (see "Document spaces").

**Inviting into a school** (`POST /identity/users` with `schoolId`): the new user is assigned to that
school in the same transaction, with `role` (default `STUDENT`), so the inviting school admin sees
them immediately. Any school/group role can be given; platform roles (`PLATFORM_ADMIN`) only by a
platform admin (403 otherwise). Unknown role or `role` without `schoolId` → 400; unknown school → 404.

**Changing a role** (`PATCH /identity/users/{id}/role`, `users:assign_role`) with
`{ "role": "SCHOOL_ADMIN", "schoolId": "<uuid>" }` creates or replaces the user's assignment in that
school; their other schools are untouched. Re-assigning the role already held is a no-op. Unknown
role → 400, unknown user or school → 404, a target school outside the actor's own → 403, and a role
above the actor's own level → 403 (`assertCanGrantRole`, the same check as `POST /assignments`, see
[Assignments](#assignments); only a platform admin can grant a platform role). Audited as
`identity_access/role_assigned` with the previous role.

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
| `sortBy`, `sortOrder` | `createdAt` (default), `fullName`, `email`, `status`; `asc` / `desc`. Newest first for `createdAt`, A–Z for the other columns |

Answer: `{ data, total, page, limit, totalPages }`. Each user carries its `assignments`
(school, role, group). School admins only get users with an assignment in their schools, and only
those assignments; filtering on another school or one of its groups is 403. Users without any school
are visible to platform admins only. Password hashes, tokens and Google ids are never returned.
Unknown role → 400, unknown group → 404. `GET /identity/users` runs the same code.

### View a user: `GET /users/{id}` (#39, `users:read`)

Returns the profile, `status`, `hasPassword`, `googleLinked`, `assignments`, `groups` and the active
`sessions` with their devices (IP, user agent, created, last used, expiry). School admins only get
users of their own school(s), and only those assignments and groups; another school, or a user
without a school, is 403. Sessions belong to the user, not to a school, so all active ones are listed.
Password hashes, tokens and Google ids are never returned. Invalid UUID → 400, unknown user → 404. This replaces the former `GET /identity/users/{id}`.

### Edit a user: `PATCH /users/{id}` (#40, `users:update`)

Body: `fullName` and/or `email` (at least one, otherwise 400). The status cannot be changed here.
A new email must match the allowed domains of the user's schools (400), following the login rule: a
user who also belongs to a school without domain restrictions passes. An email used by someone else
is 409. School admins can only edit users of their own school(s) (403). `updated_at` changes only when
a value really changes. The older `PATCH /identity/users/{id}` applies the same email checks.

### Reactivate a user: `PATCH /users/{id}/reactivate` (#42, `users:suspend`)

Lifts a suspension so the user can sign in again. No body.

| User before | Result |
|---|---|
| `SUSPENDED`, with a password or a linked Google account | **200**, status `ACTIVE` |
| `SUSPENDED`, with neither (suspended before finishing the invitation) | **200**, status `INVITED`: the invitation flow resumes, and a setup token that is still valid works again on `POST /auth/password/setup` |
| `ACTIVE` | **200**, nothing changes (idempotent) |
| `INVITED` | **409**: only a suspended user can be reactivated |

Sessions revoked by the suspension stay revoked: the user signs in again to get new ones. Same rules
as suspension: platform admins act on any user; school admins only on users whose schools are **all**
theirs, never on a user with a higher-level (platform) role, and nobody on their own account (403).
Invalid UUID → 400, unknown user → 404. The older `PATCH /identity/users/{id}` with `status: ACTIVE`
applies the same rules, including the return to `INVITED`.

## School domains

`src/identity-and-access/controllers/school-domains.controller.ts`, under the **Schools** tag in Swagger
(Section 4.6). The allowed email domains of a school decide who can be invited and sign in with Google;
`school_domains` is read on every request, so a change applies to the next invitation and login.

| Endpoint | Permission | Answer |
|---|---|---|
| `GET /schools/{id}/domains` | `schools:read` | The domains with their ids |
| `POST /schools/{id}/domains` `{ "domain": "..." }` | `schools:update` | 201 with the new domain |
| `DELETE /schools/{id}/domains/{domainId}` | `schools:update` | 204 |

Platform admins act on every school, school admins on their own (403 otherwise). Domains are trimmed,
lowercased and stripped of a leading `@`, and must be a plain domain name with a top-level part
(`school`, `*.x.edu`, `user@x.edu`, `http://x.edu` → 400). A suffix shared by a whole country (`edu.cm`,
`ac.uk`, `co.za`...) is refused (400), so it cannot block every school under it. A domain cannot belong to
two schools, and neither can its parent or subdomains, because login accepts subdomains (409). Already on this
school, or a subdomain of one of its domains (redundant) → 409; a broader parent is allowed. Domain of another
school through this school → 404. `schools.allowed_domains` (TEXT since migration
`9_schools_allowed_domains_text`) is kept equal to the rows.
**Removing the last domain lifts the restriction:** a school without domains accepts any email domain.
`POST /schools` and `PATCH /schools/{id}` (`allowedDomains`) apply the same format and overlap rules;
`allowedDomains: null` clears the list like `""`. After pulling, run `npx prisma generate` and `npm run db:migrate`.

## Groups

`src/identity-and-access/controllers/groups.controller.ts`, under the **Groups** tag in Swagger
(Sections 4.5 and 4.7). Platform admins act on every school, school admins on their own school(s) only.

### Create a group: `POST /groups` (#33, `groups:create`)

Body: `schoolId`, `name` and optionally `type` (`class` by default, `department` or `team`). The name is
unique within a school, ignoring case (409), enforced by a database index. Another school → 403,
unknown school → 404, deactivated school → 400.

### List, view and update groups (#34)

| Endpoint | Permission | Who |
|---|---|---|
| `GET /groups` | `groups:read` | Platform admins, school admins and content managers (own school) |
| `GET /groups/{id}` | `groups:read` | Same |
| `PATCH /groups/{id}` | `groups:update` | Platform admins and school admins (own school) |

`GET /groups` filters on `schoolId`, `type` and `search` (part of the name), pages with `page` / `limit`
(default 1 and 10, `limit` at most 100) and sorts with `sortBy` (`createdAt`, `name`, `type`) and
`sortOrder` (newest first for `createdAt`, A–Z otherwise). Answer: `{ data, total, page, limit, totalPages }`.
Each group carries its `schoolName` and `memberCount` (rows of `group_members`). Filtering on another
school, or viewing / updating one of its groups, is 403.

`PATCH /groups/{id}` takes `name` and/or `type` (at least one, otherwise 400); the school cannot change.
A name used by another group of the school → 409, deactivated school → 400. `updated_at` changes
only when a value really changes.

### Delete a group: `DELETE /groups/{id}` (#35, `groups:delete`)

Soft delete, answered with 204. In one transaction:

- the group keeps its row with `deleted_at`, and its name gets a ` [deleted <date>]` suffix so a new group
  can take the name;
- its `group_members` rows and the `document_access` rows it granted are deleted;
- `user_assignments` pointing to it lose the group but keep their school role.

Deleted groups are hidden everywhere: `GET /groups` skips them, and `GET` / `PATCH` / `DELETE /groups/{id}`
and `GET /users?groupId=` answer 404. Deactivated school → 400. After pulling, run `npx prisma generate`
then `npm run db:migrate` (migration `8_groups_soft_delete`); without the first, the API fails with
`Unknown argument deletedAt`. `updated_at` is set to the deletion date, so the mobile delta sync sees it.

### Add members: `POST /groups/{id}/members` (#36, `groups:manage_members`)

Body `{ "userIds": [...] }` (1 to 100 UUIDs, repeated ids count once). All or nothing: every user must have
an assignment in the group's school, otherwise 400 listing those ids and nobody is added (an unknown id gets the
same answer, so ids of other schools are not revealed). Invited and suspended users can be added. Users already in
the group are skipped. Answer: `{ added, alreadyMembers, memberCount }`. The group's `updated_at` moves when
someone is added. Deleted group → 404, deactivated school → 400.

### Remove a member: `DELETE /groups/{id}/members/{userId}` (#37, `groups:manage_members`)

Answered with 204. In one transaction the membership is deleted, the user's assignments pointing to the group
lose it (the school role stays), and the group's `updated_at` moves for the next mobile sync. A user who is
not a member → 404 `User <id> is not a member of this group`. Deleted group → 404, deactivated school → 400.

> Content managers got `groups:read` in #34: re-run `npm run seed` on existing databases (safe to repeat).

## Roles

`src/identity-and-access/controllers/roles.controller.ts`, under the **Roles** tag in Swagger (Section 4.5).
Reading needs `users:assign_role` (platform and school admins); writing needs `system:manage`, and the
service also refuses a school-scoped role holding it. The six base roles are **read-only** — the seed
recreates them — so only a custom role can be edited.

Two rules hold on every write (`POST` and `PATCH`):

- **`system:manage` implies the platform scope.** A role that grants `system:manage` (or the `*` wildcard)
  may only exist with `scope: 'platform'`; a `school` or `group` role holding it is 400
  (`A role that grants system:manage must have the platform scope`), so no school role can administer the
  platform.
- **The scope of an assigned role is frozen.** `PATCH` refuses to change `scope` while
  `assignedUsersCount > 0` (400, "still assigned to N user(s)"): `schoolsWithPermission()` treats a
  platform-scoped assignment as **every** school, so re-scoping a role that people already hold would
  silently widen (or narrow) their access. Reassign the holders first.

### Read roles and their permissions: `GET /roles`, `GET /roles/{id}` (`users:assign_role`)

`GET /roles` returns every role, sorted by name: `id`, `name`, `scope`, the sorted permission `permissions`
(codes), the matching `permissionIds`, `assignedUsersCount` (active assignments) and `isBase`.
`GET /roles/{id}` answers the same shape for one role, and takes either its UUID or its **name**
(case-insensitive); an unknown role is 404. Both are what a role editor loads before a `PATCH`, and what
answers "which permissions does this role grant?" — base roles included, e.g. `GET /roles/STUDENT`.

### Create a role: `POST /roles` (#44, `system:manage`)

```json
{ "name": "TEACHING_ASSISTANT", "scope": "school", "permissions": ["documents:read", "rag:query"] }
```

- `name`: 2–50 letters, digits, `_` or `-`, stored in upper case. Unique ignoring case (409, enforced by the
  unique index, so two simultaneous requests cannot both succeed). The six base role names are reserved (400).
- `scope`: the documentary scope, `platform`, `school` or `group` (see the two rules above).
- `permissions`: at least one permission **code**, as listed by `GET /permissions`, no repeats, none blank
  (400). An unknown code is 400 and nothing is created. The role and its permissions are written in one
  transaction.

Answer 201 with the role (`id`, `name`, `scope`, sorted `permissions`, `permissionIds`, `assignedUsersCount`,
`isBase`). Other roles get 403. The older `POST /identity/roles`, used by the web role editor, runs the same code.

### Edit a role and its permissions: `PATCH /roles/{id}` (#45, `system:manage`)

```json
{ "name": "TEACHING_ASSISTANT_2", "scope": "group", "permissionIds": ["<uuid>", "<uuid>"] }
```

Every field is optional — `name`, `scope`, and **one** of `permissions` (codes) or `permissionIds` (ids, as
returned by `GET /permissions` and by `GET /roles`) — but at least one must be sent (400 otherwise), and the
whole payload is validated before anything is written:

- **Base roles cannot be edited** (400 `System base roles cannot be edited`). Renaming a custom role *to* a
  base role name is 400 too, and a name already taken is 409 (also when two concurrent renames race: the
  unique index answers 409, not 500).
- The permission set is **replaced**, not merged: an empty array makes the role grant nothing, an unknown,
  blank or over-long (100+ characters) code or id is 400, and sending both spellings is 400. Codes are
  trimmed before they are deduplicated, so `["documents:read", " documents:read "]` is the same 400 as the
  unpadded duplicate; `permissionIds` are matched case-insensitively (an upper-case UUID is accepted).
- **A field sent as `null` is a 400**, never a crash or a silent wipe: `name`, `scope`, `permissions` and
  `permissionIds` accept *absent* (`undefined`) or a valid value, nothing else.
- The two rules above apply: `system:manage` needs the platform scope, and the scope of an assigned role
  cannot change.
- **The role row is locked (`SELECT ... FOR UPDATE`) before any of this is decided**, so the
  assigned-role rule cannot be raced: `POST /assignments` locks the same row, so a re-scope and an
  assignment cannot both go through (the loser gets 400, or 409 `changed scope while the assignment was
  being created`), and a role can never end up platform-scoped with a school assignment created against it.
- A payload that changes nothing writes nothing and audits nothing.
- The role row, its permission set, the **`updated_at` of its active assignments** *and* the audit row are
  written in **one transaction**, so a failed audit append rolls the edit back instead of leaving an
  unaudited change (Section 4.7's mobile sync included).
- Permissions are read from the database on every request, so a user holding the role is allowed or refused
  by the new set **on their very next request**; the change is audited as `identity_access/role_updated`
  with `previousName`, `previousScope`, `scope`, and the permission diff (`addedPermissions`,
  `removedPermissions`) — a scope-only edit is therefore readable in the trail.

Answer 200 with the updated role (same shape as `GET /roles/{id}`). The older
`PATCH /identity/roles/{id}`, used by the web role editor, runs the same code.

`permissions` and `permissionIds` are parallel arrays: both are built from one list sorted by code, so
`permissionIds[i]` always belongs to `permissions[i]` (this matters for the dotted codes, where UTF-16
order and `localeCompare` disagree).

### Delete a role: `DELETE /roles/{id}` (#46, `system:manage`)

```http
DELETE /roles/{id}
```

Removes a custom role nobody holds. `{id}` is the role UUID or its **name** (case-insensitive).

- **Base roles cannot be deleted** (400 `System base roles cannot be deleted`): the six system roles are
  recreated by the seed, so they are never removed.
- **A role that is still assigned is refused** (400) with the exact count:
  `Cannot delete role 'TEACHING_ASSISTANT': still assigned to 3 user(s). Please reassign them before deleting.`
  The count is of **distinct users** (one person holding the role in two schools is one user), and only
  **active** assignments count, so a soft-deleted assignment (`DELETE /assignments/{id}`) no longer blocks
  the delete.
- **Platform admins only**: the route needs `system:manage`, and the service also refuses a school-scoped
  role holding it (403 `Only platform administrators may delete roles`), checked *before* the role lookup so
  a non-platform admin cannot probe which role ids exist.
- **One transaction, one lock.** The lookup, the checks, the counts, the delete and the audit row all run in
  a single `$transaction` that starts by locking the role row (`SELECT ... FOR UPDATE`), and the delete goes
  through `deleteMany` so a role removed in the meantime answers **404** instead of a Prisma `P2025` 500.
  Two concurrent deletes therefore answer `200` + `404` with **one** audit row, an assignment being created
  at the same time cannot slip between the count and the delete (both lock the same row; the assignment gets
  a clean 400/409, never a foreign-key 500), and a failed audit append rolls the deletion back.
- Deleting also drops the role's `role_permissions` rows, any `document_access` rule that granted it and any
  remaining `user_assignments` rows (all `ON DELETE CASCADE`). The audit event records both counts:
  `documentAccessRulesRemoved` (so a document's audience change is visible) and `assignmentRecordsRemoved`
  (soft-deleted tombstones kept for the mobile delta sync, #49, which the cascade wipes otherwise).
- Unknown role → 404. Answer 200 `{ "success": true, "message": "Role 'X' was successfully deleted" }`, and
  the deletion is audited as `identity_access/role_deleted`.

The older `DELETE /identity/roles/{id}`, used by the web role editor, runs the same code.

## Assignments

`src/identity-and-access/controllers/assignments.controller.ts`, under the **Assignments** tag in Swagger
(Sections 4.5 and 4.7). An assignment gives a user a role in a school, optionally in one of its groups. All
routes need `users:assign_role` (platform and school admins).

**Role level** (`src/auth/utils/role-level.util.ts`) comes from the role scope: platform 3 > school 2 > group 1
(another scope 0). An admin's level is the highest level of their own roles that carry `users:assign_role` in
the target school (platform roles count everywhere). `assertCanGrantRole` (`src/auth/utils/role-grant.util.ts`)
refuses a role above it, here and in `PATCH /identity/users/{id}/role`.

### Assign a user: `POST /assignments` (#47)

```json
{ "userId": "<uuid>", "schoolId": "<uuid>", "groupId": "<uuid, optional>", "role": "STUDENT" }
```

- One assignment per user per school, enforced by the service (the user row is locked while checking): a second
  one → 409; change it with `PATCH /assignments/{id}` (or `PATCH /identity/users/{id}/role`). The database has no unique index on it yet.
- The group must belong to the school (400) and exist (404); a platform role cannot have a group (400). With a
  group, the user is also added to its members (`group_members`), so it shows under `groups` in `GET /users/{id}`.
- 403: another school, a role above the admin's level, or a user who already holds a higher-level role.
- Unknown user, school or group → 404; unknown role or deactivated school → 400.

Answer 201 with `id`, `userId`, `schoolId`, `schoolName`, `groupId`, `groupName`, `role`, `roleScope`,
`createdAt`, `updatedAt`. Audited as `identity_access/role_assigned` (with `groupId`, `previousRole: null`). The
assignment appears in `GET /users/{id}`.

### Update an assignment: `PATCH /assignments/{id}` (#48)

```json
{ "role": "STAFF", "groupId": "<uuid> | null" }
```

Both fields are optional, but at least one is required (empty body → 400). **The school is not editable**:
`schoolId` is not a field (sending it → 400); to move a user to another school, create an assignment there.

- `role` left out keeps the role; `groupId` left out keeps the group, `null` removes it.
- Same checks as `POST /assignments`: another school, a role above the admin's level, or a user who already holds
  a higher-level role → 403; unknown role, deactivated school, group of another school, or a group on a platform
  role → 400 (also when only the role becomes a platform role and the current group is kept: send
  `groupId: null` with it); unknown or removed assignment, or unknown group → 404.
- **Group members**: a new group removes the user from the old group's members and adds them to the new one;
  `groupId: null` only removes the old membership. The assignment is the only source of a membership in its school
  (a group belongs to one school, a user has one assignment per school).
- **`updated_at`** (Section 4.7): moves only on a real change, so the next mobile sync picks it up. When the role
  and group stay the same, nothing is written, nothing is audited, and `updatedAt` is unchanged. Nothing is written
  to `sync_changes` yet (the mobile sync is still a stub).
- The user row is locked during the write and the assignment re-read under the lock, so two simultaneous changes
  cannot leave a stale group membership.

Answer 200 with the assignment (same shape as `POST`). Audited as `identity_access/assignment_updated`.

`PATCH /identity/users/{id}/role` also changes a role, keyed by user and `schoolId`: it changes the role only
(and creates the assignment if missing, also when the previous one was removed), never touches the group or
`group_members`, and does not yet check the target user's level or a deactivated school. Prefer
`PATCH /assignments/{id}` to edit an existing assignment.

### Remove an assignment: `DELETE /assignments/{id}` (#49)

Ends the link between the user and the school, group and role of the assignment. Answer **204** (no body).

- **Soft delete**: the row is kept with `deleted_at` set, and `updated_at` set to the same instant (migration
  `8_user_assignments_soft_delete`). A future mobile sync reading `updated_at > lastSync` *without* the active filter
  gets the row with its `deletedAt` and drops that access on the device (Section 4.7). Nothing is written to
  `sync_changes` yet.
- **Every reader ignores removed rows** through `ACTIVE_ASSIGNMENT` (`src/auth/utils/active-assignment.util.ts`,
  `{ deletedAt: null }`; raw SQL uses `deleted_at IS NULL`): the per-request user loading (`AuthUserService`, so
  the guards and school scoping), admin/Google login, refresh, password setup, user list/detail/edit, sessions admin,
  the assignment routes, `PATCH /identity/users/{id}/role`, role counts and deletion, the permission overview, the
  dashboard overview, the seed and the dev fixtures. The access is therefore gone on the user's **very next
  request**, with the same token. Any new query on `user_assignments` must use it.
- Same checks as `PATCH`: another school, a role above the admin's level (a school admin cannot remove a platform
  role), or a user who already holds a higher-level role → 403; deactivated school → 400; unknown or **already
  removed** assignment → 404 (a repeat is not audited again); invalid UUID → 400.
- **Last school admin → 409**. A school admin is an active assignment in that school whose role is
  school-scoped and grants `users:assign_role` (today `SCHOOL_ADMIN`; a custom admin role counts too; platform roles
  do not). Only admins whose user is not `SUSPENDED` count (an `INVITED` one can still activate). Removing a
  suspended admin is always allowed, since it takes no working admin away.
- **Concurrency**: the school row, then the user row, is locked (`SELECT … FOR UPDATE`) and the assignment
  re-read under the locks, so two simultaneous removals of the last two admins give one 204 and one 409.
- **Group members**: the user leaves the members of every group of that school (the assignment was their only
  source, see `PATCH`), unless another active assignment in that school remains.
- A removed assignment does not block a new `POST /assignments` in the same school: it creates a new row.

Audited as `identity_access/assignment_removed`.

### Assignable roles: `GET /assignments/assignable-roles` (#47)

The roles the current admin may assign, as `{ id, name, scope, level }`, highest level first. A school admin
gets school and group roles, a platform admin every role. With `?schoolId=`, only the admin's roles in that school
(and platform roles) count; a school outside their scope → 403.

## Documents

### Publish a document: `POST /documents/{id}/access` (#109, `documents:manage`)

`src/documents/services/document-access.service.ts`, under the **Documents** tag in Swagger.
A document is visible to the targets it is published to, always inside its own school:

| `type` | `id` | Who sees the document |
|---|---|---|
| `school` | the document's school | everyone with a role in the school |
| `role` | a school role (STAFF, STUDENT...) | everyone holding that role **in this school**; platform roles are refused |
| `class` | a group of type `class` | its members (`group_members`) and users assigned to it (`user_assignments.group_id`) |
| `group` | any other group (department, team) | its members; a class sent as `group` is stored as `class` |
| `user` | a user with a role in the school | that person only, e.g. a parent or guest shared explicitly |

Body: `{ "rules": [{ "type": "class", "id": "<groupId>" }] }` (1 to 50 rules). A target outside the document's
school, a deleted group or an unknown id → 400 and nothing is written. Targets the document already has are
skipped, so the call can be repeated. The answer (201) and `GET /documents/{id}/access` list every rule with
`type`, `targetId` and a readable `targetName`. Platform admins publish any document; school admins and
content managers only documents of their schools (403 otherwise). Each call that adds a target records
`document_published`.

**A document without any rule is a draft:** only the platform admins and the document managers of its school
(`documents:manage`) open it. Everyone else gets 403 on `GET /documents/{id}`, `/download` and `/stream` until it
is published to them. Someone whose assignment in the school is removed loses access, even through a `user` rule.

**For retrieval and lists:** `visibleDocumentsWhere(actor)` in `src/documents/utils/document-visibility.util.ts`
is the one Prisma filter for "documents this user may see" (`undefined` = everything). The document lists (#111)
and the chat retrieval step must apply it, combined under `AND`, before using a document; there are no chunks
yet, so each rule also stores the document's `school_id` to make that filter cheap.
`GET /documents` applies it too (#111, below). After pulling, run `npx prisma generate` and
`npm run db:migrate` (migration `10_document_access_targets`).

### List the documents you may see: `GET /documents` (#111, `documents:read`)

| Caller | Gets |
|---|---|
| Platform admin | every document, any status |
| School admin, content manager, staff with `documents:manage` | every document of their schools, any status (drafts included) |
| Staff, students, parents | documents published to them (school, role, class, group or user rule) that have an `available` version |

Deleted documents are never listed. Each item carries its `currentVersion` (`versionNo`, `status`, `mimeType`...), and so
does `GET /documents/{id}`.

| Query | Effect |
|---|---|
| `spaceId` | one space |
| `q` | title contains the text, ignoring case (1-200 characters) |
| `tags=math,exam` | carries **all** these tags, as whole tags (`math` does not match `mathematics`), up to 10; `tags` may be repeated (`tags=math&tags=exam`) |
| `status` | status of the current version: `pending`, `ocr`, `segmentation`, `indexing`, `available`, `error` (spec §3.1) |
| `type` | file type of the current version: `pdf`, `image`, `word`, `presentation`, `spreadsheet`, `text` |
| `page`, `limit` | the shared pagination contract (`limit` 1-100), newest first |

Filters combine with AND and with the caller's scope; an invalid value → 400.

`status` and `type` look at the current version only where the caller manages documents. Elsewhere the caller only
sees available versions, so `status` other than `available` matches nothing there, and `type` matches a document
when one of its available versions has that type (a replacement still in processing does not count).

- **Processing:** readers never see a document still in processing. They see it once **any** version is `available`, so
  replacing a file does not hide the document while the new version is processed. The same rule applies to
  `GET /documents/{id}`, `/download` and `/stream`. Uploads create versions as `pending`; the processing pipeline
  (or the dev route of #112) moves them to `available`.
- **Current version:** `documents.current_version_id` (migration `11_documents_current_version`) points to the latest
  version; upload and replace set it. Status and type filters read it.
- **Tags** are stored cleaned: trimmed, no empty tags, each once (`"Math , physics,,"` → `"Math,physics"`), on create,
  update and upload. The migration cleans existing rows.

After pulling, run `npx prisma generate` and `npm run db:migrate`.

### Processing status (#112)

Each version has a `status` (database enum since migration `12_document_version_status`), a `status_error`
(why it failed) and a `status_changed_at`. Uploads start at `pending`.

```
pending ──► ocr ──► segmentation ──► indexing ──► available
   └────────────────►┘                               (final: a new file is a new version)
any step before available ──► error (reason required) ──► pending (process again)
```

- **One entry point:** the pipeline changes a status only through `DocumentProcessingStatusService.setStatus(versionId,
  status, reason?)` (exported by `DocumentsModule`). Another order → 409, `error` without a reason → 400, the same
  status again → nothing changes.
- **Processing jobs:** each change is mirrored on the version's latest processing job: `step`, then `in_progress`,
  `completed` or `failed`, with the `error` and `duration_ms`. `duration_ms` counts from `started_at`, the start of the
  current run: processing a failed version again (`error` → `pending`) starts a new run.
- **First available version:** the document's readers get an `insert` sync change, since that's when they can see it.
  Rule changes (#109, #110) on a document with no available version write no sync changes.
- **`GET /documents/{id}/status`** (`documents:manage`): the current version's `status`, `statusError` and
  `statusChangedAt`, plus its processing jobs (`steps`). Poll it to follow processing. The `currentVersion` of
  `GET /documents` carries the same fields for managers.
- **Readers** (staff, students and parents who do not manage documents) never see processing states:
  - Their `currentVersion` (in `GET /documents` and `GET /documents/{id}`) and "latest" download or stream are the
    **newest available** version, never a version still in processing.
  - They never get `statusError`.
  - Before any version is available, the document is invisible to them (403).
- **The worker is still a stub:** it queues the job and leaves the version `pending`. Until the real OCR,
  segmentation and indexing steps exist, simulate them with the dev-only route
  `POST /documents/dev/versions/{versionId}/status` `{ "status": "segmentation" }` (or `{ "status": "error",
  "reason": "..." }`). It needs `documents:manage` in the version's school and, like `/auth/dev`, is hidden
  (404) unless `AUTH_DEV_TOOLS=true` and not in production. It applies exactly the same rules.

After pulling, run `npx prisma generate` and `npm run db:migrate`. Any old status outside the list (such as
`uploaded`) becomes `pending`.

### Change or remove access rules (#110, `documents:manage`)

| Endpoint | Answer |
|---|---|
| `PUT /documents/{id}/access` `{ "rules": [...] }` | 200 with the new rules. Targets not listed are removed, new ones added, the others kept; `[]` makes the document a draft again |
| `DELETE /documents/{id}/access/{ruleId}` | 204. A rule of another document → 404 |

Same permissions and target checks as `POST`. Both record `document_access_changed` (targets `added` and
`removed`), unless nothing changed. Changes to one document's rules run one at a time (its row is locked), also
`POST`.

**How a change reaches the readers:**
- **Server:** visibility is computed from the rules on every request, so a reader who lost the document gets 403
  on their very next request. Retrieval will use the same filter, so it needs nothing more. There is no server cache.
- **Downloads:** they are sent with `Cache-Control: private, no-cache` (was `max-age=3600`). A browser or the app
  must ask again before reusing a file, and a reader who lost access gets 403 instead of an old copy.
- **Mobile sync:** every change compares who could see the document before and after. Document managers are left
  out, because they see it whatever the rules. One `sync_changes` row is written per reader:

| `entity_type` | `entity_id` | `operation` | Meaning for the app at its next sync |
|---|---|---|---|
| `document` | the document | `delete` | the reader lost it: remove it and its files from the offline data |
| `document` | the document | `insert` | the reader gained it: it may now be listed and downloaded |

  The `offline_selections` rows of the lost document are deleted for the devices of those readers. The sync
  endpoint itself (`POST /sync`) is still a stub; whoever builds it reads these rows.
  A `school` rule reaches every user of the school, so publishing to or unpublishing from a whole school writes
  one row per user.

## Document spaces

`src/documents/controllers/documents.controller.ts`, under the **Documents** tag in Swagger (Section 4.1).
A space is a folder-like area of one school that groups related documents.

Who can create and edit spaces: platform admins in every school, school admins in their school(s), and
staff with document-management rights (`documents:manage`, #88) in the school(s) where they hold them.
Other staff, students and guests get 403. The routes ask for `spaces:create` / `spaces:update`, which
`documents:manage` also covers.

| Field | Rules |
|---|---|
| `name` | Required on create. Trimmed, 1 to 100 characters, unique within the school (409) |
| `description` | Optional, trimmed, up to 2000 characters. On update, `null` or `""` clears it |
| `language` | `en` (default) or `fr`; trimmed and lower-cased first, so `EN` and ` Fr ` are accepted and stored as `en` / `fr` |
| `privacy` | `public` (default), `restricted` or `private`. Stored and validated only; no read rule uses it yet |

### Create a space: `POST /documents/spaces` (#97, `spaces:create`)

Body: `schoolId` (UUID, **always required**: the API no longer picks or creates a school), `name`, and
optionally `description`, `language`, `privacy`. Invalid data → 400, a school outside the caller's
scope → 403, unknown school → 404 (platform admins; scoped users get 403), name already used in the
school → 409 `A space named '<name>' already exists in this school`. Audited as `documents/space_created`.

### Update a space: `PATCH /documents/spaces/{id}` (#97, `spaces:update`)

Body: any of `name`, `description`, `language`, `privacy`; fields left out are unchanged. **The school of
a space cannot change**: `schoolId` in the body is a 400, like any unknown field. Invalid UUID or empty
body → 400, another school's space → 403, unknown space → 404, name used by another space of the
school → 409. Audited as `documents/space_updated` with the previous and new value of each changed
field; a request that changes nothing returns 200 without a write or an audit event.

### Unique names

A unique index on `spaces (school_id, name)` (migration `14_spaces_unique_name`) backs the 409, so two
simultaneous requests cannot both succeed; MySQL compares names ignoring case. **`npm run db:migrate`
fails if a school already has two spaces with the same name**: rename them first, for example after
listing them with:

```sql
SELECT school_id, name, COUNT(*) FROM spaces GROUP BY school_id, name HAVING COUNT(*) > 1;
```

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
| `identity_access` | `role_assigned` | A user's role in a school is created or replaced (`POST /assignments`, `PATCH /identity/users/{id}/role`) | the assigning admin | `user` | `email`, `schoolId`, `groupId` (`POST /assignments` only), `role`, `previousRole` |
| `identity_access` | `role_updated` | A custom role is edited (`PATCH /roles/{id}`, #45); not recorded when nothing changes | the platform admin | `role` | `role`, `previousName`, `previousScope`, `scope`, `permissions`, `addedPermissions`, `removedPermissions` |
| `identity_access` | `role_deleted` | An unused custom role is deleted (`DELETE /roles/{id}`, #46) | the platform admin | `role` | `role`, `scope`, `documentAccessRulesRemoved`, `assignmentRecordsRemoved` |
| `identity_access` | `assignment_updated` | The role and/or group of an assignment changes (`PATCH /assignments/{id}`); not recorded when nothing changes | the admin | `user` | `assignmentId`, `email`, `schoolId`, `role`, `previousRole`, `groupId`, `previousGroupId` |
| `identity_access` | `assignment_removed` | An assignment is removed (`DELETE /assignments/{id}`, soft delete) | the admin | `user` | `assignmentId`, `email`, `schoolId`, `role`, `groupId` |
| `documents` | `document_published` | A document is published to new targets (`POST /documents/{id}/access`); not recorded when every target was already there | the admin or content manager | `document` | `spaceId`, `schoolId`, `rules` (the `type` and `targetId` of each target added) |
| `documents` | `document_access_changed` | The rules of a document are replaced (`PUT /documents/{id}/access`) or one is removed (`DELETE /documents/{id}/access/{ruleId}`); not recorded when nothing changed | the admin or content manager | `document` | `spaceId`, `schoolId`, `added` and `removed` (the `type` and `targetId` of each target) |
| `documents` | `space_created` | A space is created (`POST /documents/spaces`) | the creator | `space` | `schoolId`, `name`, `language`, `privacy` |
| `documents` | `space_updated` | A space is edited (`PATCH /documents/spaces/{id}`); not recorded when nothing changes | the editor | `space` | `schoolId`, `changes` (`{ field: { from, to } }` for `name`, `description`, `language`, `privacy`) |
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

## Conversations (#123)

Requires `conversations:read`. Every user (including platform and school admins) only reads **their own** conversations here; monitoring uses dedicated routes. Soft-deleted conversations and soft-deleted messages are never returned, and requesting another user's conversation returns `404`.

- `GET /conversations`: paginated (`page`, `limit` capped at `100`), ordered newest first (`updatedAt DESC, createdAt DESC, id DESC`). Optional filters: `spaceId` (UUID) and `q` (title search, trimmed).
- `GET /conversations/:id`: returns the conversation with chronological messages (`createdAt ASC`), each in the format of the chat contract below.
- `GET /conversations/:id/messages`: returns the chronological messages and citations for the conversation.
- `GET /conversations/:id/messages/:messageId/status` (`conversations:read`, #122): polling endpoint returning `{ messageId, conversationId, status, ready, modelUsed, errorCode, updatedAt, answer }` where `status` is `pending | generating | done | failed` and `answer` is populated once `done`.
- `PATCH /conversations/:id` (`conversations:update`, #124): renames a conversation owned by the caller (`title` trimmed, 1–191 characters).
- `DELETE /conversations/:id` (`conversations:delete`, #124): soft-deletes a conversation owned by the caller (`204 No Content`), hiding it from their history.
- `POST /conversations/saved-answers` & `GET /conversations/saved-answers` & `DELETE /conversations/saved-answers/:id` (#125): bookmark, list (newest first, paginated), and unbookmark completed assistant answers (`answers:save` / `conversations:read`).
- `POST /conversations/:id/messages/:messageId/share` & `GET /conversations/shared/:token` (#125): generate a signed share link/text and resolve it for a receiver, stripping any citations whose source documents are not visible to the receiver (`redactedCitationsCount`).
- `POST /conversations/reports` (`answers:report`, #125) & `GET /conversations/reports` (`metrics:view`, #125): report an assistant answer (`hallucination`, `toxic`, `incorrect_citation`, `irrelevant`, `incomplete`, `other`) and list reports scoped to the admin's school(s) (or all schools for platform admins).

### Chat contract (#119)

The format shared by the mobile app, the portal and the chat backend (spec §4.2, §4.3). It is fixed in Swagger
(`AskQuestionDto`, `MessageEntity`, `MessageCitationEntity`, `CitationZoneEntity`) and checked by
`test/conversations-ask.e2e-spec.ts`; change it only with the mobile and web developers.

**Asking: `POST /conversations/{id}/messages`** (`messages:send`). The conversation is `{id}`; the body is:

| Field | Rules |
|---|---|
| `question` | Required, trimmed, 1 to 4000 characters |
| `spaceIds` | Optional, up to 10 different space UUIDs to search; left out: the conversation's space. Spaces the caller may not see never contribute |

Any other field (`role`, `content`, `modelUsed`, `parameters`...) is a **400**: the client never chooses the role or
the model. Someone else's conversation, or a deleted one, is a **404**. The answer is `201` with the **pending answer**;
poll `GET /conversations/{id}/messages/{messageId}/status` with its `id` until `status` is `done` or `failed`.
Storing the question and generating the answer are #120 and #121: until then the pending answer is not stored.

**A message (question or answer)**, as returned by every chat route:

| Field | Meaning |
|---|---|
| `role` | `user` (question) or `assistant` (answer) |
| `content` | The question, or the answer text with citation markers `[1]`, `[2]`... (empty while pending) |
| `status` | `pending`, `generating`, `done` or `failed`; questions are `done`. Older stored values (`completed`) are given as `done`; a missing or unknown one as `pending`, on every route |
| `notEnoughEvidence` | `true` when the documents do not contain the answer: `citations` is empty and `content` says so |
| `citations` | The sources, ordered by `marker`; empty for questions |
| `modelUsed`, `createdAt` | The model that answered and when |

A "not enough evidence" answer never shows or counts citations, shared answers included (`redactedCitationsCount` is 0).

**A citation:** `marker` (the `n` of `[n]` in the text), `documentId`, `versionId`, `documentName`, `versionNumber`,
`pageOrImageId` (`page_<n>` or an image id), `excerpt`, `zone` and `available` (false once the document is deleted or
the cited version is no longer available; the citation stays so the answer keeps making sense).

`zone` is where the excerpt is on the page: `{ x, y, width, height }` as fractions of the page (0 to 1, from the
top-left corner), or `null` when unknown. It is stored as that JSON in `message_references.coordinates`; anything else
there (such as older pixel coordinates) is given as `null`, so a client never draws a zone it cannot place.

```json
{
  "id": "3f6c...", "conversationId": "9a1b...", "role": "assistant",
  "content": "Backpropagation applies the chain rule layer by layer [1], starting from the loss [2].",
  "modelUsed": "mock-rag-v1", "parameters": null, "status": "done", "notEnoughEvidence": false,
  "citations": [
    { "id": "c1...", "marker": 1, "documentId": "d1...", "versionId": "v1...", "documentName": "Neural Networks Lecture 4",
      "versionNumber": 2, "pageOrImageId": "page_14", "excerpt": "The chain rule applied to...",
      "zone": { "x": 0.1, "y": 0.42, "width": 0.8, "height": 0.12 }, "available": true },
    { "id": "c2...", "marker": 2, "documentId": "d2...", "versionId": "v2...", "documentName": "Course notes",
      "versionNumber": 1, "pageOrImageId": "page_3", "excerpt": "The loss function measures...",
      "zone": null, "available": true }
  ],
  "createdAt": "2026-11-21T10:00:05.000Z", "updatedAt": "2026-11-21T10:00:05.000Z"
}
```

A "not enough evidence" answer: `{ ..., "content": "The documents available to you do not contain this information.",
"status": "done", "notEnoughEvidence": true, "citations": [] }`.

**Storage** (migration `13_chat_answer_contract`): `messages.not_enough_evidence` (false by default) and
`message_references.marker` (unique per message). Existing references were numbered 1, 2, 3... per message in the
order they were listed so far. Whoever stores an answer (#121) writes the markers that its text uses.
