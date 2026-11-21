import type { AppLocale, ThemePreference } from "@/models/preferences";
import { localStorage } from "./database";

const PREF_KEYS = {
  LOCALE: "locale",
  THEME: "theme",
  SELECTED_SPACE_ID: "selected_space_id",
} as const;

export async function loadSavedLocale(): Promise<AppLocale | null> {
  const raw = await localStorage.getPreference(PREF_KEYS.LOCALE);
  return raw === "fr" || raw === "en" ? raw : null;
}

export async function saveLocale(locale: AppLocale): Promise<void> {
  await localStorage.setPreference(PREF_KEYS.LOCALE, locale);
}

export async function loadSavedTheme(): Promise<ThemePreference | null> {
  const raw = await localStorage.getPreference(PREF_KEYS.THEME);
  return raw === "system" || raw === "light" || raw === "dark" ? raw : null;
}

export async function saveTheme(theme: ThemePreference): Promise<void> {
  await localStorage.setPreference(PREF_KEYS.THEME, theme);
}

export async function loadSelectedSpaceId(): Promise<string | null> {
  return localStorage.getPreference(PREF_KEYS.SELECTED_SPACE_ID);
}

export async function saveSelectedSpaceId(spaceId: string | null): Promise<void> {
  await localStorage.setPreference(PREF_KEYS.SELECTED_SPACE_ID, spaceId);
}
