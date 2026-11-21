import type { ChatMessage, ConversationSummary } from "@/models/chat";
import type { Space } from "@/models/space";

export interface StorageStats {
  engine: "sqlite" | "web-storage";
  spacesCount: number;
  conversationsCount: number;
  messagesCount: number;
  schemaVersion: number;
}

export interface LocalStorageAdapter {
  init(): Promise<void>;
  getPreference(key: string): Promise<string | null>;
  setPreference(key: string, value: string | null): Promise<void>;
  getCachedSpaces(): Promise<Space[]>;
  saveCachedSpaces(spaces: Space[]): Promise<void>;
  getCachedConversations(): Promise<ConversationSummary[]>;
  saveCachedConversations(conversations: ConversationSummary[]): Promise<void>;
  getCachedMessages(conversationId: string): Promise<ChatMessage[]>;
  saveCachedMessages(conversationId: string, messages: ChatMessage[]): Promise<void>;
  clearOfflineData(): Promise<void>;
  getStats(): Promise<StorageStats>;
}
