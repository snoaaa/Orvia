import type { PermissionCode } from "@/utils/permissions";
import { useAppSession } from "@/view-models/app-session-context";
import type { ReactNode } from "react";

interface PermissionGateProps {
  permission?: PermissionCode;
  anyOf?: PermissionCode[];
  when?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionGate({
  permission,
  anyOf,
  when,
  fallback = null,
  children,
}: PermissionGateProps) {
  const { hasPermission, hasAnyPermission } = useAppSession();

  let allowed = true;
  if (when !== undefined) {
    allowed = allowed && when;
  }
  if (permission) {
    allowed = allowed && hasPermission(permission);
  }
  if (anyOf && anyOf.length > 0) {
    allowed = allowed && hasAnyPermission(anyOf);
  }

  return allowed ? <>{children}</> : <>{fallback}</>;
}
