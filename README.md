# WAMDP - Advanced Web & Mobile Development Project

A comprehensive educational platform featuring a Retrieval-Augmented Generation (RAG) assistant, web management portal, and mobile application with offline-first synchronization.

## Architecture Components

1. **`api/`** - NestJS Backend API with MySQL 8 & Prisma ORM
2. **`web/`** - Angular Single Page Application
3. **`mobile/`** - React Native + Expo Mobile Application

---

## Getting Started

### 1. Backend (`api/`)

The backend is built with **NestJS**, **MySQL 8**, and **Prisma ORM**.

#### Prerequisites
- Node.js (v20+ recommended)
- MySQL 8.x running locally or via Docker

#### Setup & Run
```bash
cd api

# Install dependencies
npm install

# Configure environment variables
# Copy .env.example to .env and adjust your MySQL connection credentials
cp .env.example .env

# Generate Prisma Client
npx prisma generate

# Run in development watch mode
npm run start:dev
```

- **API Base URL**: `http://localhost:3000`
- **Health Check & DB Status**: `http://localhost:3000/health`
- **Swagger API Documentation**: `http://localhost:3000/api/docs`

---

### 2. Web Application (`web/`)

```bash
cd web
npm install
npm run start
```

---

### 3. Mobile Application (`mobile/`)

```bash
cd mobile
npm install
npm run start
```
