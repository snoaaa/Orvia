import {
  ChatProvider,
  Conversation,
  ConversationScrollButton,
  GenerationStatusIndicator,
  Message,
  MessageCitations,
  MessageErrorCard,
  MessageResponse,
  NotEnoughEvidenceBanner,
  PromptInput,
  PromptInputAction,
  PromptInputBody,
  PromptInputSubmit,
  PromptInputTextarea,
  SpaceFilterBar,
  type ChatMessage,
  type MessageCitation,
} from "@/components/chat";
import { Icon } from "@/components/icon";
import { MainHeader } from "@/components/main-header";
import { PermissionGate } from "@/components/permission-gate";
import { FEATURE_FLAGS } from "@/config/features";
import { useI18n } from "@/i18n";
import { useAppSession, useChatViewModel } from "@/view-models";
import { Link } from "expo-router";
import { Plus, ShieldCheck } from "lucide-react-native";
import { useCallback } from "react";
import { Alert, Pressable, Text, View } from "react-native";

export function ChatView({ conversationId }: { conversationId?: string }) {
  const vm = useChatViewModel(conversationId);
  const { onRetry } = vm;
  const { canManageDocuments } = useAppSession();
  const { translations, format } = useI18n();

  const handlePressCitation = useCallback((citation: MessageCitation) => {
    Alert.alert(
      `${citation.documentName} (${citation.pageOrImageId})`,
      citation.excerpt,
    );
  }, []);

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      if (item.role === "user") {
        return <Message from="user">{item.content}</Message>;
      }

      if (item.status === "pending" || item.status === "generating") {
        return (
          <Message from="assistant">
            <GenerationStatusIndicator status={item.status} />
          </Message>
        );
      }

      if (item.status === "failed") {
        return (
          <Message from="assistant">
            <MessageErrorCard
              message={item.errorMessage}
              onRetry={() => onRetry(item.id)}
            />
          </Message>
        );
      }

      return (
        <Message from="assistant">
          <MessageResponse>{item.content}</MessageResponse>
          {item.notEnoughEvidence && <NotEnoughEvidenceBanner />}
          {item.citations && item.citations.length > 0 && (
            <MessageCitations
              citations={item.citations}
              onPressCitation={handlePressCitation}
            />
          )}
        </Message>
      );
    },
    [handlePressCitation, onRetry],
  );

  return (
    <>
      <ChatProvider value={vm}>
        <SpaceFilterBar
          spaces={vm.spaces}
          selectedSpaceId={vm.selectedSpaceId}
          onSelectSpace={vm.onSelectSpace}
          isLoading={vm.spacesLoading}
          disabled={vm.isGenerating}
        />
        <Conversation
          renderMessage={renderMessage}
          emptyState={
            <View className="flex-1 items-center justify-center px-6 py-10">
              <View className="w-12 h-12 rounded-2xl bg-card border border-border items-center justify-center mb-3">
                <Icon icon={ShieldCheck} className="w-6 h-6 text-foreground" />
              </View>
              <Text className="text-xl font-semibold text-foreground text-center">
                {translations.chat.emptyTitle}
              </Text>
              <Text className="text-sm text-muted-foreground text-center mt-1 max-w-[300px]">
                {format(translations.chat.emptySubtitle, {
                  scope: vm.activeSpaceName,
                })}
              </Text>
              <View className="mt-5 w-full max-w-[320px] gap-2">
                {translations.chat.suggestedPrompts.map((prompt) => (
                  <Pressable
                    key={prompt}
                    onPress={() => vm.setInput(prompt)}
                    className="rounded-xl bg-card border border-border px-3.5 py-2.5 active:opacity-70"
                  >
                    <Text className="text-xs text-foreground text-center">
                      {prompt}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
        >
          <ConversationScrollButton />
          <PromptInput>
            {FEATURE_FLAGS.ENABLE_ATTACHMENTS_PICKER && (
              <PermissionGate when={canManageDocuments}>
                <Link href="/attachments" asChild>
                  <PromptInputAction>
                    <Icon icon={Plus} className="w-6 h-6 text-foreground" />
                  </PromptInputAction>
                </Link>
              </PermissionGate>
            )}
            <PromptInputBody>
              <PromptInputTextarea placeholder={translations.chat.inputPlaceholder} />
              <PromptInputSubmit />
            </PromptInputBody>
          </PromptInput>
        </Conversation>
      </ChatProvider>
      <MainHeader onNewChat={vm.messages.length > 0 ? vm.onNewChat : undefined} />
    </>
  );
}
