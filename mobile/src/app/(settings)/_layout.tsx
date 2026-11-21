import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n";
import * as Application from "expo-application";
import { Stack, useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { Platform, Pressable } from "react-native";
import { useCSSVariable } from "uniwind";

const GLASS = Platform.OS === "ios";

export default function SettingsLayout() {
  const router = useRouter();
  const { translations } = useI18n();

  const appForeground = useCSSVariable("--app-foreground") as string;
  const appBackground = useCSSVariable("--app-background") as string;

  return (
    <Stack
      screenOptions={{
        headerTransparent: GLASS,
        headerLargeTitleShadowVisible: false,
        headerBackButtonDisplayMode: GLASS ? "minimal" : "default",
        headerTintColor: appForeground,
        headerShadowVisible: false,
        headerStyle: {
          backgroundColor: appBackground,
        },
      }}
    >
      <Stack.Screen
        name="settings"
        options={{
          title: translations.settings.title,
          headerLeft: () => null,
        }}
      >
        {process.env.EXPO_OS === "ios" ? (
          <>
            <Stack.Toolbar placement="left">
              <Stack.Toolbar.Button icon="xmark" onPress={() => router.back()} />
            </Stack.Toolbar>
            <Stack.Toolbar placement="right">
              <Stack.Toolbar.Menu icon="info.circle">
                <Stack.Toolbar.MenuAction icon="app">
                  {`${Application.applicationName ?? "Orvia"} v${Application.nativeApplicationVersion ?? "1.0.0"}`}
                </Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
            </Stack.Toolbar>
          </>
        ) : (
          <Stack.Toolbar placement="left" asChild>
            <Pressable
              onPress={() => router.back()}
              accessibilityLabel={translations.common.close}
              accessibilityRole="button"
              className="p-2 -ml-1 active:opacity-60"
            >
              <Icon icon={X} className="w-5 h-5 text-foreground" />
            </Pressable>
          </Stack.Toolbar>
        )}
      </Stack.Screen>
      <Stack.Screen
        name="profile"
        options={{
          title: translations.profile.title,
        }}
      />
    </Stack>
  );
}
