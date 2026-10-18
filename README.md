# WAMDP (Web & Mobile Development Project)

Educational knowledge platform with RAG assistant, web administration portal, and offline-capable mobile application.

## Repository Structure

- `api/` – NestJS backend API with MySQL 8 & Prisma ORM
- `web/` – Angular web management client
- `mobile/` – React Native / Expo mobile application
- `docs/` – Technical documentation and system architecture diagrams

---

## Quick Start

### 1. Backend (`api/`)

Requires Node.js (v20+) and a running MySQL 8 database.

```bash
cd api
npm install

# Copy environment template and set your database connection
cp .env.example .env

# Generate Prisma client and apply schema
npx prisma generate
npx prisma db push

# Seed base roles, permissions, and initial platform administrator
npm run seed

# Start development server
npm run start:dev
```

- API server: `http://localhost:3000`
- Swagger documentation: `http://localhost:3000/api/docs`
- Database health check: `http://localhost:3000/health`

### 2. Web Client (`web/`)

```bash
cd web
npm install
npm run start
```

Runs on `http://localhost:4200`.

### 3. Mobile Client (`mobile/`)

```bash
cd mobile
npm install
npm run start
```

---

## Architecture & Subdomains

The backend is modularized according to the system specifications (`docs/RAGBackend.pdf`):

- **Identity & Access**: Multi-tenant institutions, users, role-based access control, session management
- **Documents**: Academic spaces, document versioning, chunk processing
- **Conversations**: RAG query sessions, message history, saved answers, citations
- **RAG Performance**: Latency, token metrics, cost tracking, citation validation
- **Mobile Sync**: Device registration, offline resource selection, delta synchronization
- **Audit**: Hash-chained, append-only audit event trail

---

## Branch Rules & Code Review Policy

This repository enforces branch protection and code ownership on `main`:
- **Designated Reviewers & Code Owners**: [@snoaaa](https://github.com/snoaaa) and [@N2K-keli](https://github.com/N2K-keli)
- Direct pushes to `main` are disabled. All merges require pull requests with code owner approval.
- Detailed contribution rules and checklist are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

