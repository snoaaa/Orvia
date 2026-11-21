import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n";
import type { AppLocale, ThemePreference } from "@/models/preferences";
import { cn } from "@/utils/tailwind";
import { useSettingsViewModel } from "@/view-models";
import { Link } from "expo-router";
import type { LucideIcon } from "lucide-react-native";
import {
  ChevronRight,
  CircleUser,
  Database,
  Globe,
  LogOut,
  Server,
  ShieldCheck,
  SunMoon,
  Trash2,
} from "lucide-react-native";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

export function SettingsView() {
  const vm = useSettingsViewModel();
  const { translations, format } = useI18n();

  const handleClearCache = () => {
    void vm.clearOfflineCache().then(() => {
      Alert.alert(translations.common.appName, translations.settings.clearCacheSuccess);
    });
  };

  const handleLogout = () => {
    Alert.alert(
      translations.settings.logoutConfirmTitle,
      translations.settings.logoutConfirmMessage,
      [
        { text: translations.common.cancel, style: "cancel" },
        {
          text: translations.settings.logout,
          style: "destructive",
          onPress: () => {
            void vm.signOut();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-background text-foreground"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="android:pb-safe pb-10"
    >
      {/* Account summary */}
      <View className="mx-5 mt-4 mb-5 bg-muted rounded-xl px-4 py-3 border-continuous">
        <Text selectable className="text-[15px] font-medium text-foreground">
          {vm.user?.email ?? translations.settings.guestAccount}
        </Text>
        <Text className="text-xs text-muted-foreground mt-1">
          {translations.settings.roleLabel}:{" "}
          {vm.primaryRole ?? translations.settings.noRole}
        </Text>
      </View>

      <SectionTitle title={translations.settings.accountSection} />
      <Link href="/(settings)/profile" asChild>
        <Pressable className="flex-row items-center px-5 py-3.5 gap-4 active:bg-muted">
          <Icon icon={CircleUser} className="w-5 h-5 text-foreground" />
          <Text className="flex-1 text-[17px] text-foreground">
            {translations.settings.profileLink}
          </Text>
          <Icon icon={ChevronRight} className="w-3.5 h-3.5 text-muted-foreground" />
        </Pressable>
      </Link>

      <SectionDivider />

      <SectionTitle title={translations.settings.preferencesSection} />

      {/* Language selector (French first) */}
      <View className="px-5 py-3 gap-2.5">
        <View className="flex-row items-center gap-4">
          <Icon icon={Globe} className="w-5 h-5 text-foreground" />
          <Text className="flex-1 text-[17px] text-foreground">
            {translations.settings.languageLabel}
          </Text>
        </View>
        <View className="flex-row gap-2 pl-9">
          {(
            [
              { code: "fr", label: translations.settings.languageFr },
              { code: "en", label: translations.settings.languageEn },
            ] as const satisfies readonly { code: AppLocale; label: string }[]
          ).map((option) => {
            const active = vm.locale === option.code;
            return (
              <Pressable
                key={option.code}
                onPress={() => void vm.setLocale(option.code)}
                className={cn(
                  "px-3.5 py-1.5 rounded-full border",
                  active
                    ? "bg-foreground border-foreground"
                    : "bg-card border-border active:opacity-70",
                )}
              >
                <Text
                  className={cn(
                    "text-xs font-medium",
                    active ? "text-background" : "text-foreground",
                  )}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Theme selector */}
      <View className="px-5 py-3 gap-2.5">
        <View className="flex-row items-center gap-4">
          <Icon icon={SunMoon} className="w-5 h-5 text-foreground" />
          <Text className="flex-1 text-[17px] text-foreground">
            {translations.settings.themeLabel}
          </Text>
        </View>
        <View className="flex-row gap-2 pl-9">
          {(
            [
              { value: "system", label: translations.settings.themeSystem },
              { value: "light", label: translations.settings.themeLight },
              { value: "dark", label: translations.settings.themeDark },
            ] as const satisfies readonly { value: ThemePreference; label: string }[]
          ).map((option) => {
            const active = vm.themePreference === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => void vm.setThemePreference(option.value)}
                className={cn(
                  "px-3.5 py-1.5 rounded-full border",
                  active
                    ? "bg-foreground border-foreground"
                    : "bg-card border-border active:opacity-70",
                )}
              >
                <Text
                  className={cn(
                    "text-xs font-medium",
                    active ? "text-background" : "text-foreground",
                  )}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <SectionDivider />

      <SectionTitle title={translations.settings.technicalSection} />
      <InfoRow icon={Server} label={translations.settings.apiUrlLabel} value={vm.apiBaseUrl} />
      <InfoRow
        icon={Database}
        label={translations.settings.storageEngineLabel}
        value={
          vm.storageStats
            ? format(translations.settings.storageStatsValue, {
                spaces: vm.storageStats.spacesCount,
                conversations: vm.storageStats.conversationsCount,
                messages: vm.storageStats.messagesCount,
                version: vm.storageStats.schemaVersion,
              })
            : translations.common.loading
        }
      />

      <Pressable
        onPress={handleClearCache}
        className="flex-row items-center px-5 py-3.5 gap-4 active:bg-muted"
      >
        <Icon icon={Trash2} className="w-5 h-5 text-foreground" />
        <Text className="text-[16px] text-foreground">
          {translations.settings.clearCacheButton}
        </Text>
      </Pressable>

      {vm.isAuthenticated && (
        <>
          <SectionDivider />
          <Pressable
            onPress={handleLogout}
            className="flex-row items-center px-5 py-3.5 gap-4 active:bg-muted"
          >
            <Icon icon={LogOut} className="w-5 h-5 text-red-500" />
            <Text className="text-[17px] text-red-500">
              {translations.settings.logout}
            </Text>
          </Pressable>
        </>
      )}

      <View className="flex-row items-center gap-2 px-5 pt-6">
        <Icon icon={ShieldCheck} className="w-4 h-4 text-muted-foreground" />
        <Text className="text-xs text-muted-foreground">
          Orvia Mobile · MVVM Architecture
        </Text>
      </View>
    </ScrollView>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-5 pt-4 pb-1.5">
      {title}
    </Text>
  );
}

function SectionDivider() {
  return <View className="h-px bg-border mx-5 my-2" />;
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <View className="flex-row items-start px-5 py-3 gap-4">
      <Icon icon={icon} className="w-5 h-5 text-foreground mt-0.5" />
      <View className="flex-1">
        <Text className="text-[15px] text-foreground">{label}</Text>
        <Text selectable className="text-xs text-muted-foreground mt-0.5">
          {value}
        </Text>
      </View>
    </View>
  );
}
