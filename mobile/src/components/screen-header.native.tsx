import { useDrawer } from "@/components/drawer-content";
import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n";
import { Stack } from "expo-router";
import { Menu, SquarePen } from "lucide-react-native";
import { Pressable } from "react-native";

export function ScreenDrawerButton() {
  const { openDrawer } = useDrawer();
  const { translations } = useI18n();

  if (process.env.EXPO_OS === "ios") {
    return (
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="list.bullet" onPress={openDrawer} />
      </Stack.Toolbar>
    );
  }

  return (
    <Stack.Toolbar placement="left" asChild>
      <Pressable
        onPress={openDrawer}
        accessibilityLabel={translations.nav.openDrawer}
        accessibilityRole="button"
        className="p-2 -ml-1 active:opacity-60"
      >
        <Icon icon={Menu} className="w-6 h-6 text-foreground" />
      </Pressable>
    </Stack.Toolbar>
  );
}

export function ChatsToolbars({
  searchPlaceholder,
  onChangeSearch,
  onCancelSearch,
  onNewChat,
}: {
  searchPlaceholder: string;
  onChangeSearch: (text: string) => void;
  onCancelSearch: () => void;
  onNewChat: () => void;
}) {
  const { translations } = useI18n();

  return (
    <>
      {process.env.EXPO_OS === "ios" ? (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.Button
            icon="square.and.pencil"
            onPress={onNewChat}
            separateBackground
          />
        </Stack.Toolbar>
      ) : (
        <Stack.Toolbar placement="right" asChild>
          <Pressable
            onPress={onNewChat}
            accessibilityLabel={translations.nav.newChat}
            accessibilityRole="button"
            className="p-2 -mr-1 active:opacity-60"
          >
            <Icon icon={SquarePen} className="w-5 h-5 text-foreground" />
          </Pressable>
        </Stack.Toolbar>
      )}
      <Stack.SearchBar
        placeholder={searchPlaceholder}
        hideWhenScrolling={false}
        onChangeText={(e) => onChangeSearch(e.nativeEvent.text)}
        onCancelButtonPress={onCancelSearch}
      />
    </>
  );
}
