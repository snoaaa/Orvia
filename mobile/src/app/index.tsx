import { ChatView } from "@/views";
import { useLocalSearchParams } from "expo-router";

export default function ChatRoute() {
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const conversationId =
    typeof params.conversationId === "string" ? params.conversationId : undefined;
  return <ChatView conversationId={conversationId} />;
}
