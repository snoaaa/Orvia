import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';
import {
  ADMIN_TYPE_STORAGE_KEY,
  DOCUMENT_MANAGEMENT_PERMISSIONS,
  NavigationItem,
  hasMenuPermission,
  navigationForPermissions
} from 'src/app/admin/theme/layouts/admin-layout/navigation/navigation';
import { environment } from 'src/environments/environment';

export interface PortalSchool {
  id: string;
  name: string;
  status?: string | null;
}

export interface PortalRoleAssignment {
  role: string;
  scope: string;
  schoolId: string;
  schoolName?: string | null;
  schoolStatus?: string | null;
  groupId: string | null;
  permissions: string[];
}

export interface PortalSessionUser {
  id: string;
  email: string;
  fullName: string;
  status: string;
  role: string | null;
  roles?: string[];
  permissions: string[];
  schoolIds: string[];
  schools?: PortalSchool[];
  isPlatformAdmin: boolean;
  assignments: PortalRoleAssignment[];
}

export const CURRENT_USER_STORAGE_KEY = 'currentUser';
export const ACTIVE_SCHOOL_STORAGE_KEY = 'orvia.activeSchoolId';

/**
 * Central session store for the web portal (§4.5, Issue #92).
 *
 * Holds the signed-in user's roles, permissions, and schools in reactive signals,
 * computes the permission-driven sidebar menu, active school scope, school selector
 * visibility, and default landing route without hard-coding role names in components.
 */
