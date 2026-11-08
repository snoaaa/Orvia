import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { environment } from 'src/environments/environment';
import {
  CreateRolePayload,
  GroupedPermissionCategory,
  PermissionEntity,
  RoleEntity,
  UpdateRolePayload,
  isSystemBaseRole
} from '../models/role.model';

export const FALLBACK_PERMISSIONS: PermissionEntity[] = [
  // System & Administration
  { code: 'system:manage', description: 'Full system administration and configuration' },
  { code: 'audit:read', description: 'View audit logs and trail events' },
  { code: 'audit:export', description: 'Export tamper-evident audit records' },
  { code: 'metrics:view', description: 'View system-wide RAG performance and telemetry metrics' },

  // Schools & Multi-tenancy
  { code: 'schools:create', description: 'Create and register new educational institutions' },
  { code: 'schools:read', description: 'View institution profiles and configurations' },
  { code: 'schools:update', description: 'Update institution details and allowed domains' },
  { code: 'schools:delete', description: 'Deactivate or delete institutions' },

  // Users & Membership
  { code: 'users:invite', description: 'Send invitations to new users' },
  { code: 'users:create', description: 'Create user accounts manually' },
  { code: 'users:read', description: 'View user profile information' },
  { code: 'users:update', description: 'Update user profiles, email, and status' },
  { code: 'users:suspend', description: 'Suspend or reactivate user accounts' },
  { code: 'users:assign_role', description: 'Assign roles and scopes to users' },

  // Academic Groups & Classes
  { code: 'groups:create', description: 'Create student cohorts, classes, and research groups' },
  { code: 'groups:read', description: 'View group details and roster' },
  { code: 'groups:update', description: 'Edit group details and settings' },
  { code: 'groups:delete', description: 'Archive or remove groups' },
  { code: 'groups:manage_members', description: 'Add or remove members from groups' },

  // Knowledge Spaces & Repositories
  { code: 'spaces:create', description: 'Create academic knowledge spaces' },
  { code: 'spaces:read', description: 'Browse and view knowledge spaces' },
  { code: 'spaces:update', description: 'Modify space settings and access rules' },
  { code: 'spaces:delete', description: 'Delete or archive knowledge spaces' },

  // Documents & Processing
  { code: 'documents:create', description: 'Upload and register new documents' },
  { code: 'documents:read', description: 'Read and download document content' },
  { code: 'documents:update', description: 'Edit document metadata, tags, and titles' },
  { code: 'documents:delete', description: 'Soft-delete or purge documents' },
  { code: 'documents:publish', description: 'Publish documents to broader audiences' },
  { code: 'documents:manage_access', description: 'Configure granular document access rights' },
  { code: 'documents:process', description: 'Trigger OCR, chunking, and embedding pipelines' },

  // Conversations & RAG
  { code: 'conversations:create', description: 'Start new RAG query conversations' },
  { code: 'conversations:read', description: 'View own conversation history and messages' },
  { code: 'conversations:update', description: 'Rename or edit conversation sessions' },
  { code: 'conversations:delete', description: 'Delete or archive conversations' },
  { code: 'messages:send', description: 'Submit questions and messages to RAG assistant' },
  { code: 'rag:query', description: 'Perform retrieval-augmented generation search' },
  { code: 'answers:save', description: 'Bookmark and save high-value answers' },
  { code: 'answers:report', description: 'Report inaccurate or harmful RAG responses' },

  // Mobile & Synchronization
  { code: 'devices:register', description: 'Register mobile client devices for synchronization' },
  { code: 'devices:manage', description: 'View and revoke registered mobile devices' },
  { code: 'sync:execute', description: 'Perform delta sync between mobile and cloud' },
  { code: 'offline:select', description: 'Mark documents and spaces for offline caching' }
];

