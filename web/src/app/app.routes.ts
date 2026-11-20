import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'admin/login',
    pathMatch: 'full'
  },
  {
    path: 'set-first-password',
    redirectTo: 'admin/set-first-password',
    pathMatch: 'full'
  },
  {
    path: 'set-first-password/:token',
    redirectTo: 'admin/set-first-password/:token',
    pathMatch: 'full'
  },
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin.routes').then(m => m.adminRoutes)
  }
];