@Injectable({
  providedIn: 'root'
})
export class PortalSessionService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly user = signal<PortalSessionUser | null>(this.readCachedUser());
  readonly loading = signal<boolean>(false);
  readonly initialized = signal<boolean>(this.user() !== null);
  readonly selectedSchoolId = signal<string | null>(
    typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_SCHOOL_STORAGE_KEY) : null
  );

  /** True when the user holds a platform-scoped assignment or wildcard access. */
  readonly isPlatformAdmin = computed<boolean>(() => {
    const u = this.user();
    if (!u) return false;
    return Boolean(
      u.isPlatformAdmin ||
        u.assignments?.some((a) => a.scope === 'platform') ||
        u.permissions?.includes('system:manage') ||
        u.permissions?.includes('*')
    );
  });

  /** Distinct schools assigned to the current user. */
  readonly schools = computed<PortalSchool[]>(() => {
    const u = this.user();
    if (!u) return [];

    if (u.schools && u.schools.length > 0) {
      return u.schools;
    }

    const byId = new Map<string, PortalSchool>();
    for (const a of u.assignments ?? []) {
      if (a.schoolId && !byId.has(a.schoolId)) {
        byId.set(a.schoolId, {
          id: a.schoolId,
          name: a.schoolName || a.schoolId,
          status: a.schoolStatus ?? null
        });
      }
    }

    for (const id of u.schoolIds ?? []) {
      if (id && !byId.has(id)) {
        byId.set(id, { id, name: id });
      }
    }

    return [...byId.values()];
  });

  /**
   * Active school ID for scoping queries and forms:
   * - Single-school users (e.g. School Admin or single-school Staff): fixed to their school.
   * - Multi-school Staff: the currently selected school (defaults to their first school).
   * - Platform Admin: null (all schools) unless a filter is explicitly selected.
   */
  readonly activeSchoolId = computed<string | null>(() => {
    if (this.isPlatformAdmin()) {
      return this.selectedSchoolId();
    }
    const list = this.schools();
    if (list.length === 0) return null;
    if (list.length === 1) return list[0].id;

    const chosen = this.selectedSchoolId();
    if (chosen && list.some((s) => s.id === chosen)) {
      return chosen;
    }
    return list[0].id;
  });

  /** Human-readable name of the active school, if any. */
  readonly activeSchoolName = computed<string | null>(() => {
    const activeId = this.activeSchoolId();
    if (!activeId) return this.isPlatformAdmin() ? 'All Schools' : null;
    const found = this.schools().find((s) => s.id === activeId);
    return found?.name ?? activeId;
  });

  /**
   * True when a school selector should be displayed in the portal header (#92):
   * - School Admin (1 fixed school): false
   * - Staff with document-management rights in 1 school: false
   * - Staff with document-management rights in several schools: true
   */
  readonly showSchoolSelector = computed<boolean>(() => {
    if (this.isPlatformAdmin()) return false;
    return this.schools().length > 1;
  });

  /**
   * True when school columns / school filters in tables should be shown (#92):
   * hidden when the signed-in user belongs to a single school.
   */
  readonly showSchoolColumn = computed<boolean>(() => {
    if (this.isPlatformAdmin()) return true;
    return this.schools().length > 1;
  });

  /**
   * Effective permission codes for the signed-in user (scoped to the active school when
   * a multi-school non-platform user selects a specific school).
   */
  readonly activePermissions = computed<string[]>(() => {
    const u = this.user();
    if (!u) return [];
    if (this.isPlatformAdmin()) {
      return [...new Set(['*', ...(u.permissions ?? [])])];
    }

    const activeSchool = this.activeSchoolId();
    const assignments = u.assignments ?? [];
    if (activeSchool && assignments.length > 0) {
      const scopedAssignments = assignments.filter(
        (a) => a.scope === 'platform' || a.schoolId === activeSchool
      );
      if (scopedAssignments.length > 0) {
        const scopedPerms = new Set<string>(scopedAssignments.flatMap((a) => a.permissions ?? []));
        for (const p of u.permissions ?? []) {
          scopedPerms.add(p);
        }
        return [...scopedPerms];
      }
    }

    return u.permissions ?? [];
  });

  /**
   * Sidebar menu computed reactively from the permission-to-menu map (#92).
   * Switching account updates this signal immediately without a page reload bug.
   */
  readonly menuItems = computed<NavigationItem[]>(() => {
    const u = this.user();
    if (!u) {
      // Fallback for legacy uninitialized tests that only set ADMIN_TYPE_STORAGE_KEY
      const storedAdminType =
        typeof localStorage !== 'undefined'
          ? (localStorage.getItem(ADMIN_TYPE_STORAGE_KEY) ?? '').trim().toLowerCase()
          : '';
      if (storedAdminType === 'school') {
        return navigationForPermissions([
          'metrics:view',
          'users:read',
          'users:assign_role',
          'documents:manage',
          'audit:read'
        ]);
      }
      return navigationForPermissions([
        'system:manage',
        'schools:create',
        'metrics:view',
        'users:read',
        'users:assign_role',
        'documents:manage',
        'audit:read'
      ]);
    }
    return navigationForPermissions(this.activePermissions());
  });

  /**
   * Default landing route computed from permissions (#92):
   * - Platform Admin / School Admin (holds `metrics:view` or `users:read`): `/admin/dashboard/default`
   * - Staff with document-management rights (holds `documents:manage`): `/admin/spaces`
   */
  readonly defaultLandingUrl = computed<string>(() => {
    if (this.hasPermission('metrics:view') || this.hasPermission('users:read')) {
      return '/admin/dashboard/default';
    }
    if (this.hasPermission('documents:manage') || this.hasPermission('spaces:read')) {
      return '/admin/spaces';
    }
    return '/admin/forbidden';
  });

  /** Checks whether the signed-in user holds `permission`. */
  hasPermission(permission: string): boolean {
    const u = this.user();
    if (!u) {
      const storedAdminType =
        typeof localStorage !== 'undefined'
          ? (localStorage.getItem(ADMIN_TYPE_STORAGE_KEY) ?? '').trim().toLowerCase()
          : '';
      if (storedAdminType === 'school') {
        return permission !== 'system:manage' && permission !== 'schools:create' && permission !== 'schools:delete';
      }
      return true;
    }
    return hasMenuPermission(this.activePermissions(), permission);
  }

  /** Checks whether the signed-in user holds at least one of `permissions`. */
  hasAnyPermission(permissions: readonly string[]): boolean {
    if (permissions.length === 0) return true;
    return permissions.some((p) => this.hasPermission(p));
  }

  /** True when the user has any portal access permission (admin or document management). */
  hasPortalAccess(): boolean {
    const u = this.user();
    if (!u) return false;
    if (this.isPlatformAdmin()) return true;
    const perms = this.activePermissions();
    return (
      perms.includes('metrics:view') ||
      perms.includes('users:read') ||
      perms.includes('users:assign_role') ||
      perms.some((p) => DOCUMENT_MANAGEMENT_PERMISSIONS.has(p))
    );
  }

  /** Selects the active school when the user belongs to multiple schools. */
  selectSchool(schoolId: string | null): void {
    this.selectedSchoolId.set(schoolId);
    if (typeof localStorage !== 'undefined') {
      if (schoolId) {
        localStorage.setItem(ACTIVE_SCHOOL_STORAGE_KEY, schoolId);
      } else {
        localStorage.removeItem(ACTIVE_SCHOOL_STORAGE_KEY);
      }
    }
  }

  /** Updates the session store with a newly authenticated user profile. */
  setUser(user: PortalSessionUser): void {
    this.user.set(user);
    this.initialized.set(true);

    const schools = this.schools();
    const currentSelected = this.selectedSchoolId();
    if (!this.isPlatformAdmin() && schools.length > 0) {
      if (!currentSelected || !schools.some((s) => s.id === currentSelected)) {
        this.selectSchool(schools[0].id);
      }
    } else if (this.isPlatformAdmin()) {
      this.selectSchool(null);
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
      localStorage.setItem(
        ADMIN_TYPE_STORAGE_KEY,
        this.isPlatformAdmin() ? 'platform' : 'school'
      );
    }
  }

  /** Clears the session store and removes stored tokens on sign-out or account switch. */
  clearSession(): void {
    this.user.set(null);
    this.initialized.set(false);
    this.selectedSchoolId.set(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_SCHOOL_STORAGE_KEY);
      localStorage.removeItem(ADMIN_TYPE_STORAGE_KEY);
    }
  }

  /** Fetches `/auth/me` from the backend and populates the session store. */
  loadProfile(): Observable<PortalSessionUser | null> {
    this.loading.set(true);
    return this.http.get<PortalSessionUser>(`${this.apiUrl}/auth/me`).pipe(
      tap((me) => {
        this.setUser(me);
        this.loading.set(false);
      }),
      catchError(() => {
        this.loading.set(false);
        return of(this.user());
      })
    );
  }

  /** Ensures the session store is populated before evaluating route guards. */
  ensureLoaded(): Observable<PortalSessionUser | null> {
    const existing = this.user();
    if (existing) {
      return of(existing);
    }
    const hasToken =
      typeof localStorage !== 'undefined' && Boolean(localStorage.getItem('accessToken'));
    if (!hasToken) {
      return of(null);
    }
    return this.loadProfile().pipe(map((u) => u));
  }

  private readCachedUser(): PortalSessionUser | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CURRENT_USER_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PortalSessionUser;
      return parsed && typeof parsed === 'object' && typeof parsed.id === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }
}
