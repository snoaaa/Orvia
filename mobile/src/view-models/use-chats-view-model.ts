import type { ConversationSummary } from "@/models/chat";
import { chatService, getAccessToken } from "@/services";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppSession } from "./app-session-context";

export function useChatsViewModel() {
  const { user } = useAppSession();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const cached = await chatService.getCachedConversations();
      if (cached.length > 0) {
        setConversations(cached);
      }
      if (!getAccessToken()) {
        setIsLoading(false);
        return;
      }
      const remote = await chatService.listConversations();
      setConversations(remote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cached = await chatService.getCachedConversations();
        if (active && cached.length > 0) {
          setConversations(cached);
        }
        if (!getAccessToken()) return;
        const remote = await chatService.listConversations();
        if (active) setConversations(remote);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load conversations");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)),
    );
    if (getAccessToken()) {
      await chatService.renameConversation(id, trimmed);
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (getAccessToken()) {
      await chatService.deleteConversation(id);
    }
  }, []);

  return {
    conversations: filteredConversations,
    search,
    setSearch,
    isLoading,
    error,
    refresh,
    renameConversation,
    deleteConversation,
  };
}
