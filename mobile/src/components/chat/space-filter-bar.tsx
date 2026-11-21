import { Icon } from "@/components/icon";
import { useI18n } from "@/i18n";
import type { Space } from "@/models/space";
import { cn } from "@/utils/tailwind";
import { FolderOpen, Layers } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";

export function SpaceFilterBar({
  spaces,
  selectedSpaceId,
  onSelectSpace,
  isLoading,
  disabled,
}: {
  spaces: Space[];
  selectedSpaceId: string | null;
  onSelectSpace: (spaceId: string | null) => void;
  isLoading?: boolean;
  disabled?: boolean;
}) {
  const { translations } = useI18n();

  if (!isLoading && spaces.length === 0) {
    return null;
  }

  return (
    <View className="border-b border-border bg-background/80 py-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: "center" }}
      >
        <Pressable
          disabled={disabled}
          onPress={() => onSelectSpace(null)}
          accessibilityRole="button"
          className={cn(
            "flex-row items-center gap-1.5 rounded-full px-3 py-1.5 border",
            selectedSpaceId === null
              ? "bg-foreground border-foreground"
              : "bg-card border-border active:opacity-70",
            disabled && "opacity-60",
          )}
        >
          <Icon
            icon={Layers}
            className={cn(
              "w-3.5 h-3.5",
              selectedSpaceId === null ? "text-background" : "text-muted-foreground",
            )}
          />
          <Text
            className={cn(
              "text-xs font-medium",
              selectedSpaceId === null ? "text-background" : "text-foreground",
            )}
          >
            {translations.chat.allSpaces}
          </Text>
        </Pressable>

        {isLoading
          ? [1, 2].map((k) => (
              <View
                key={k}
                className="h-7 w-24 rounded-full bg-muted opacity-60"
              />
            ))
          : spaces.map((space) => {
              const active = selectedSpaceId === space.id;
              return (
                <Pressable
                  key={space.id}
                  disabled={disabled}
                  onPress={() => onSelectSpace(space.id)}
                  accessibilityRole="button"
                  className={cn(
                    "flex-row items-center gap-1.5 rounded-full px-3 py-1.5 border",
                    active
                      ? "bg-foreground border-foreground"
                      : "bg-card border-border active:opacity-70",
                    disabled && "opacity-60",
                  )}
                >
                  <Icon
                    icon={FolderOpen}
                    className={cn(
                      "w-3.5 h-3.5",
                      active ? "text-background" : "text-muted-foreground",
                    )}
                  />
                  <Text
                    numberOfLines={1}
                    className={cn(
                      "text-xs font-medium max-w-[160px]",
                      active ? "text-background" : "text-foreground",
                    )}
                  >
                    {space.name}
                  </Text>
                </Pressable>
              );
            })}
      </ScrollView>
    </View>
  );
}
