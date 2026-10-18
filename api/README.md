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
- `DATABASE_URL`: MySQL connection string (e.g. `mysql://user:password@localhost:3306/wamdp_db`)
- `PORT`: Server port (defaults to `3000` if omitted)
- `PLATFORM_ADMIN_EMAIL`: Email for the initial platform administrator
- `PLATFORM_ADMIN_PASSWORD`: Password for the initial administrator (hashed with bcrypt)
- `SWAGGER_PROTECTED`: Set to `true` to require basic auth for Swagger docs
- `JWT_ACCESS_SECRET`: Secret signing access tokens (required in production; a dev-only fallback is used otherwise)
- `JWT_ACCESS_TTL_SECONDS`: Access token lifetime (default `900`)
- `AUTH_DEV_TOOLS`: Set to `true` to enable the dev-only `/auth/dev/*` routes (never in production)

### 3. Database Setup & Seeding

```bash
# Push schema models and indexes to MySQL
npx prisma db push

# Seed 6 base roles, 42 permissions, role mappings, and the first administrator
npm run seed
```

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
with `JWT_ACCESS_SECRET`. Login (#8, #10) and refresh (#12) must issue tokens through it. Nothing but
the user id is trusted from the token.

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

- `POST /auth/dev/token` `{ "email": "..." }` → an access token for any existing user, no password
- `POST /auth/dev/fixtures` → creates *Demo School A/B* with users `admin.a@demo.test` (SCHOOL_ADMIN),
  `student.a@demo.test`, `suspended.a@demo.test` (SUSPENDED), `invited.a@demo.test` (INVITED),
  `admin.b@demo.test`, `student.b@demo.test`

