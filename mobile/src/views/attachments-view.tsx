import { AndroidGrabber } from "@/components/grabber";
import { Icon } from "@/components/icon";
import { PermissionGate } from "@/components/permission-gate";
import { useI18n } from "@/i18n";
import { useAppSession } from "@/view-models";
import * as ImagePicker from "expo-image-picker";
import type { LucideIcon } from "lucide-react-native";
import { Camera, File, Image as ImageIcon, Lock } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";

function AttachmentButton({
  icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center gap-2 py-3 rounded-xl bg-secondary active:bg-muted border-continuous"
    >
      <Icon icon={icon} className="w-6 h-6 text-foreground" />
      <Text className="text-[13px] text-foreground">{label}</Text>
    </Pressable>
  );
}

async function openCamera() {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return;
  await ImagePicker.launchCameraAsync({ mediaTypes: ["images"] });
}

async function openPhotos() {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return;
  await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"] });
}

export function AttachmentsView() {
  const { translations } = useI18n();
  const { canManageDocuments } = useAppSession();

  return (
    <ScrollView className="flex-1 bg-background" contentInsetAdjustmentBehavior="automatic">
      <AndroidGrabber />
      <PermissionGate
        when={canManageDocuments}
        fallback={
          <View className="mx-5 mt-4 p-4 rounded-xl bg-muted flex-row items-center gap-3">
            <Icon icon={Lock} className="w-5 h-5 text-muted-foreground" />
            <Text className="flex-1 text-sm text-muted-foreground">
              {translations.attachments.permissionHint}
            </Text>
          </View>
        }
      >
        <View className="flex-row gap-3 px-5 pt-2 pb-4">
          <AttachmentButton
            icon={Camera}
            label={translations.attachments.camera}
            onPress={() => void openCamera()}
          />
          <AttachmentButton
            icon={ImageIcon}
            label={translations.attachments.photos}
            onPress={() => void openPhotos()}
          />
          <AttachmentButton icon={File} label={translations.attachments.files} />
        </View>
      </PermissionGate>
    </ScrollView>
  );
}
