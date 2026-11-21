import { Icon } from "@/components/icon";
import { PermissionGate } from "@/components/permission-gate";
import { ScreenDrawerButton } from "@/components/screen-header";
import { useI18n } from "@/i18n";
import { useAppSession } from "@/view-models";
import { Stack } from "expo-router";
import { Camera, Clock, FileText, Lock } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";

export function ImportDocumentView() {
  const { translations } = useI18n();
  const { canManageDocuments } = useAppSession();

  return (
    <>
      <Stack.Screen options={{ title: translations.importDocs.title }} />
      <ScreenDrawerButton />

      <ScrollView className="flex-1 bg-background" contentContainerClassName="p-5 gap-4">
        <PermissionGate
          when={canManageDocuments}
          fallback={
            <View className="rounded-2xl bg-card border border-border p-5 items-center gap-3 mt-10">
              <View className="w-12 h-12 rounded-2xl bg-muted items-center justify-center">
                <Icon icon={Lock} className="w-6 h-6 text-muted-foreground" />
              </View>
              <Text className="text-lg font-semibold text-foreground text-center">
                {translations.importDocs.permissionDeniedTitle}
              </Text>
              <Text className="text-sm text-muted-foreground text-center leading-5">
                {translations.importDocs.permissionDeniedDescription}
              </Text>
            </View>
          }
        >
          <Text className="text-sm text-muted-foreground">
            {translations.importDocs.subtitle}
          </Text>

          <ImportActionCard
            icon={FileText}
            title={translations.importDocs.pdfTitle}
            description={translations.importDocs.pdfDescription}
            badge={translations.importDocs.comingSoonBadge}
          />
          <ImportActionCard
            icon={Camera}
            title={translations.importDocs.imageTitle}
            description={translations.importDocs.imageDescription}
            badge={translations.importDocs.comingSoonBadge}
          />
          <ImportActionCard
            icon={Clock}
            title={translations.importDocs.statusTitle}
            description={translations.importDocs.statusDescription}
            badge={translations.importDocs.comingSoonBadge}
          />
        </PermissionGate>
      </ScrollView>
    </>
  );
}

function ImportActionCard({
  icon,
  title,
  description,
  badge,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <View className="rounded-2xl bg-card border border-border p-4 flex-row items-start gap-3.5">
      <View className="w-10 h-10 rounded-xl bg-muted items-center justify-center">
        <Icon icon={icon} className="w-5 h-5 text-foreground" />
      </View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-base font-semibold text-foreground">{title}</Text>
          <View className="px-2 py-0.5 rounded-full bg-muted">
            <Text className="text-[11px] font-medium text-muted-foreground">{badge}</Text>
          </View>
        </View>
        <Text className="text-xs text-muted-foreground leading-4">{description}</Text>
      </View>
    </View>
  );
}
