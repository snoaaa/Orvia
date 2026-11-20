import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { map } from 'rxjs';
import { PortalSessionService } from '../services/portal-session.service';

/**
 * Route guard factory that blocks direct URL access to pages whose required permission
 * is not held by the signed-in user, redirecting to the 'Not Allowed' page (`/admin/forbidden`) (#92).
 */
export function portalPermissionGuard(required: string | readonly string[]): CanActivateFn {
  const requiredList = Array.isArray(required) ? required : [required];

  return (_route, state) => {
    const session = inject(PortalSessionService);
    const router = inject(Router);
    const toast = inject(GoeyToastService, { optional: true });

    return session.ensureLoaded().pipe(
      map(() => {
        if (session.hasAnyPermission(requiredList)) {
          return true;
        }

        toast?.error('Access Not Allowed', {
          description: 'You do not have permission to open this page.'
        });
        void router.navigate(['/admin/forbidden'], {
          queryParams: { blocked: state.url }
        });
        return false;
      })
    );
  };
}

/**
 * Redirects `/admin` to the signed-in user's permission-derived default landing page (#92):
 * - Platform Admin / School Admin: `/admin/dashboard/default`
 * - Staff with document-management rights: `/admin/spaces`
 */
export const portalLandingGuard: CanActivateFn = () => {
  const session = inject(PortalSessionService);
  const router = inject(Router);

  return session.ensureLoaded().pipe(
    map(() => {
      const target = session.defaultLandingUrl();
      void router.navigateByUrl(target);
      return false;
    })
  );
};
