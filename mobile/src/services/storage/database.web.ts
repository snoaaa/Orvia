import type { ChatMessage, ConversationSummary } from "@/models/chat";
import type { Space } from "@/models/space";
import type { LocalStorageAdapter, StorageStats } from "./types";

const MEMORY_STORE = new Map<string, string>();

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw =
      typeof window !== "undefined" && window.localStorage
        ? window.localStorage.getItem(key)
        : MEMORY_STORE.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, serialized);
    } else {
      MEMORY_STORE.set(key, serialized);
    }
  } catch {
    MEMORY_STORE.set(key, serialized);
  }
}

const KEYS = {
  PREFS: "orvia_prefs",
  SPACES: "orvia_spaces",
  CONVERSATIONS: "orvia_conversations",
  MESSAGES_PREFIX: "orvia_messages_",
};

export const localStorage: LocalStorageAdapter = {
  async init(): Promise<void> {
    // Web storage requires no async initialization.
  },

  async getPreference(key: string): Promise<string | null> {
    const prefs = readJson<Record<string, string>>(KEYS.PREFS, {});
    return prefs[key] ?? null;
  },

  async setPreference(key: string, value: string | null): Promise<void> {
    const prefs = readJson<Record<string, string>>(KEYS.PREFS, {});
    if (value === null) {
      delete prefs[key];
    } else {
      prefs[key] = value;
    }
    writeJson(KEYS.PREFS, prefs);
  },

  async getCachedSpaces(): Promise<Space[]> {
    return readJson<Space[]>(KEYS.SPACES, []);
  },

  async saveCachedSpaces(spaces: Space[]): Promise<void> {
    writeJson(KEYS.SPACES, spaces);
  },

  async getCachedConversations(): Promise<ConversationSummary[]> {
    return readJson<ConversationSummary[]>(KEYS.CONVERSATIONS, []);
  },

  async saveCachedConversations(conversations: ConversationSummary[]): Promise<void> {
    writeJson(KEYS.CONVERSATIONS, conversations);
  },

  async getCachedMessages(conversationId: string): Promise<ChatMessage[]> {
    return readJson<ChatMessage[]>(`${KEYS.MESSAGES_PREFIX}${conversationId}`, []);
  },

  async saveCachedMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
    writeJson(`${KEYS.MESSAGES_PREFIX}${conversationId}`, messages);
  },

  async clearOfflineData(): Promise<void> {
    const convs = await localStorage.getCachedConversations();
    writeJson(KEYS.SPACES, []);
    writeJson(KEYS.CONVERSATIONS, []);
    for (const c of convs) {
      writeJson(`${KEYS.MESSAGES_PREFIX}${c.id}`, []);
    }
  },

  async getStats(): Promise<StorageStats> {
    const spaces = await localStorage.getCachedSpaces();
    const convs = await localStorage.getCachedConversations();
    let messagesCount = 0;
    for (const c of convs) {
      const msgs = await localStorage.getCachedMessages(c.id);
      messagesCount += msgs.length;
    }
    return {
      engine: "web-storage",
      spacesCount: spaces.length,
      conversationsCount: convs.length,
      messagesCount,
      schemaVersion: 1,
    };
  },
};
