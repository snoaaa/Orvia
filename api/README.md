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
- `DATABASE_URL`: MySQL connection string (e.g. `mysql://user:password@localhost:3306/wamdp_db`)
- `PORT`: Server port (defaults to `3000` if omitted)
- `PLATFORM_ADMIN_EMAIL`: Email for the initial platform administrator
- `PLATFORM_ADMIN_PASSWORD`: Password for the initial administrator (hashed with bcrypt)
- `SWAGGER_PROTECTED`: Set to `true` to require basic auth for Swagger docs

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
