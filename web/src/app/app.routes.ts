import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'admin/login',
    pathMatch: 'full',
  },
  {
    path: 'password/setup',
    redirectTo: 'admin/password/setup',
    pathMatch: 'full',
  },
  {
    path: 'setup-password',
    redirectTo: 'admin/setup-password',
    pathMatch: 'full',
  },
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin.routes').then((m) => m.adminRoutes),
  },
];