@Injectable({
  providedIn: 'root'
})
export class RoleManagementService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  /**
   * Fetches all roles with assigned permissions and user counts.
   */
  getRoles(): Observable<RoleEntity[]> {
    return this.http.get<RoleEntity[]>(`${this.apiUrl}/identity/roles`).pipe(
      map((roles) =>
        roles.map((r) => ({
          ...r,
          isBase: r.isBase ?? isSystemBaseRole(r.name)
        }))
      ),
      catchError((error) => throwError(() => error))
    );
  }

  /**
   * Fetches a single role by UUID or role name.
   */
  getRoleById(id: string): Observable<RoleEntity> {
    return this.http.get<RoleEntity>(`${this.apiUrl}/identity/roles/${id}`).pipe(
      map((role) => ({
        ...role,
        isBase: role.isBase ?? isSystemBaseRole(role.name)
      })),
      catchError((error) => throwError(() => error))
    );
  }

  /**
   * Creates a new custom role with associated permissions and scope.
   */
  createRole(payload: CreateRolePayload): Observable<RoleEntity> {
    return this.http.post<RoleEntity>(`${this.apiUrl}/identity/roles`, payload).pipe(
      map((role) => ({
        ...role,
        isBase: role.isBase ?? isSystemBaseRole(role.name)
      })),
      catchError((error) => throwError(() => error))
    );
  }

  /**
   * Updates an existing custom role's metadata and permissions.
   */
  updateRole(id: string, payload: UpdateRolePayload): Observable<RoleEntity> {
    return this.http.patch<RoleEntity>(`${this.apiUrl}/identity/roles/${id}`, payload).pipe(
      map((role) => ({
        ...role,
        isBase: role.isBase ?? isSystemBaseRole(role.name)
      })),
      catchError((error) => throwError(() => error))
    );
  }

  /**
   * Deletes a custom role if it is not currently assigned to any users.
   */
  deleteRole(id: string): Observable<{ success: boolean; message: string }> {
    return this.http
      .delete<{ success: boolean; message: string }>(`${this.apiUrl}/identity/roles/${id}`)
      .pipe(catchError((error) => throwError(() => error)));
  }

  /**
   * Fetches the global list of permissions. Falls back to static seed permissions if necessary.
   */
  getPermissions(): Observable<PermissionEntity[]> {
    return this.http.get<PermissionEntity[]>(`${this.apiUrl}/identity/permissions`).pipe(
      map((perms) => (perms && perms.length > 0 ? perms : FALLBACK_PERMISSIONS)),
      catchError(() => of(FALLBACK_PERMISSIONS))
    );
  }

  /**
   * Groups a list of permissions into standardized domain categories for UI selection.
   */
  groupPermissions(permissions: PermissionEntity[]): GroupedPermissionCategory[] {
    const list = permissions.length > 0 ? permissions : FALLBACK_PERMISSIONS;

    const categories: Array<{
      key: string;
      title: string;
      icon: string;
      description: string;
      prefixes: string[];
    }> = [
      {
        key: 'system',
        title: 'System & Platform Administration',
        icon: 'ti ti-settings',
        description: 'Global configuration, metrics telemetry, and audit trail export',
        prefixes: ['system', 'audit', 'metrics']
      },
      {
        key: 'schools',
        title: 'Schools & Multi-Tenancy',
        icon: 'ti ti-school',
        description: 'Institution profiles, allowed email domains, and lifecycle',
        prefixes: ['schools']
      },
      {
        key: 'users',
        title: 'Users & Membership',
        icon: 'ti ti-users',
        description: 'User invitations, account edits, suspensions, and role assignments',
        prefixes: ['users']
      },
      {
        key: 'groups',
        title: 'Academic Groups & Classes',
        icon: 'ti ti-sitemap',
        description: 'Student cohorts, academic classes, and roster management',
        prefixes: ['groups']
      },
      {
        key: 'spaces',
        title: 'Knowledge Spaces',
        icon: 'ti ti-folder',
        description: 'Document repositories, course spaces, and access restrictions',
        prefixes: ['spaces']
      },
      {
        key: 'documents',
        title: 'Documents & Processing',
        icon: 'ti ti-file-text',
        description: 'Document ingestion, publishing, OCR extraction, and embedding',
        prefixes: ['documents']
      },
      {
        key: 'conversations',
        title: 'Conversations & RAG Retrieval',
        icon: 'ti ti-messages',
        description: 'AI questions, semantic search queries, citations, and reporting',
        prefixes: ['conversations', 'messages', 'rag', 'answers']
      },
      {
        key: 'mobile',
        title: 'Mobile Client & Sync',
        icon: 'ti ti-device-mobile',
        description: 'Device registration, delta synchronization, and offline cache selection',
        prefixes: ['devices', 'sync', 'offline']
      }
    ];

    return categories.map((cat) => ({
      key: cat.key,
      title: cat.title,
      icon: cat.icon,
      description: cat.description,
      permissions: list.filter((p) => {
        const prefix = p.code.split(':')[0];
        return cat.prefixes.includes(prefix);
      })
    }));
  }

  /**
   * Helper to check whether a role name is an immutable base role.
   */
  isBaseRole(roleName: string | undefined | null): boolean {
    return isSystemBaseRole(roleName);
  }

  /**
   * Extracts clean, human-readable error messages from NestJS backend responses.
   */
  extractErrorMessage(error: unknown, fallback: string = 'An unexpected error occurred'): string {
    if (error instanceof HttpErrorResponse) {
      if (error.error && typeof error.error === 'object') {
        const body = error.error as { message?: string | string[]; error?: string };
        if (Array.isArray(body.message)) {
          return body.message.join('. ');
        }
        if (typeof body.message === 'string') {
          return body.message;
        }
        if (typeof body.error === 'string') {
          return body.error;
        }
      }
      if (error.status === 400) {
        return 'Invalid request: Please check that all required fields are filled correctly.';
      }
      if (error.status === 401) {
        return 'Authentication required. Please sign in to access role management.';
      }
      if (error.status === 403) {
        return 'Access denied: Role management is restricted to platform administrators.';
      }
      if (error.status === 404) {
        return 'The requested role was not found.';
      }
      if (error.status === 409) {
        return 'A role with this name already exists. Please choose a different name.';
      }
      if (error.status === 0) {
        return 'Unable to reach the API server. Please verify the backend is running.';
      }
    }
    return fallback;
  }
}

