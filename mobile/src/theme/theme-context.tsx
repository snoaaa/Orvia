import type { ThemePreference } from "@/models/preferences";
import { loadSavedTheme, saveTheme } from "@/services/storage";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as RNThemeProvider,
} from "expo-router/react-navigation";
import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaListener } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";

interface AppThemeContextValue {
  themePreference: ThemePreference;
  resolvedScheme: "light" | "dark";
  setThemePreference: (next: ThemePreference) => Promise<void>;
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let active = true;
    loadSavedTheme()
      .then((saved) => {
        if (active && saved) {
          setThemePreferenceState(saved);
          Uniwind.setTheme(saved);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const setThemePreference = useCallback(async (next: ThemePreference) => {
    setThemePreferenceState(next);
    Uniwind.setTheme(next);
    await saveTheme(next);
  }, []);

  const resolvedScheme: "light" | "dark" =
    themePreference === "system"
      ? systemScheme === "dark"
        ? "dark"
        : "light"
      : themePreference;

  const value = useMemo<AppThemeContextValue>(
    () => ({
      themePreference,
      resolvedScheme,
      setThemePreference,
    }),
    [themePreference, resolvedScheme, setThemePreference],
  );

  return (
    <AppThemeContext value={value}>
      <RNThemeProvider value={resolvedScheme === "dark" ? DarkTheme : DefaultTheme}>
        <SafeAreaListener onChange={({ insets }) => Uniwind.updateInsets(insets)}>
          {children}
        </SafeAreaListener>
      </RNThemeProvider>
    </AppThemeContext>
  );
}

export function useAppTheme() {
  const ctx = use(AppThemeContext);
  if (!ctx) {
    throw new Error("useAppTheme must be used within an AppThemeProvider");
  }
  return ctx;
}
