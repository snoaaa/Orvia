import { Routes } from '@angular/router';

// Project import
import { AdminLayout } from './theme/layouts/admin-layout/admin-layout.component';
import { GuestLayoutComponent } from './theme/layouts/guest-layout/guest-layout.component';
import { platformAdminGuard } from './identity/roles/guards/platform-admin.guard';

export const adminRoutes: Routes = [
  {
    path: '',
    component: AdminLayout,
    children: [
      {
        path: '',
        redirectTo: 'dashboard/default',
        pathMatch: 'full'
      },
      {
        path: 'dashboard/default',
        loadComponent: () => import('./demo/dashboard/default/default.component').then((c) => c.DefaultComponent)
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./identity/users/user-list/user-list.component').then((c) => c.UserListComponent)
      },
      {
        path: 'users/:id',
        loadComponent: () =>
          import('./identity/users/user-edit/user-edit.component').then((c) => c.UserEditComponent)
      },
      {
        path: 'roles',
        canActivate: [platformAdminGuard],
        loadComponent: () =>
          import('./identity/roles/role-list/role-list.component').then((c) => c.RoleListComponent)
      },
      {
        path: 'roles/create',
        canActivate: [platformAdminGuard],
        loadComponent: () =>
          import('./identity/roles/role-edit/role-edit.component').then((c) => c.RoleEditComponent)
      },
      {
        path: 'roles/:id',
        canActivate: [platformAdminGuard],
        loadComponent: () =>
          import('./identity/roles/role-edit/role-edit.component').then((c) => c.RoleEditComponent)
      },
      {
        path: 'roles/:id/edit',
        canActivate: [platformAdminGuard],
        loadComponent: () =>
          import('./identity/roles/role-edit/role-edit.component').then((c) => c.RoleEditComponent)
      }
    ]
  },
  {
    path: '',
    component: GuestLayoutComponent,
    children: [
      {
        path: 'login',
        loadComponent: () => import('./demo/pages/authentication/auth-login/auth-login.component').then((c) => c.AuthLoginComponent)
      },
      {
        path: 'register',
        loadComponent: () =>
          import('./demo/pages/authentication/auth-register/auth-register.component').then((c) => c.AuthRegisterComponent)
      }
    ]
  }
];
