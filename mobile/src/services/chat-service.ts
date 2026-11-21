import type {
  ChatMessage,
  ConversationDetail,
  ConversationMessageResponse,
  ConversationSummary,
  MessageStatusResponse,
} from "@/models/chat";
import type { PaginatedResponse } from "@/models/space";
import { apiClient } from "./api";
import { localStorage } from "./storage";

export const chatService = {
  async listConversations(params?: {
    page?: number;
    limit?: number;
    spaceId?: string;
    q?: string;
  }): Promise<ConversationSummary[]> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    query.set("limit", String(params?.limit ?? 50));
    if (params?.spaceId) query.set("spaceId", params.spaceId);
    if (params?.q) query.set("q", params.q);

    const res = await apiClient.get<PaginatedResponse<ConversationSummary>>(
      `/conversations?${query.toString()}`,
    );
    const items = res?.data ?? [];
    if (!params?.q && !params?.spaceId && (!params?.page || params.page === 1)) {
      await localStorage.saveCachedConversations(items);
    }
    return items;
  },

  async getCachedConversations(): Promise<ConversationSummary[]> {
    return localStorage.getCachedConversations();
  },

  async getConversationDetail(conversationId: string): Promise<ConversationDetail> {
    const detail = await apiClient.get<ConversationDetail>(`/conversations/${conversationId}`);
    const mapped: ChatMessage[] = (detail.messages ?? [])
      .filter((m): m is ConversationMessageResponse & { role: "user" | "assistant" } =>
        m.role === "user" || m.role === "assistant",
      )
      .map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        modelUsed: m.modelUsed,
        status: (m.status as ChatMessage["status"]) ?? "done",
        citations: m.citations ?? [],
        notEnoughEvidence: m.notEnoughEvidence ?? false,
        createdAt: m.createdAt,
      }));
    await localStorage.saveCachedMessages(conversationId, mapped);
    return detail;
  },

  async getCachedMessages(conversationId: string): Promise<ChatMessage[]> {
    return localStorage.getCachedMessages(conversationId);
  },

  async saveCachedMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
    await localStorage.saveCachedMessages(conversationId, messages);
  },

  async createConversation(params: {
    userId: string;
    spaceId: string;
    title: string;
  }): Promise<{ id: string }> {
    return apiClient.post<{ id: string }>("/conversations", params);
  },

  async sendMessage(
    conversationId: string,
    question: string,
  ): Promise<ConversationMessageResponse> {
    // Chat contract (#119): the API answers with the pending answer, whose status is then polled.
    return apiClient.post<ConversationMessageResponse>(
      `/conversations/${conversationId}/messages`,
      { question },
    );
  },

  async pollMessageStatus(
    conversationId: string,
    messageId: string,
  ): Promise<MessageStatusResponse> {
    return apiClient.get<MessageStatusResponse>(
      `/conversations/${conversationId}/messages/${messageId}/status`,
    );
  },

  async renameConversation(conversationId: string, title: string): Promise<ConversationSummary> {
    return apiClient.patch<ConversationSummary>(`/conversations/${conversationId}`, { title });
  },

  async deleteConversation(conversationId: string): Promise<void> {
    await apiClient.delete<void>(`/conversations/${conversationId}`);
  },
};
