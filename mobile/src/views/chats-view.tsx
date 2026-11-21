import { Icon } from "@/components/icon";
import { ChatsToolbars, ScreenDrawerButton } from "@/components/screen-header";
import { useI18n } from "@/i18n";
import type { ConversationSummary } from "@/models/chat";
import { useChatsViewModel } from "@/view-models";
import { Link, Stack, useRouter } from "expo-router";
import { ChevronRight, History, Search } from "lucide-react-native";
import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";

function ChatRow({
  item,
  onRename,
  onDelete,
  renameLabel,
  deleteLabel,
}: {
  item: ConversationSummary;
  onRename: () => void;
  onDelete: () => void;
  renameLabel: string;
  deleteLabel: string;
}) {
  return (
    <Link href={{ pathname: "/", params: { conversationId: item.id } }} asChild>
      <Link.Trigger>
        <Pressable className="flex-row items-center px-5 py-4 border-b border-border/40 active:bg-card">
          <View className="flex-1 gap-0.5 mr-3">
            <Text
              numberOfLines={1}
              className="text-[17px] text-foreground"
              selectable
            >
              {item.title}
            </Text>
            <Text className="text-[13px] text-muted-foreground">
              {new Date(item.updatedAt).toLocaleDateString()}
            </Text>
          </View>
          <Icon icon={ChevronRight} className="w-3.5 h-3.5 text-muted-foreground" />
        </Pressable>
      </Link.Trigger>

      <Link.Menu>
        <Link.MenuAction title={renameLabel} icon="pencil" onPress={onRename} />
        <Link.MenuAction
          title={deleteLabel}
          icon="trash"
          destructive
          onPress={onDelete}
        />
      </Link.Menu>
    </Link>
  );
}

export function ChatsView() {
  const vm = useChatsViewModel();
  const { translations, format } = useI18n();
  const router = useRouter();

  const handleRename = useCallback(
    (chat: ConversationSummary) => {
      if (Platform.OS === "ios") {
        Alert.prompt(
          translations.chats.renameTitle,
          undefined,
          [
            { text: translations.common.cancel, style: "cancel" },
            {
              text: translations.common.ok,
              onPress: (newTitle?: string) => {
                if (newTitle?.trim()) {
                  void vm.renameConversation(chat.id, newTitle);
                }
              },
            },
          ],
          "plain-text",
          chat.title,
        );
      }
    },
    [translations, vm],
  );

  const handleDelete = useCallback(
    (chat: ConversationSummary) => {
      Alert.alert(
        translations.chats.deleteTitle,
        format(translations.chats.deleteConfirm, { title: chat.title }),
        [
          { text: translations.common.cancel, style: "cancel" },
          {
            text: translations.common.delete,
            style: "destructive",
            onPress: () => {
              void vm.deleteConversation(chat.id);
            },
          },
        ],
      );
    },
    [format, translations, vm],
  );

  return (
    <>
      <Stack.Screen options={{ title: translations.chats.title }} />
      <ScreenDrawerButton />
      <ChatsToolbars
        searchPlaceholder={translations.chats.searchPlaceholder}
        onChangeSearch={vm.setSearch}
        onCancelSearch={() => vm.setSearch("")}
        onNewChat={() => router.navigate("/")}
      />

      <View className="flex-1 bg-background">
        {vm.isLoading && vm.conversations.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={vm.conversations}
            keyExtractor={(item) => item.id}
            contentInsetAdjustmentBehavior="automatic"
            automaticallyAdjustContentInsets
            automaticallyAdjustsScrollIndicatorInsets
            automaticallyAdjustKeyboardInsets
            contentContainerClassName="android:pb-safe pb-0"
            refreshControl={
              <RefreshControl refreshing={vm.isLoading} onRefresh={() => void vm.refresh()} />
            }
            renderItem={({ item }) => (
              <ChatRow
                item={item}
                onRename={() => handleRename(item)}
                onDelete={() => handleDelete(item)}
                renameLabel={translations.common.rename}
                deleteLabel={translations.common.delete}
              />
            )}
            ListEmptyComponent={
              vm.search ? (
                <View className="flex-1 items-center justify-center pt-28 gap-2 px-8">
                  <Icon icon={Search} className="w-10 h-10 text-muted-foreground" />
                  <Text className="text-base text-muted-foreground text-center">
                    {format(translations.chats.emptySearch, { query: vm.search })}
                  </Text>
                </View>
              ) : (
                <View className="flex-1 items-center justify-center pt-28 gap-2 px-8">
                  <Icon icon={History} className="w-10 h-10 text-muted-foreground" />
                  <Text className="text-lg font-semibold text-foreground text-center">
                    {translations.chats.emptyTitle}
                  </Text>
                  <Text className="text-sm text-muted-foreground text-center">
                    {translations.chats.emptySubtitle}
                  </Text>
                </View>
              )
            }
          />
        )}
      </View>
    </>
  );
}
