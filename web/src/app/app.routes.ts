import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'admin/login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    redirectTo: 'admin/login',
    pathMatch: 'full',
  },
  {
    path: 'register',
    redirectTo: 'admin/register',
    pathMatch: 'full',
  },
  {
    path: 'password/setup',
    redirectTo: 'admin/password/setup',
    pathMatch: 'full',
  },
  {
    path: 'setup-password',
    redirectTo: 'admin/password/setup',
    pathMatch: 'full',
  },
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin.routes').then((m) => m.adminRoutes),
  },
  {
    path: '**',
    redirectTo: 'admin/login',
  },
];
