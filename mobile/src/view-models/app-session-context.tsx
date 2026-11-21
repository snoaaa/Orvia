import type { AuthenticatedUser } from "@/models/auth";
import { authService, getAccessToken, localStorage, registerUnauthorizedHandler } from "@/services";
import {
  canManageDocuments,
  canReportAnswers,
  canSaveAnswers,
  canSendMessages,
  canUseOfflineSync,
  getPrimaryRoleLabel,
  getUserRoles,
  hasAnyPermission,
  hasPermission,
  isGuestUser,
  type PermissionCode,
} from "@/utils/permissions";
import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";

interface AppSessionContextValue {
  user: AuthenticatedUser | null;
  isReady: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  primaryRole: string | null;
  roles: string[];
  canManageDocuments: boolean;
  canSendMessages: boolean;
  canSaveAnswers: boolean;
  canReportAnswers: boolean;
  canUseOfflineSync: boolean;
  isGuest: boolean;
  hasPermission: (code: PermissionCode) => boolean;
  hasAnyPermission: (codes: PermissionCode[]) => boolean;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    setIsLoading(true);
    try {
      await localStorage.init();
      await authService.bootstrapDevSession();
      if (getAccessToken()) {
        const me = await authService.fetchCurrentUser();
        setUser(me);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
      setIsReady(true);
    }
  }, []);

  const signOut = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  useEffect(() => {
    let active = true;
    registerUnauthorizedHandler(() => {
      setUser(null);
    });
    (async () => {
      try {
        await localStorage.init();
        await authService.bootstrapDevSession();
        if (getAccessToken()) {
          const me = await authService.fetchCurrentUser();
          if (active) setUser(me);
        } else if (active) {
          setUser(null);
        }
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) {
          setIsLoading(false);
          setIsReady(true);
        }
      }
    })();
    return () => {
      active = false;
      registerUnauthorizedHandler(null);
    };
  }, []);

  const value = useMemo<AppSessionContextValue>(
    () => ({
      user,
      isReady,
      isLoading,
      isAuthenticated: Boolean(user && getAccessToken()),
      primaryRole: getPrimaryRoleLabel(user),
      roles: getUserRoles(user),
      canManageDocuments: canManageDocuments(user),
      canSendMessages: canSendMessages(user),
      canSaveAnswers: canSaveAnswers(user),
      canReportAnswers: canReportAnswers(user),
      canUseOfflineSync: canUseOfflineSync(user),
      isGuest: isGuestUser(user),
      hasPermission: (code) => hasPermission(user, code),
      hasAnyPermission: (codes) => hasAnyPermission(user, codes),
      refreshSession,
      signOut,
    }),
    [user, isReady, isLoading, refreshSession, signOut],
  );

  return <AppSessionContext value={value}>{children}</AppSessionContext>;
}

export function useAppSession() {
  const ctx = use(AppSessionContext);
  if (!ctx) {
    throw new Error("useAppSession must be used within an AppSessionProvider");
  }
  return ctx;
}
