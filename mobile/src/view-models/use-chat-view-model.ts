import { createStreamingStore } from "@/components/chat";
import { useI18n } from "@/i18n";
import type { ChatMessage } from "@/models/chat";
import type { Space } from "@/models/space";
import {
  ApiError,
  authService,
  chatService,
  getAccessToken,
  loadSelectedSpaceId,
  saveSelectedSpaceId,
  spaceService,
} from "@/services";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppSession } from "./app-session-context";

const POLL_INTERVAL_MS = 900;
const MAX_POLL_ATTEMPTS = 40;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useChatViewModel(initialConversationId?: string) {
  const { user, canSendMessages: allowedToSend } = useAppSession();
  const userId = user?.id ?? "me";
  const { translations, format } = useI18n();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId ?? null,
  );

  const streamingStore = useMemo(() => createStreamingStore(), []);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setSpacesLoading(true);
      try {
        const savedSpace = await loadSelectedSpaceId();
        if (active && savedSpace) {
          setSelectedSpaceId(savedSpace);
        }

        const cachedSpaces = await spaceService.getCachedSpaces();
        if (active && cachedSpaces.length > 0) {
          setSpaces(cachedSpaces);
        }

        await authService.bootstrapDevSession();
        if (!getAccessToken()) return;

        const remoteSpaces = await spaceService.listVisibleSpaces();
        if (active) {
          setSpaces(remoteSpaces);
          if (savedSpace && !remoteSpaces.some((s) => s.id === savedSpace)) {
            setSelectedSpaceId(null);
            await saveSelectedSpaceId(null);
          }
        }
      } catch {
        // Offline or unauthenticated: keep whatever is already cached.
      } finally {
        if (active) setSpacesLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!initialConversationId) return;
    let active = true;
    (async () => {
      const cached = await chatService.getCachedMessages(initialConversationId);
      if (active && cached.length > 0) {
        setMessages(cached);
      }
      if (!getAccessToken()) return;
      try {
        const detail = await chatService.getConversationDetail(initialConversationId);
        if (!active) return;
        setConversationId(detail.id);
        setSelectedSpaceId(detail.spaceId);
        const mapped: ChatMessage[] = (detail.messages ?? [])
          .filter((m): m is typeof m & { role: "user" | "assistant" } =>
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
        setMessages(mapped);
      } catch {
        // Keep cached messages when offline
      }
    })();

    return () => {
      active = false;
    };
  }, [initialConversationId]);

  const submitQuestion = useCallback(
    async (questionText: string, replaceAssistantId?: string) => {
      const trimmed = questionText.trim();
      if (!trimmed || isGenerating) return;

      if (!allowedToSend) {
        setError(new Error(translations.chat.errorPermissionDenied));
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setIsGenerating(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const assistantLocalId = replaceAssistantId ?? `${Date.now()}-assistant`;

      if (replaceAssistantId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replaceAssistantId
              ? {
                  ...m,
                  status: "pending",
                  content: "",
                  errorMessage: undefined,
                }
              : m,
          ),
        );
      } else {
        const userMessage: ChatMessage = {
          id: `${Date.now()}-user`,
          role: "user",
          content: trimmed,
          status: "done",
          createdAt: new Date().toISOString(),
        };
        const pendingAssistant: ChatMessage = {
          id: assistantLocalId,
          role: "assistant",
          content: "",
          status: "pending",
          retryPrompt: trimmed,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMessage, pendingAssistant]);
        setInput("");
      }

      const updateAssistant = (patch: Partial<ChatMessage>) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantLocalId ? { ...m, ...patch } : m)),
        );
      };

      try {
        await authService.bootstrapDevSession();

        if (!getAccessToken()) {
          updateAssistant({ status: "generating" });
          await sleep(350);
          throw new ApiError(translations.chat.errorAuthRequired, { status: 401 });
        }

        let activeConvId = conversationId;
        if (!activeConvId) {
          const targetSpaceId = selectedSpaceId ?? spaces[0]?.id;
          if (!targetSpaceId) {
            throw new ApiError(translations.chat.errorNoSpace, { status: 403 });
          }
          const created = await chatService.createConversation({
            userId,
            spaceId: targetSpaceId,
            title: trimmed.slice(0, 80),
          });
          activeConvId = created.id;
          setConversationId(activeConvId);
        }

        updateAssistant({ status: "generating" });
        const posted = await chatService.sendMessage(activeConvId, trimmed);

        if (posted.status === "pending" || posted.status === "generating") {
          for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
            if (controller.signal.aborted) return;
            await sleep(POLL_INTERVAL_MS);
            const polled = await chatService.pollMessageStatus(activeConvId, posted.id);
            if (polled.status === "generating" || polled.status === "pending") {
              updateAssistant({ status: polled.status });
              continue;
            }
            if (polled.status === "failed") {
              throw new ApiError(
                polled.errorCode
                  ? format(translations.chat.errorGenerationFailedWithCode, {
                      code: polled.errorCode,
                    })
                  : translations.chat.errorGenerationFailed,
              );
            }
            if (polled.status === "done" && polled.answer) {
              const completedPatch: Partial<ChatMessage> = {
                id: polled.answer.id,
                conversationId: activeConvId,
                status: "done",
                content: polled.answer.content,
                modelUsed: polled.answer.modelUsed,
                citations: polled.answer.citations ?? [],
                notEnoughEvidence: polled.answer.notEnoughEvidence ?? false,
              };
              setMessages((prev) => {
                const updated = prev.map((m) =>
                  m.id === assistantLocalId ? { ...m, ...completedPatch } : m,
                );
                void chatService.saveCachedMessages(activeConvId, updated);
                return updated;
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              return;
            }
          }
          throw new ApiError(translations.chat.errorTimeout);
        }

        const directPatch: Partial<ChatMessage> = {
          id: posted.id || assistantLocalId,
          conversationId: activeConvId,
          status: "done",
          content: posted.content,
          modelUsed: posted.modelUsed,
          citations: posted.citations ?? [],
          notEnoughEvidence: posted.notEnoughEvidence ?? false,
        };
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantLocalId ? { ...m, ...directPatch } : m,
          );
          void chatService.saveCachedMessages(activeConvId, updated);
          return updated;
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg =
          err instanceof Error ? err.message : translations.chat.errorSendFailed;
        setError(new Error(msg));
        updateAssistant({
          status: "failed",
          errorMessage: msg,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } finally {
        if (!controller.signal.aborted) {
          setIsGenerating(false);
        }
      }
    },
    [
      allowedToSend,
      conversationId,
      format,
      isGenerating,
      selectedSpaceId,
      spaces,
      translations.chat,
      userId,
    ],
  );

  const onSend = useCallback(() => {
    void submitQuestion(input);
  }, [input, submitQuestion]);

  const onRetry = useCallback(
    (messageId: string) => {
      const target = messages.find((m) => m.id === messageId);
      if (!target?.retryPrompt) return;
      void submitQuestion(target.retryPrompt, messageId);
    },
    [messages, submitQuestion],
  );

  const onNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setError(null);
    setIsGenerating(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const onSelectSpace = useCallback(
    (spaceId: string | null) => {
      setSelectedSpaceId(spaceId);
      void saveSelectedSpaceId(spaceId);
      if (messages.length > 0) {
        setConversationId(null);
      }
    },
    [messages.length],
  );

  const activeSpaceName = useMemo(
    () =>
      spaces.find((s) => s.id === selectedSpaceId)?.name ??
      translations.chat.allSpaces,
    [spaces, selectedSpaceId, translations.chat.allSpaces],
  );

  return {
    messages,
    input,
    setInput,
    isGenerating,
    onSend,
    onRetry,
    onNewChat,
    streamingStore,
    error,
    spaces,
    spacesLoading,
    selectedSpaceId,
    activeSpaceName,
    onSelectSpace,
  };
}
