import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { map } from 'rxjs';
import { PortalSessionService } from '../../identity/services/portal-session.service';

/** Same lists as the API's PermissionsGuard (`api/src/auth/guards/permissions.guard.ts`). */
const DOC_MANAGE_PERMISSIONS: ReadonlySet<string> = new Set([
  'documents:manage',
  'documents.manage'
]);
const DOC_COVERED_PERMISSIONS: ReadonlySet<string> = new Set([
  'documents:create',
  'documents:update',
  'documents:delete',
  'documents:publish',
  'documents:manage_access',
  'documents:process',
  'documents:access.manage',
  'documents.access.manage',
  'spaces:create',
  'spaces:update',
  'spaces:delete',
  'spaces:manage',
  'documents:manage',
  'documents.manage'
]);

/**
 * Whether `permissions` let the API accept a route that requires `required`, with exactly the API's rules:
 * - `*` or the permission itself;
 * - `documents:manage` is also granted by any document or space management permission;
 * - each of those (`spaces:create`...) is also granted by `documents:manage`, but not by one another
 *   (`spaces:update` does not allow `spaces:create`).
 *
 * The portal's menu check (`hasMenuPermission`) is looser on purpose (it only decides what to show in the
 * sidebar); buttons and routes that call the API use this one, so they never lead to a 403.
 */
export function grantsApiPermission(permissions: readonly string[], required: string): boolean {
  if (permissions.includes('*') || permissions.includes(required)) return true;
  const hasDocManage = permissions.some((p) => DOC_MANAGE_PERMISSIONS.has(p));
  if (DOC_MANAGE_PERMISSIONS.has(required)) {
    return hasDocManage || permissions.some((p) => DOC_COVERED_PERMISSIONS.has(p));
  }
  return DOC_COVERED_PERMISSIONS.has(required) && hasDocManage;
}

/** True when the signed-in user may use `required` in the active school, as the API decides. */
export function sessionGrants(session: PortalSessionService, required: string): boolean {
  return grantsApiPermission(session.activePermissions(), required);
}

/**
 * True when the signed-in user may use `required` in `schoolId` with the API's rules:
 * when `user.assignments` is present, only assignments for `schoolId` (or platform scope)
 * count so permissions from another school never leak.
 */
export function sessionGrantsInSchool(
  session: PortalSessionService,
  schoolId: string | null | undefined,
  required: string
): boolean {
  if (session.isPlatformAdmin()) return true;
  const user = session.user();
  if (!user) return false;
  const assignments = user.assignments ?? [];
  if (assignments.length === 0) {
    return sessionGrants(session, required);
  }
  const scoped = schoolId
    ? assignments.filter((a) => a.schoolId === schoolId || a.scope === 'platform')
    : assignments;
  return scoped.some((a) => grantsApiPermission(a.permissions ?? [], required));
}

/**
 * Route guard: lets the page open when the user holds at least one of `anyOf` (API rules above),
 * otherwise shows the "Not allowed" page like `portalPermissionGuard`.
 */
export function apiPermissionGuard(...anyOf: string[]): CanActivateFn {
  return (_route, state) => {
    const session = inject(PortalSessionService);
    const router = inject(Router);
    const toast = inject(GoeyToastService, { optional: true });

    return session.ensureLoaded().pipe(
      map(() => {
        if (anyOf.some((permission) => sessionGrants(session, permission))) return true;
        toast?.error('Access Not Allowed', {
          description: 'You do not have permission to open this page.'
        });
        void router.navigate(['/admin/forbidden'], { queryParams: { blocked: state.url } });
        return false;
      })
    );
  };
}
