import { DrawerProvider } from "@/components/drawer-content";
import { Sidebar, SidebarToggle } from "@/components/sidebar";
import "@/global.css";
import { I18nProvider, useI18n } from "@/i18n";
import { AppThemeProvider } from "@/theme";
import { AppSessionProvider, useAppSession } from "@/view-models";
import { Slot } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <I18nProvider>
        <AppSessionProvider>
          <DrawerProvider>
            <WebShell />
          </DrawerProvider>
        </AppSessionProvider>
      </I18nProvider>
    </AppThemeProvider>
  );
}

function WebShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { translations } = useI18n();
  const { primaryRole } = useAppSession();

  return (
    <View className="flex h-dvh w-full flex-row bg-sidebar">
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        isCollapsed={sidebarCollapsed}
        onCollapse={() => setSidebarCollapsed((v) => !v)}
      />

      {/* Main content area */}
      <View className="flex flex-1 min-w-0 flex-col">
        {/* Top bar */}
        <View className="flex h-14 shrink-0 flex-row items-center gap-2 bg-sidebar px-3">
          <View className="md:hidden">
            <SidebarToggle onPress={() => setSidebarOpen(true)} />
          </View>

          <View className="hidden md:flex md:ml-auto md:flex-row md:items-center md:gap-2">
            <View className="rounded-lg border border-border/50 bg-card px-3 py-1">
              <Text className="text-xs font-medium text-muted-foreground">
                {primaryRole ?? translations.common.assistantSubtitle}
              </Text>
            </View>
          </View>
        </View>

        {/* Inset content panel */}
        <View className="flex flex-1 min-h-0 flex-col overflow-hidden bg-background md:rounded-tl-xl md:border-t md:border-l md:border-border/40">
          <Slot />
        </View>
      </View>
    </View>
  );
}
