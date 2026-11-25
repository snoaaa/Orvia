import { Routes } from '@angular/router';

// Project import
import {
  portalLandingGuard,
  portalPermissionGuard
} from './identity/guards/portal-permission.guard';
import { apiPermissionGuard } from './documents/shared/api-permissions.util';
import { AdminLayout } from './theme/layouts/admin-layout/admin-layout.component';
import { PERMISSION_MENU_MAP } from './theme/layouts/admin-layout/navigation/navigation';
import { GuestLayoutComponent } from './theme/layouts/guest-layout/guest-layout.component';

export const adminRoutes: Routes = [
  {
    path: '',
    component: AdminLayout,
    children: [
      {
        path: '',
        canActivate: [portalLandingGuard],
        loadComponent: () =>
          import('./identity/components/not-allowed/not-allowed.component').then(
            (c) => c.NotAllowedComponent
          ),
        pathMatch: 'full'
      },
      {
        path: 'dashboard/default',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['dashboard'])],
        loadComponent: () =>
          import('./demo/dashboard/default/default.component').then((c) => c.DefaultComponent)
      },
      {
        path: 'schools',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['schools'])],
        data: {
          sectionId: 'schools',
          title: 'Schools',
          description: 'Manage institutions and their allowed email domains.'
        },
        loadComponent: () =>
          import('./identity/components/portal-section/portal-section.component').then(
            (c) => c.PortalSectionComponent
          )
      },
      {
        path: 'users',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['users'])],
        loadComponent: () =>
          import('./identity/users/user-list/user-list.component').then((c) => c.UserListComponent)
      },
      {
        path: 'users/:id',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['users'])],
        loadComponent: () =>
          import('./identity/users/user-edit/user-edit.component').then((c) => c.UserEditComponent)
      },
      {
        path: 'roles',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['roles'])],
        loadComponent: () =>
          import('./identity/roles/role-list/role-list.component').then((c) => c.RoleListComponent)
      },
      {
        path: 'roles/create',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['roles'])],
        loadComponent: () =>
          import('./identity/roles/role-edit/role-edit.component').then((c) => c.RoleEditComponent)
      },
      {
        path: 'roles/:id',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['roles'])],
        loadComponent: () =>
          import('./identity/roles/role-edit/role-edit.component').then((c) => c.RoleEditComponent)
      },
      {
        path: 'roles/:id/edit',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['roles'])],
        loadComponent: () =>
          import('./identity/roles/role-edit/role-edit.component').then((c) => c.RoleEditComponent)
      },
      {
        path: 'assignments',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['assignments'])],
        loadComponent: () =>
          import('./identity/users/user-list/user-list.component').then((c) => c.UserListComponent)
      },
      {
        path: 'spaces',
        // Read-only users (spaces:read) see the list without its actions; same rule as GET /documents/spaces.
        canActivate: [apiPermissionGuard('spaces:read', 'documents:manage')],
        loadComponent: () =>
          import('./documents/spaces/space-list/space-list.component').then(
            (c) => c.SpaceListComponent
          )
      },
      {
        path: 'spaces/new',
        canActivate: [apiPermissionGuard('spaces:create')],
        loadComponent: () =>
          import('./documents/spaces/space-edit/space-edit.component').then(
            (c) => c.SpaceEditComponent
          )
      },
      {
        path: 'spaces/:spaceId/documents',
        // Readers open documents; managers also edit and delete them (same rules as the API).
        canActivate: [apiPermissionGuard('documents:read', 'documents:manage')],
        loadComponent: () =>
          import('./documents/space-documents/space-document-list/space-document-list.component').then(
            (c) => c.SpaceDocumentListComponent
          )
      },
      {
        path: 'spaces/:id/edit',
        canActivate: [apiPermissionGuard('spaces:update')],
        loadComponent: () =>
          import('./documents/spaces/space-edit/space-edit.component').then(
            (c) => c.SpaceEditComponent
          )
      },
      {
        path: 'documents',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['documents'])],
        data: {
          sectionId: 'documents',
          title: 'Documents',
          description: 'Upload, version, publish, and monitor documents in your school scope.'
        },
        loadComponent: () =>
          import('./identity/components/portal-section/portal-section.component').then(
            (c) => c.PortalSectionComponent
          )
      },
      {
        path: 'documents/upload',
        canActivate: [apiPermissionGuard('documents:manage')],
        loadComponent: () =>
          import('./documents/document-upload/document-upload/document-upload.component').then(
            (c) => c.DocumentUploadComponent
          )
      },
      {
        path: 'conversations',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['conversations'])],
        data: {
          sectionId: 'conversations',
          title: 'Conversations',
          description: 'Monitor conversations and reported answers within your scope.'
        },
        loadComponent: () =>
          import('./identity/components/portal-section/portal-section.component').then(
            (c) => c.PortalSectionComponent
          )
      },
      {
        path: 'metrics',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['metrics'])],
        data: {
          sectionId: 'metrics',
          title: 'Metrics',
          description: 'Track RAG latency, requests, and quality telemetry.'
        },
        loadComponent: () =>
          import('./identity/components/portal-section/portal-section.component').then(
            (c) => c.PortalSectionComponent
          )
      },
      {
        path: 'audit',
        canActivate: [portalPermissionGuard(PERMISSION_MENU_MAP['audit'])],
        data: {
          sectionId: 'audit',
          title: 'Audit',
          description: 'Inspect tamper-evident security and administrative events.'
        },
        loadComponent: () =>
          import('./identity/audit/audit-list/audit-list.component').then(
            (c) => c.AuditListComponent
          )
      },
      {
        path: 'forbidden',
        loadComponent: () =>
          import('./identity/components/not-allowed/not-allowed.component').then(
            (c) => c.NotAllowedComponent
          )
      }
    ]
  },
  {
    path: '',
    component: GuestLayoutComponent,
    children: [
      {
        path: 'login',
        loadComponent: () =>
          import('./demo/pages/authentication/auth-login/auth-login.component').then(
            (c) => c.AuthLoginComponent
          )
      },
      {
        path: 'register',
        loadComponent: () =>
          import('./demo/pages/authentication/auth-register/auth-register.component').then(
            (c) => c.AuthRegisterComponent
          )
      },
      {
        path: 'set-first-password',
        loadComponent: () =>
          import('./demo/pages/authentication/set-first-password/set-first-password.component').then(
            (c) => c.SetFirstPasswordComponent
          )
      },
      {
        path: 'set-first-password/:token',
        loadComponent: () =>
          import('./demo/pages/authentication/set-first-password/set-first-password.component').then(
            (c) => c.SetFirstPasswordComponent
          )
      }
    ]
  }
];
