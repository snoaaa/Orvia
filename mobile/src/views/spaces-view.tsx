import { Icon } from "@/components/icon";
import { ScreenDrawerButton } from "@/components/screen-header";
import { useI18n } from "@/i18n";
import type { Space } from "@/models/space";
import { useSpacesViewModel } from "@/view-models";
import { Stack, useRouter } from "expo-router";
import { ChevronRight, Database, FolderOpen } from "lucide-react-native";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";

export function SpacesView() {
  const vm = useSpacesViewModel();
  const { translations } = useI18n();
  const router = useRouter();

  const renderItem = ({ item }: { item: Space }) => (
    <Pressable
      onPress={() => router.replace("/")}
      className="flex-row items-center gap-3.5 px-5 py-4 border-b border-border/50 active:bg-muted"
    >
      <View className="w-10 h-10 rounded-xl bg-card border border-border items-center justify-center">
        <Icon icon={FolderOpen} className="w-5 h-5 text-foreground" />
      </View>
      <View className="flex-1">
        <Text className="text-base font-medium text-foreground" numberOfLines={1}>
          {item.name}
        </Text>
        {item.description ? (
          <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={2}>
            {item.description}
          </Text>
        ) : item.language ? (
          <Text className="text-xs text-muted-foreground mt-0.5">
            {item.language.toUpperCase()}
          </Text>
        ) : null}
      </View>
      <Icon icon={ChevronRight} className="w-4 h-4 text-muted-foreground" />
    </Pressable>
  );

  return (
    <>
      <Stack.Screen options={{ title: translations.spaces.title }} />
      <ScreenDrawerButton />

      <View className="flex-1 bg-background">
        {vm.isFromCache && (
          <View className="flex-row items-center gap-2 px-5 py-2 bg-muted border-b border-border">
            <Icon icon={Database} className="w-3.5 h-3.5 text-muted-foreground" />
            <Text className="text-xs text-muted-foreground">
              {translations.spaces.cachedNotice}
            </Text>
          </View>
        )}

        {vm.isLoading && vm.spaces.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={vm.spaces}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            refreshControl={
              <RefreshControl refreshing={vm.isLoading} onRefresh={() => void vm.refresh()} />
            }
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center px-8 pt-24 gap-2">
                <Icon icon={FolderOpen} className="w-10 h-10 text-muted-foreground" />
                <Text className="text-lg font-semibold text-foreground text-center">
                  {translations.spaces.emptyTitle}
                </Text>
                <Text className="text-sm text-muted-foreground text-center">
                  {translations.spaces.emptySubtitle}
                </Text>
              </View>
            }
          />
        )}
      </View>
    </>
  );
}
