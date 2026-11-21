# Orvia Mobile Application

Cross-platform React Native (Expo) mobile application for **Orvia (WAMDP)** — an educational RAG knowledge assistant for staff, students, and guests with offline-first local storage and permission-adapted navigation.

## Quick Start

1. **Install dependencies**

   ```bash
   cd mobile
   npm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Set `EXPO_PUBLIC_API_URL` to your Orvia API address (defaults to your Metro host IP on port `8084`, or `http://localhost:8084`).
   For local dev testing with `AUTH_DEV_TOOLS=true` on the API, you may optionally set `EXPO_PUBLIC_DEV_EMAIL=student.a@demo.test`.

3. **Run on Android, iOS, or Web**

   ```bash
   npm run start      # Start Expo dev server
   npm run android    # Build and run on Android
   npm run web        # Run web target
   npm run lint       # Run ESLint
   npm run typecheck  # Run TypeScript check (tsc --noEmit)
   ```

---

## Architecture (MVVM + Component-Oriented)

The mobile client follows the **MVVM (Model-View-ViewModel)** pattern combined with a **component-oriented UI architecture** (specs §5.1, §6, §10):

```text
mobile/src/
├── app/               # Thin Expo Router entry files (routing only, delegates to views/)
├── views/             # Pure UI screens bound to ViewModels (no direct HTTP or SQLite calls)
├── view-models/       # Stateful hooks & session context coordinating Models and Services
├── models/            # Domain entities, DTO types, and preference interfaces
├── services/          # External I/O layer:
│   ├── api/           #   HTTP client with env base URL, Bearer token & ApiError handling
│   ├── storage/       #   SQLite (expo-sqlite) local database + migrations + web adapter
│   ├── auth-service.ts
│   ├── chat-service.ts
│   └── space-service.ts
├── components/        # Reusable, composable UI building blocks (chat/, markdown/, PermissionGate, etc.)
├── i18n/              # Internationalization (French `fr` primary, English `en` supported)
├── theme/             # Light / Dark / System theme management synced with Uniwind & SQLite
├── utils/             # Permission helpers (`permissions.ts`) and styling utilities
└── config/            # Environment resolution (`env.ts`) and module feature flags (`features.ts`)
```

### Layer Responsibilities

1. **Models (`src/models/`)**
   - Define immutable TypeScript contracts matching the Orvia NestJS backend (`AuthenticatedUser`, `Space`, `DocumentItem`, `ChatMessage`, `MessageCitation`, `ConversationSummary`, `AppPreferences`).
2. **Services (`src/services/`)**
   - **API Client (`src/services/api/api-client.ts`)**: Reads `EXPO_PUBLIC_API_URL` (with Metro host auto-detection fallback), attaches `Authorization: Bearer <token>`, normalizes errors into `ApiError`, and provides `401` hooks for session refresh/sign-out.
   - **Local Storage (`src/services/storage/database.ts`)**: Uses `expo-sqlite` (`orvia.db`) with versioned migrations (`schema_migrations`, `app_preferences`, `spaces`, `conversations`, `messages`, `documents`, `sync_queue`) plus a web-compatible `database.web.ts` adapter.
   - **Domain Services (`auth-service.ts`, `space-service.ts`, `chat-service.ts`)**: Wrap API calls and synchronize local SQLite caches.
3. **ViewModels (`src/view-models/`)**
   - `AppSessionProvider` / `useAppSession`: Initializes SQLite, bootstraps session state, exposes active roles and permission predicates.
   - `useChatViewModel`, `useSpacesViewModel`, `useChatsViewModel`, `useSettingsViewModel`: Encapsulate screen state, async polling (`#122`), error recovery, and persistence without leaking I/O logic into Views.
4. **Views (`src/views/`) & Routes (`src/app/`)**
   - `src/app/*` defines Expo Router screens (`index`, `spaces`, `chats`, `import`, `attachments`, `(settings)/settings`, `(settings)/profile`).
   - `src/views/*` renders UI declaratively from ViewModel state and localized strings.
5. **Components (`src/components/`)**
   - Component-oriented UI primitives (`chat/`, `markdown/`, `PermissionGate`, `DrawerContent`, `MainHeader`).

---

## Key Cross-Cutting Capabilities

- **Internationalization (`src/i18n/`)**: French (`fr`) is configured as the primary language (§6) with runtime switching to English (`en`), persisted in SQLite (`app_preferences`).
- **Theming (`src/theme/`)**: Supports `system`, `light`, and `dark` themes via Uniwind CSS tokens (`src/global.css`) and React Navigation themes, persisted in SQLite.
- **Role & Permission Adaptation (`src/utils/permissions.ts`, `src/components/permission-gate.tsx`)**: Screens and actions (such as document import via `documents:manage`) adapt dynamically to the authenticated user's roles and permissions (`STAFF`, `STUDENT`, `PARENT_GUEST`, `CONTENT_MANAGER`, etc.).
