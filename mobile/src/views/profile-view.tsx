import { useI18n } from "@/i18n";
import { useAppSession } from "@/view-models";
import { ScrollView, Text, View } from "react-native";

export function ProfileView() {
  const { user, roles } = useAppSession();
  const { translations } = useI18n();

  if (!user) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8">
        <Text className="text-sm text-muted-foreground text-center">
          {translations.profile.notSignedIn}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background text-foreground"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="px-5 py-6 gap-5"
    >
      <FieldCard label={translations.profile.fullName} value={user.fullName} />
      <FieldCard label={translations.profile.email} value={user.email} />
      <FieldCard label={translations.profile.status} value={user.status} />

      <View className="gap-2">
        <Text className="text-xs font-medium text-muted-foreground">
          {translations.profile.roles}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {roles.map((role) => (
            <View key={role} className="px-3 py-1 rounded-full bg-muted border border-border">
              <Text className="text-xs font-semibold text-foreground">{role}</Text>
            </View>
          ))}
        </View>
      </View>

      {user.schools && user.schools.length > 0 && (
        <View className="gap-2">
          <Text className="text-xs font-medium text-muted-foreground">
            {translations.profile.schools}
          </Text>
          {user.schools.map((school) => (
            <View key={school.id} className="bg-muted rounded-xl px-4 py-3">
              <Text className="text-sm font-medium text-foreground">{school.name}</Text>
            </View>
          ))}
        </View>
      )}

      <View className="gap-2">
        <Text className="text-xs font-medium text-muted-foreground">
          {translations.profile.permissions}
        </Text>
        <View className="flex-row flex-wrap gap-1.5">
          {user.permissions.map((perm) => (
            <View key={perm} className="px-2.5 py-1 rounded-lg bg-card border border-border">
              <Text className="text-xs text-muted-foreground">{perm}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function FieldCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs font-medium text-muted-foreground">{label}</Text>
      <View className="bg-muted rounded-xl px-4 py-3 border-continuous">
        <Text selectable className="text-base text-foreground">
          {value}
        </Text>
      </View>
    </View>
  );
}
