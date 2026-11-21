import {
  DrawerContent,
  DrawerProvider,
  useDrawer,
} from "@/components/drawer-content";
import { DrawerLayout } from "@/components/drawer-layout";
import "@/global.css";
import { I18nProvider, useI18n } from "@/i18n";
import { AppThemeProvider } from "@/theme";
import { useSystemBackgroundColor } from "@/utils/use-system-background-color";
import { AppSessionProvider } from "@/view-models";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { useCSSVariable } from "uniwind";

const GLASS = Platform.OS === "ios";
const IS_ANDROID = process.env.EXPO_OS === "android";

export const unstable_settings = {
  anchor: "index",
};

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <I18nProvider>
        <AppSessionProvider>
          <DrawerProvider>
            <RootDrawer />
          </DrawerProvider>
        </AppSessionProvider>
      </I18nProvider>
      {process.env.EXPO_OS !== "ios" && <StatusBar style="auto" />}
    </AppThemeProvider>
  );
}

function RootDrawer() {
  const router = useRouter();
  const { isOpen, openDrawer, closeDrawer } = useDrawer();

  useSystemBackgroundColor();

  return (
    <DrawerLayout
      open={isOpen}
      onOpen={openDrawer}
      onClose={closeDrawer}
      drawerContent={
        <DrawerContent
          onNavigate={(path) => {
            closeDrawer();
            router.replace(path, { withAnchor: true });
          }}
          onOpenModal={(path) => {
            closeDrawer();
            router.navigate(path);
          }}
        />
      }
    >
      <StackLayout />
    </DrawerLayout>
  );
}

function StackLayout() {
  const { translations } = useI18n();
  const appForeground = useCSSVariable("--app-foreground") as string;
  const appBackground = useCSSVariable("--app-background") as string;

  return (
    <Stack
      screenOptions={{
        headerTransparent: GLASS,
        headerBackButtonDisplayMode: GLASS ? "minimal" : "default",
        headerTintColor: appForeground,
        headerShadowVisible: IS_ANDROID ? false : undefined,
        headerStyle: IS_ANDROID
          ? {
              backgroundColor: appBackground,
            }
          : undefined,
      }}
    >
      <Stack.Screen
        name="index"
        dangerouslySingular
        options={{
          title: translations.nav.chat,
          animation: "none",
          gestureEnabled: false,
        }}
      />

      <Stack.Screen
        name="spaces"
        options={{
          title: translations.nav.spaces,
          animation: "none",
          gestureEnabled: false,
        }}
      />

      <Stack.Screen
        name="chats"
        options={{
          title: translations.nav.chats,
          animation: "none",
          headerLargeTitleShadowVisible: false,
          gestureEnabled: false,
        }}
      />

      <Stack.Screen
        name="import"
        options={{
          title: translations.nav.importDocument,
          animation: "none",
          gestureEnabled: false,
        }}
      />

      <Stack.Screen
        name="attachments"
        options={{
          title: translations.attachments.title,
          presentation: "formSheet",
          sheetAllowedDetents: [0.55],
          sheetCornerRadius: IS_ANDROID ? 28 : undefined,
          sheetGrabberVisible: true,
          headerTransparent: GLASS,
          headerLargeTitleShadowVisible: false,
        }}
      />

      <Stack.Screen
        name="(settings)"
        options={{
          presentation: IS_ANDROID ? undefined : "modal",
          headerShown: false,
        }}
      />
    </Stack>
  );
}
