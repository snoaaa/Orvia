<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

# WAMDP Backend API

> Advanced Web & Mobile Development Project - Modular NestJS REST API with MySQL 8 & Prisma ORM.

---

## Table of Contents
- [Overview](#overview)
- [Architecture & Domain Structure](#architecture--domain-structure)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Database Configuration](#database-configuration)
- [Running the Application](#running-the-application)
- [API Documentation (Swagger)](#api-documentation-swagger)
- [Testing & Quality](#testing--quality)
- [Health Check & Verification](#health-check--verification)

---

## Overview

The backend service is structured following Domain-Driven principles and aligned with the system's class diagram (`docs/RAGBackend.pdf`). It connects directly to **MySQL 8** using **Prisma** as the Object-Relational Mapper (ORM), with end-to-end type safety, validation pipelines, and automated OpenAPI (Swagger) documentation.

---

## Architecture & Domain Structure

```
api/
├── prisma/
│   └── schema.prisma             # MySQL database schema & Prisma models
├── src/
│   ├── config/                   # Configuration factories & options
│   │   ├── swagger/              # OpenAPI / Swagger configuration & setup
│   │   ├── app.config.ts         # Server configuration
│   │   └── database.config.ts    # Database URL & connection configuration
│   ├── database/                 # Database connection & lifecycle
│   │   ├── prisma.service.ts     # Prisma client with connection check & graceful shutdown
│   │   └── prisma.module.ts      # Global Prisma database module
│   ├── identity-and-access/      # Identity, Users, Schools, Roles, Sessions
│   │   ├── dto/                  # Request / Response DTOs with class-validator
│   │   ├── entities/             # Domain entities (User, School, Role, Group, Session)
│   │   ├── mappers/              # DB to Domain entity & DTO mappers
│   │   ├── services/             # Identity & Access business logic
│   │   └── controllers/          # HTTP routes (/identity)
│   ├── documents/                # Spaces, Documents, Versions, Processing Jobs
│   │   ├── dto/
│   │   ├── entities/             # Document, Space, DocumentVersion, ProcessingJob
│   │   ├── mappers/
│   │   ├── services/
│   │   └── controllers/          # HTTP routes (/documents)
│   ├── conversations/            # Chat threads, Messages, Citations, Reports
│   │   ├── dto/
│   │   ├── entities/             # Conversation, Message, Reference, SavedAnswer, Report
│   │   ├── mappers/
│   │   ├── services/
│   │   └── controllers/          # HTTP routes (/conversations)
│   ├── rag-performance/          # RAG Latency, Token costs, Citation telemetry
│   │   ├── dto/
│   │   ├── entities/             # RagRequestMetric
│   │   ├── mappers/
│   │   ├── services/
│   │   └── controllers/          # HTTP routes (/rag-performance)
│   ├── mobile-sync/              # Mobile Devices, Offline Caching, Sync Changes
│   │   ├── dto/
│   │   ├── entities/             # Device, OfflineSelection, PendingQuestion, SyncChange
│   │   ├── mappers/
│   │   ├── services/
│   │   └── controllers/          # HTTP routes (/mobile-sync)
│   ├── audit/                    # Append-only SHA-256 hashed audit events
│   │   ├── dto/
│   │   ├── entities/             # AuditEvent
│   │   ├── mappers/
│   │   ├── services/
│   │   └── controllers/          # HTTP routes (/audit)
│   ├── app.controller.ts         # Root info & /health check
│   ├── app.service.ts            # Health status & database ping
│   ├── app.module.ts             # Root application module wiring
│   └── main.ts                   # Application bootstrap with Swagger & validation
└── test/                         # E2E test suites
```

---

## Prerequisites

- **Node.js**: v20 or v22+ recommended (v24 compatible)
- **MySQL**: 8.0+ running on `localhost:3306`

---

## Installation & Setup

```bash
# Navigate to the backend directory
cd api

# Install all dependencies
npm install
```

---

## Database Configuration

Copy the example environment file and configure your MySQL connection:

```bash
cp .env.example .env
```

Edit `.env`:
```env
# Server Configuration
PORT=3000

# Database Configuration (MySQL 8)
DATABASE_URL="mysql://<user>:<password>@localhost:3306/<database_name>"
```

Generate the Prisma Client:
```bash
npx prisma generate
```

To introspect an existing database schema at any time:
```bash
npx prisma db pull
```

---

## Running the Application

```bash
# Development (with hot reload)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

---

## API Documentation (Swagger)

When the server is running, the interactive Swagger OpenAPI UI is accessible at:

👉 **`http://localhost:3000/api/docs`**  
OpenAPI JSON spec: **`http://localhost:3000/api/docs-json`**

### Features:
- **Bearer JWT Authentication**: Configured with the `bearer-jwt` security scheme so protected endpoints can be tested directly with a JWT access token.
- **Automatic Documentation**: Automated schema extraction using the `@nestjs/swagger` compiler plugin in `nest-cli.json` with class-validator shim.
- **Interactive Route Testing**: Test all domain routes (`/identity`, `/documents`, `/conversations`, `/rag-performance`, `/mobile-sync`, `/audit`, `/health`).
- **Endpoint Protection & Production Security**:
  - `SWAGGER_ENABLED=false`: Completely disables Swagger in production (returns `404 Not Found`).
  - `SWAGGER_PROTECTED=true`: Enforces timing-safe HTTP Basic Authentication on `/api/docs*` and `/api/docs-json` using `SWAGGER_USER` and `SWAGGER_PASSWORD`.

---

## Testing & Quality

```bash
# Run unit tests
npm run test

# Run end-to-end tests (verifies MySQL database connectivity)
npm run test:e2e

# Run linter
npm run lint

# Format code
npm run format
```

---

## Health Check & Verification

You can verify server and MySQL database connectivity by querying:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-10-17T12:00:00.000Z",
  "database": {
    "status": "ok",
    "message": "Database connection to MySQL 8 is healthy.",
    "timestamp": "2026-10-17T12:00:00.000Z"
  }
}
```
