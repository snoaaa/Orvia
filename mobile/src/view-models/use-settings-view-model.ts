import { useI18n } from "@/i18n";
import { apiClient, localStorage, type StorageStats } from "@/services";
import { useAppTheme } from "@/theme";
import { useCallback, useEffect, useState } from "react";
import { useAppSession } from "./app-session-context";

export function useSettingsViewModel() {
  const session = useAppSession();
  const { locale, setLocale } = useI18n();
  const { themePreference, resolvedScheme, setThemePreference } = useAppTheme();
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

  const refreshStats = useCallback(async () => {
    try {
      const stats = await localStorage.getStats();
      setStorageStats(stats);
    } catch {
      setStorageStats(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    localStorage
      .getStats()
      .then((stats) => {
        if (active) setStorageStats(stats);
      })
      .catch(() => {
        if (active) setStorageStats(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const clearOfflineCache = useCallback(async () => {
    await localStorage.clearOfflineData();
    await refreshStats();
  }, [refreshStats]);

  return {
    user: session.user,
    isAuthenticated: session.isAuthenticated,
    primaryRole: session.primaryRole,
    locale,
    setLocale,
    themePreference,
    resolvedScheme,
    setThemePreference,
    apiBaseUrl: apiClient.getBaseUrl(),
    storageStats,
    refreshStats,
    clearOfflineCache,
    signOut: session.signOut,
  };
}
