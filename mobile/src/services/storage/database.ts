import * as SQLite from "expo-sqlite";
import type { ChatMessage, ConversationSummary, MessageCitation } from "@/models/chat";
import type { Space } from "@/models/space";
import type { LocalStorageAdapter, StorageStats } from "./types";

const DB_NAME = "orvia.db";
const LATEST_SCHEMA_VERSION = 1;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initialized = false;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const row = await db.getFirstAsync<{ version: number }>(
    "SELECT MAX(version) as version FROM schema_migrations",
  );
  const currentVersion = row?.version ?? 0;

  if (currentVersion < 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS app_preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        language TEXT,
        school_id TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        space_id TEXT NOT NULL,
        space_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        model_used TEXT,
        not_enough_evidence INTEGER NOT NULL DEFAULT 0,
        citations_json TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
        ON messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT,
        current_version INTEGER,
        is_offline INTEGER NOT NULL DEFAULT 0,
        local_uri TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      );
    `);

    await db.runAsync(
      "INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      1,
      new Date().toISOString(),
    );
  }
}

async function ensureReady(): Promise<SQLite.SQLiteDatabase> {
  const db = await getDb();
  if (!initialized) {
    await runMigrations(db);
    initialized = true;
  }
  return db;
}

export const localStorage: LocalStorageAdapter = {
  async init(): Promise<void> {
    await ensureReady();
  },

  async getPreference(key: string): Promise<string | null> {
    const db = await ensureReady();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_preferences WHERE key = ?",
      key,
    );
    return row?.value ?? null;
  },

  async setPreference(key: string, value: string | null): Promise<void> {
    const db = await ensureReady();
    if (value === null) {
      await db.runAsync("DELETE FROM app_preferences WHERE key = ?", key);
    } else {
      await db.runAsync(
        "INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)",
        key,
        value,
      );
    }
  },

  async getCachedSpaces(): Promise<Space[]> {
    const db = await ensureReady();
    const rows = await db.getAllAsync<{
      id: string;
      name: string;
      description: string | null;
      language: string | null;
      school_id: string | null;
      updated_at: string;
    }>("SELECT id, name, description, language, school_id, updated_at FROM spaces ORDER BY name ASC");

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      language: r.language,
      schoolId: r.school_id ?? undefined,
      updatedAt: r.updated_at,
    }));
  },

  async saveCachedSpaces(spaces: Space[]): Promise<void> {
    const db = await ensureReady();
    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM spaces");
      for (const s of spaces) {
        await db.runAsync(
          "INSERT OR REPLACE INTO spaces (id, name, description, language, school_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          s.id,
          s.name,
          s.description ?? null,
          s.language ?? null,
          s.schoolId ?? null,
          s.updatedAt ?? now,
        );
      }
    });
  },

  async getCachedConversations(): Promise<ConversationSummary[]> {
    const db = await ensureReady();
    const rows = await db.getAllAsync<{
      id: string;
      title: string;
      space_id: string;
      space_name: string | null;
      created_at: string;
      updated_at: string;
    }>(
      "SELECT id, title, space_id, space_name, created_at, updated_at FROM conversations ORDER BY updated_at DESC",
    );

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      spaceId: r.space_id,
      spaceName: r.space_name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  async saveCachedConversations(conversations: ConversationSummary[]): Promise<void> {
    const db = await ensureReady();
    await db.withTransactionAsync(async () => {
      for (const c of conversations) {
        await db.runAsync(
          "INSERT OR REPLACE INTO conversations (id, title, space_id, space_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          c.id,
          c.title,
          c.spaceId,
          c.spaceName ?? null,
          c.createdAt,
          c.updatedAt,
        );
      }
    });
  },

  async getCachedMessages(conversationId: string): Promise<ChatMessage[]> {
    const db = await ensureReady();
    const rows = await db.getAllAsync<{
      id: string;
      conversation_id: string;
      role: "user" | "assistant";
      content: string;
      status: ChatMessage["status"];
      model_used: string | null;
      not_enough_evidence: number;
      citations_json: string | null;
      error_message: string | null;
      created_at: string;
    }>(
      "SELECT id, conversation_id, role, content, status, model_used, not_enough_evidence, citations_json, error_message, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
      conversationId,
    );

    return rows.map((r) => {
      let citations: MessageCitation[] = [];
      if (r.citations_json) {
        try {
          // Citations cached before the #119 contract have no marker or zone.
          citations = (JSON.parse(r.citations_json) as Partial<MessageCitation>[]).map((c, i) => ({
            ...(c as MessageCitation),
            marker: c.marker ?? i + 1,
            zone: c.zone ?? null,
          }));
        } catch {
          citations = [];
        }
      }
      return {
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role,
        content: r.content,
        status: r.status ?? "done",
        modelUsed: r.model_used ?? undefined,
        notEnoughEvidence: r.not_enough_evidence === 1,
        citations,
        errorMessage: r.error_message ?? undefined,
        createdAt: r.created_at,
      };
    });
  },

  async saveCachedMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
    const db = await ensureReady();
    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM messages WHERE conversation_id = ?", conversationId);
      for (const m of messages) {
        await db.runAsync(
          `INSERT OR REPLACE INTO messages (
            id, conversation_id, role, content, status, model_used,
            not_enough_evidence, citations_json, error_message, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          m.id,
          conversationId,
          m.role,
          m.content,
          m.status ?? "done",
          m.modelUsed ?? null,
          m.notEnoughEvidence ? 1 : 0,
          m.citations ? JSON.stringify(m.citations) : null,
          m.errorMessage ?? null,
          m.createdAt ?? now,
        );
      }
    });
  },

  async clearOfflineData(): Promise<void> {
    const db = await ensureReady();
    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM messages");
      await db.runAsync("DELETE FROM conversations");
      await db.runAsync("DELETE FROM documents");
      await db.runAsync("DELETE FROM spaces");
      await db.runAsync("DELETE FROM sync_queue");
    });
  },

  async getStats(): Promise<StorageStats> {
    const db = await ensureReady();
    const spacesRow = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM spaces");
    const convRow = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM conversations");
    const msgRow = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM messages");
    const verRow = await db.getFirstAsync<{ version: number }>(
      "SELECT MAX(version) as version FROM schema_migrations",
    );

    return {
      engine: "sqlite",
      spacesCount: spacesRow?.count ?? 0,
      conversationsCount: convRow?.count ?? 0,
      messagesCount: msgRow?.count ?? 0,
      schemaVersion: verRow?.version ?? LATEST_SCHEMA_VERSION,
    };
  },
};
