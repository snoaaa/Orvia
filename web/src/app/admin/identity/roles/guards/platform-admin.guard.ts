import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { ADMIN_TYPE_STORAGE_KEY, AdminType } from 'src/app/admin/theme/layouts/admin-layout/navigation/navigation';

export function getAdminTypeFromStorage(): AdminType {
  const stored = (localStorage.getItem(ADMIN_TYPE_STORAGE_KEY) ?? '').trim().toLowerCase();
  return stored === 'school' ? 'school' : 'platform';
}

export const platformAdminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const toast = inject(GoeyToastService, { optional: true });

  const adminType = getAdminTypeFromStorage();

  if (adminType === 'school') {
    toast?.error('Access Denied', {
      description: 'Role management is reserved exclusively for platform administrators.'
    });
    void router.navigate(['/admin/dashboard/default']);
    return false;
  }

  return true;
};

