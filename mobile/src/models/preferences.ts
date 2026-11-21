export type AppLocale = "fr" | "en";

export type ThemePreference = "system" | "light" | "dark";

export interface AppPreferences {
  locale: AppLocale;
  theme: ThemePreference;
  selectedSpaceId: string | null;
}
