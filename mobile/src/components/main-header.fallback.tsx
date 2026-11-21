import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n";
import { Stack } from "expo-router";
import { Menu, SquarePen } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useDrawer } from "./drawer-content";

function HeaderTitle() {
  const { translations } = useI18n();
  return (
    <View className="px-2 py-1 flex-col items-center self-center">
      <Text className="text-[17px] font-semibold text-foreground">
        {translations.chat.headerTitle}
      </Text>
    </View>
  );
}

export function MainHeader({ onNewChat }: { onNewChat?: () => void }) {
  const { openDrawer } = useDrawer();
  const { translations } = useI18n();

  return (
    <>
      {process.env.EXPO_OS === "ios" ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="list.bullet" onPress={openDrawer} />
        </Stack.Toolbar>
      ) : (
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
      )}

      <Stack.Screen.Title asChild>
        <HeaderTitle />
      </Stack.Screen.Title>

      {onNewChat &&
        (process.env.EXPO_OS === "ios" ? (
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button icon="square.and.pencil" onPress={onNewChat} />
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
        ))}
    </>
  );
}
