import "@/global.css";

import { Icon } from "@/components/icon";
import { PermissionGate } from "@/components/permission-gate";
import { TouchableGlass } from "@/components/touchable-glass";
import { SafeAreaView } from "@/components/tw";
import { FEATURE_FLAGS } from "@/config/features";
import { useI18n } from "@/i18n";
import { cn } from "@/utils/tailwind";
import { useAppSession } from "@/view-models/app-session-context";
import type { Href } from "expo-router";
import { FileUp, FolderOpen, History, MessageSquare, Plus, Settings } from "lucide-react-native";

import React, { createContext, use, useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type DrawerContextValue = {
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const DrawerContext = createContext<DrawerContextValue | null>(null);

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openDrawer = useCallback(() => setIsOpen(true), []);
  const closeDrawer = useCallback(() => setIsOpen(false), []);

  return (
    <DrawerContext value={{ isOpen, openDrawer, closeDrawer }}>
      {children}
    </DrawerContext>
  );
}

export function useDrawer() {
  const context = use(DrawerContext);
  if (!context) {
    throw new Error("useDrawer must be used within a DrawerProvider");
  }
  return context;
}

function DrawerNavItem({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: typeof MessageSquare;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 mx-2 rounded-[10px] active:bg-muted"
    >
      <Icon icon={icon} className="w-5 h-5 text-muted-foreground" />
      <Text className="text-base text-foreground">{label}</Text>
    </Pressable>
  );
}

function getInitials(fullName?: string | null): string {
  if (!fullName) return "OR";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function DrawerContent({
  onNavigate,
  onOpenModal,
}: {
  onNavigate: (path: Href) => void;
  onOpenModal: (path: Href) => void;
}) {
  const { translations } = useI18n();
  const { user, primaryRole, canManageDocuments } = useAppSession();

  return (
    <SafeAreaView className="flex-1" edges={["top", "bottom", "left"]}>
      <View className="px-4 pt-2 pb-3">
        <Text className="text-[28px] font-bold text-foreground">
          {translations.common.appName}
        </Text>
        <Text className="text-xs text-muted-foreground mt-0.5">
          {translations.common.assistantSubtitle}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 8 }}
      >
        <DrawerNavItem
          icon={MessageSquare}
          label={translations.nav.newChat}
          onPress={() => onNavigate("/")}
        />

        {FEATURE_FLAGS.ENABLE_SPACES_SCREEN && (
          <DrawerNavItem
            icon={FolderOpen}
            label={translations.nav.spaces}
            onPress={() => onNavigate("/spaces")}
          />
        )}

        {FEATURE_FLAGS.ENABLE_CHAT_HISTORY_SCREEN && (
          <DrawerNavItem
            icon={History}
            label={translations.nav.chats}
            onPress={() => onNavigate("/chats")}
          />
        )}

        {FEATURE_FLAGS.ENABLE_DOCUMENT_IMPORT && (
          <PermissionGate when={canManageDocuments}>
            <DrawerNavItem
              icon={FileUp}
              label={translations.nav.importDocument}
              onPress={() => onNavigate("/import")}
            />
          </PermissionGate>
        )}

        {FEATURE_FLAGS.ENABLE_SETTINGS_MODAL && (
          <DrawerNavItem
            icon={Settings}
            label={translations.nav.settings}
            onPress={() => onOpenModal("/(settings)/settings")}
          />
        )}

        <View className="px-6 pt-6">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {translations.nav.workspaceLabel}
          </Text>
          <Text className="text-sm text-muted-foreground mt-1.5 leading-5">
            {translations.nav.workspaceHint}
          </Text>
        </View>
      </ScrollView>

      <View
        className="flex-row items-center px-4 py-3 border-t border-border"
        style={{ borderTopWidth: StyleSheet.hairlineWidth }}
      >
        {FEATURE_FLAGS.ENABLE_SETTINGS_MODAL ? (
          <TouchableGlass
            onPress={() => onOpenModal("/(settings)/settings")}
            className={cn(
              "rounded-full p-2 flex-row items-center gap-2.5 active:opacity-60 flex-1 mr-2",
            )}
          >
            <View className="w-8 h-8 rounded-full bg-muted items-center justify-center">
              <Text className="text-[13px] font-semibold text-foreground">
                {getInitials(user?.fullName)}
              </Text>
            </View>
            <View className="flex-1">
              <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                {user?.fullName ?? translations.common.appName}
              </Text>
              {primaryRole && (
                <Text numberOfLines={1} className="text-[11px] text-muted-foreground">
                  {primaryRole}
                </Text>
              )}
            </View>
          </TouchableGlass>
        ) : (
          <Text className="text-xs text-muted-foreground px-2">
            {translations.common.appName}
          </Text>
        )}
        <TouchableGlass
          onPress={() => onNavigate("/")}
          className="w-10 h-10 rounded-full bg-foreground active:bg-muted items-center justify-center"
        >
          <Icon icon={Plus} className="w-6 h-6 text-background" />
        </TouchableGlass>
      </View>
    </SafeAreaView>
  );
}
