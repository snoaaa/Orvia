import type { AuthenticatedUser } from "@/models/auth";
import { apiClient, ensureDevSessionIfConfigured, getAccessToken, setAccessToken } from "./api";
import { localStorage } from "./storage";

export const authService = {
  async bootstrapDevSession(): Promise<boolean> {
    return ensureDevSessionIfConfigured();
  },

  async fetchCurrentUser(): Promise<AuthenticatedUser | null> {
    if (!getAccessToken()) return null;
    return apiClient.get<AuthenticatedUser>("/auth/me");
  },

  async logout(): Promise<void> {
    try {
      if (getAccessToken()) {
        await apiClient.post<void>("/auth/logout");
      }
    } catch {
      // Clear local credentials and offline data even if server session already expired.
    } finally {
      setAccessToken(null);
      await localStorage.clearOfflineData();
    }
  },
};
