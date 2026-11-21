import type { AuthenticatedUser, RoleName } from "@/models/auth";

export const PERMISSIONS = {
  SPACES_READ: "spaces:read",
  SPACES_CREATE: "spaces:create",
  DOCUMENTS_READ: "documents:read",
  DOCUMENTS_CREATE: "documents:create",
  DOCUMENTS_UPDATE: "documents:update",
  DOCUMENTS_DELETE: "documents:delete",
  DOCUMENTS_PUBLISH: "documents:publish",
  DOCUMENTS_PROCESS: "documents:process",
  DOCUMENTS_MANAGE: "documents:manage",
  CONVERSATIONS_CREATE: "conversations:create",
  CONVERSATIONS_READ: "conversations:read",
  CONVERSATIONS_UPDATE: "conversations:update",
  CONVERSATIONS_DELETE: "conversations:delete",
  MESSAGES_SEND: "messages:send",
  RAG_QUERY: "rag:query",
  ANSWERS_SAVE: "answers:save",
  ANSWERS_REPORT: "answers:report",
  DEVICES_REGISTER: "devices:register",
  SYNC_EXECUTE: "sync:execute",
  OFFLINE_SELECT: "offline:select",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS] | (string & {});

// Seeded roles use both colon and dot separators (e.g. documents:manage / documents.manage).
function expandPermissionVariants(code: string): string[] {
  const normalized = code.trim().toLowerCase();
  if (!normalized) return [];
  const colon = normalized.replace(/\./g, ":");
  const dot = normalized.replace(/:/g, ".");
  return colon === dot ? [colon] : [colon, dot];
}

export function getUserPermissions(user: AuthenticatedUser | null | undefined): Set<string> {
  if (!user) return new Set();
  const perms = new Set<string>();
  for (const p of user.permissions ?? []) {
    for (const v of expandPermissionVariants(p)) perms.add(v);
  }
  for (const assignment of user.assignments ?? []) {
    for (const p of assignment.permissions ?? []) {
      for (const v of expandPermissionVariants(p)) perms.add(v);
    }
  }
  return perms;
}

export function getUserRoles(user: AuthenticatedUser | null | undefined): RoleName[] {
  if (!user) return [];
  const set = new Set<RoleName>();
  if (user.role) set.add(user.role);
  for (const r of user.roles ?? []) set.add(r);
  for (const a of user.assignments ?? []) {
    if (a.role) set.add(a.role);
  }
  return Array.from(set);
}

export function hasPermission(
  user: AuthenticatedUser | null | undefined,
  code: PermissionCode,
): boolean {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  const userPerms = getUserPermissions(user);
  return expandPermissionVariants(code).some((variant) => userPerms.has(variant));
}

export function hasAnyPermission(
  user: AuthenticatedUser | null | undefined,
  codes: PermissionCode[],
): boolean {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  return codes.some((code) => hasPermission(user, code));
}

export function hasAllPermissions(
  user: AuthenticatedUser | null | undefined,
  codes: PermissionCode[],
): boolean {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  return codes.every((code) => hasPermission(user, code));
}

export function canManageDocuments(user: AuthenticatedUser | null | undefined): boolean {
  return hasAnyPermission(user, [
    PERMISSIONS.DOCUMENTS_MANAGE,
    PERMISSIONS.DOCUMENTS_CREATE,
    PERMISSIONS.DOCUMENTS_PROCESS,
  ]);
}

export function canSendMessages(user: AuthenticatedUser | null | undefined): boolean {
  // Allow composing before sign-in so the user gets an inline auth prompt on send.
  if (!user) return true;
  return hasAnyPermission(user, [PERMISSIONS.MESSAGES_SEND, PERMISSIONS.RAG_QUERY]);
}

export function canSaveAnswers(user: AuthenticatedUser | null | undefined): boolean {
  return hasPermission(user, PERMISSIONS.ANSWERS_SAVE);
}

export function canReportAnswers(user: AuthenticatedUser | null | undefined): boolean {
  return hasPermission(user, PERMISSIONS.ANSWERS_REPORT);
}

export function canUseOfflineSync(user: AuthenticatedUser | null | undefined): boolean {
  return hasAnyPermission(user, [PERMISSIONS.SYNC_EXECUTE, PERMISSIONS.OFFLINE_SELECT]);
}

export function isGuestUser(user: AuthenticatedUser | null | undefined): boolean {
  if (!user) return false;
  const roles = getUserRoles(user);
  return roles.length > 0 && roles.every((r) => r === "PARENT_GUEST");
}

export function getPrimaryRoleLabel(user: AuthenticatedUser | null | undefined): RoleName | null {
  if (!user) return null;
  if (user.role) return user.role;
  const roles = getUserRoles(user);
  return roles[0] ?? null;
}
