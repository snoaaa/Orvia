import { Icon } from "@/components/icon";
import { ChatMarkdown } from "@/components/markdown";
import { useI18n } from "@/i18n";
import { AlertCircle, BookOpen, FileWarning, RotateCcw, Sparkles } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import type { MessageCitation, MessageGenerationStatus } from "./types";

export function Message({
  from,
  children,
}: {
  from: "user" | "assistant";
  children: ReactNode;
}) {
  if (from === "user") {
    return (
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(150)}
        className="max-w-[82%] self-end rounded-2xl bg-user-bubble px-3.5 py-2.5 mb-3 border-continuous"
      >
        {typeof children === "string" ? (
          <Text
            selectable
            className="text-base leading-5.5 text-foreground"
          >
            {children}
          </Text>
        ) : (
          children
        )}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      className="mb-4"
    >
      {children}
    </Animated.View>
  );
}

export function MessageResponse({ children }: { children: string }) {
  return <ChatMarkdown>{children || "..."}</ChatMarkdown>;
}

export function GenerationStatusIndicator({
  status,
}: {
  status: Extract<MessageGenerationStatus, "pending" | "generating">;
}) {
  const { translations } = useI18n();
  const label =
    status === "pending"
      ? translations.chat.statusPending
      : translations.chat.statusGenerating;
  const badge =
    status === "pending"
      ? translations.chat.statusPendingBadge
      : translations.chat.statusGeneratingBadge;

  return (
    <View className="flex-row items-center gap-2.5 rounded-2xl bg-card px-3.5 py-3 border-continuous border border-border">
      <ActivityIndicator size="small" />
      <View className="flex-1">
        <Text className="text-sm font-medium text-foreground">{label}</Text>
        <Text className="text-xs text-muted-foreground mt-0.5">{badge}</Text>
      </View>
      <Icon icon={Sparkles} className="w-4 h-4 text-muted-foreground" />
    </View>
  );
}

export function MessageErrorCard({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  const { translations } = useI18n();

  return (
    <View className="rounded-2xl bg-card px-3.5 py-3 border-continuous border border-border">
      <View className="flex-row items-start gap-2.5">
        <Icon icon={AlertCircle} className="w-4 h-4 mt-0.5" style={{ color: "#EF4444" }} />
        <View className="flex-1">
          <Text className="text-sm font-medium text-foreground">
            {translations.chat.errorTitle}
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {message || translations.chat.errorDefault}
          </Text>
        </View>
      </View>
      {onRetry && (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          className="mt-2.5 self-start flex-row items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 active:opacity-70"
        >
          <Icon icon={RotateCcw} className="w-3.5 h-3.5 text-foreground" />
          <Text className="text-xs font-semibold text-foreground">
            {translations.common.retry}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export function NotEnoughEvidenceBanner() {
  const { translations } = useI18n();
  return (
    <View className="mt-2 flex-row items-center gap-2 rounded-xl bg-muted px-3 py-2 border-continuous">
      <Icon icon={FileWarning} className="w-4 h-4 text-muted-foreground" />
      <Text className="flex-1 text-xs text-muted-foreground">
        {translations.chat.notEnoughEvidence}
      </Text>
    </View>
  );
}

export function MessageCitations({
  citations,
  onPressCitation,
}: {
  citations: MessageCitation[];
  onPressCitation?: (citation: MessageCitation) => void;
}) {
  if (!citations || citations.length === 0) return null;

  return (
    <View className="mt-2.5 flex-row flex-wrap gap-1.5">
      {citations.map((citation) => (
        <Pressable
          key={citation.id}
          disabled={!citation.available || !onPressCitation}
          onPress={() => onPressCitation?.(citation)}
          className={`flex-row items-center gap-1.5 rounded-full px-2.5 py-1 border border-border ${
            citation.available
              ? "bg-card active:opacity-70"
              : "bg-muted opacity-60"
          }`}
        >
          <Icon icon={BookOpen} className="w-3 h-3 text-muted-foreground" />
          <Text
            numberOfLines={1}
            className={`text-xs max-w-[200px] ${
              citation.available
                ? "text-foreground font-medium"
                : "text-muted-foreground line-through"
            }`}
          >
            [{citation.marker}] {citation.documentName} · {citation.pageOrImageId}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
