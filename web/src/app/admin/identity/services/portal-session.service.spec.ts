import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';
import { portalLandingGuard, portalPermissionGuard } from '../guards/portal-permission.guard';
import { PortalSessionService, PortalSessionUser } from './portal-session.service';

describe('PortalSessionService & Role Adaptation (Issue #92)', () => {
  let service: PortalSessionService;
  let httpMock: HttpTestingController;
  let routerMock: { navigate: ReturnType<typeof vi.fn>; navigateByUrl: ReturnType<typeof vi.fn> };

  const platformAdminProfile: PortalSessionUser = {
    id: 'pa-1',
    email: 'admin@wamdp.platform',
    fullName: 'Platform Admin',
    status: 'ACTIVE',
    role: 'PLATFORM_ADMIN',
    roles: ['PLATFORM_ADMIN'],
    permissions: [
      'system:manage',
      'schools:create',
      'schools:read',
      'schools:update',
      'schools:delete',
      'users:read',
      'users:update',
      'users:suspend',
      'users:assign_role',
      'documents:manage',
      'metrics:view',
      'audit:read'
    ],
    schoolIds: [],
    schools: [],
    isPlatformAdmin: true,
    assignments: [
      {
        role: 'PLATFORM_ADMIN',
        scope: 'platform',
        schoolId: '00000000-0000-0000-0000-000000000001',
        groupId: null,
        permissions: ['*']
      }
    ]
  };

  const schoolAdminProfile: PortalSessionUser = {
    id: 'sa-1',
    email: 'admin.a@demo.test',
    fullName: 'School A Admin',
    status: 'ACTIVE',
    role: 'SCHOOL_ADMIN',
    roles: ['SCHOOL_ADMIN'],
    permissions: [
      'schools:read',
      'schools:update',
      'users:invite',
      'users:read',
      'users:update',
      'users:suspend',
      'users:assign_role',
      'spaces:create',
      'spaces:read',
      'documents:manage',
      'documents:read',
      'metrics:view',
      'audit:read'
    ],
    schoolIds: ['school-a'],
    schools: [{ id: 'school-a', name: 'Demo School A' }],
    isPlatformAdmin: false,
    assignments: [
      {
        role: 'SCHOOL_ADMIN',
        scope: 'school',
        schoolId: 'school-a',
        schoolName: 'Demo School A',
        groupId: null,
        permissions: [
          'schools:read',
          'schools:update',
          'users:invite',
          'users:read',
          'users:update',
          'users:suspend',
          'users:assign_role',
          'spaces:create',
          'spaces:read',
          'documents:manage',
          'documents:read',
          'metrics:view',
          'audit:read'
        ]
      }
    ]
  };

  const singleSchoolStaffDocProfile: PortalSessionUser = {
    id: 'cm-1',
    email: 'docmgr@demo.test',
    fullName: 'Doc Manager Staff',
    status: 'ACTIVE',
    role: 'STAFF',
    roles: ['STAFF'],
    permissions: ['spaces:read', 'spaces:create', 'documents:read', 'documents:manage'],
    schoolIds: ['school-a'],
    schools: [{ id: 'school-a', name: 'Demo School A' }],
    isPlatformAdmin: false,
    assignments: [
      {
        role: 'STAFF',
        scope: 'school',
        schoolId: 'school-a',
        schoolName: 'Demo School A',
        groupId: null,
        permissions: ['spaces:read', 'spaces:create', 'documents:read', 'documents:manage']
      }
    ]
  };

  const multiSchoolStaffDocProfile: PortalSessionUser = {
    ...singleSchoolStaffDocProfile,
    id: 'cm-multi',
    schoolIds: ['school-a', 'school-b'],
    schools: [
      { id: 'school-a', name: 'Demo School A' },
      { id: 'school-b', name: 'Demo School B' }
    ],
    assignments: [
      {
        role: 'STAFF',
        scope: 'school',
        schoolId: 'school-a',
        schoolName: 'Demo School A',
        groupId: null,
        permissions: ['spaces:read', 'documents:read', 'documents:manage']
      },
      {
        role: 'STAFF',
        scope: 'school',
        schoolId: 'school-b',
        schoolName: 'Demo School B',
        groupId: null,
        permissions: ['spaces:read', 'documents:read', 'documents:manage']
      }
    ]
  };

  beforeEach(() => {
    localStorage.clear();
    routerMock = {
      navigate: vi.fn().mockResolvedValue(true),
      navigateByUrl: vi.fn().mockResolvedValue(true)
    };

    TestBed.configureTestingModule({
      providers: [
        PortalSessionService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: routerMock }
      ]
    });

    service = TestBed.inject(PortalSessionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  function flattenMenuIds(): string[] {
    return service
      .menuItems()
      .flatMap((group) => group.children ?? [])
      .map((item) => item.id);
  }

  it('shows exact menu, all-schools scope, and dashboard landing page for Platform Admin', () => {
    service.setUser(platformAdminProfile);

    expect(flattenMenuIds()).toEqual([
      'dashboard',
      'schools',
      'users',
      'roles',
      'assignments',
      'spaces',
      'documents',
      'conversations',
      'metrics',
      'audit'
    ]);
    expect(service.defaultLandingUrl()).toBe('/admin/dashboard/default');
    expect(service.showSchoolSelector()).toBe(false);
    expect(service.showSchoolColumn()).toBe(true);
    expect(service.hasPermission('schools:delete')).toBe(true);
  });

  it('shows exact menu (no Schools or Roles), fixed single school (no selector/column), and dashboard landing page for School Admin', () => {
    service.setUser(schoolAdminProfile);

    expect(flattenMenuIds()).toEqual([
      'dashboard',
      'users',
      'assignments',
      'spaces',
      'documents',
      'conversations',
      'metrics',
      'audit'
    ]);
    expect(service.defaultLandingUrl()).toBe('/admin/dashboard/default');
    expect(service.activeSchoolId()).toBe('school-a');
    expect(service.activeSchoolName()).toBe('Demo School A');
    expect(service.showSchoolSelector()).toBe(false);
    expect(service.showSchoolColumn()).toBe(false);
    expect(service.hasPermission('schools:delete')).toBe(false);
    expect(service.hasPermission('schools:create')).toBe(false);
  });

  it('shows only Spaces and Documents menu and defaults to /admin/spaces for Staff with document-management rights', () => {
    service.setUser(singleSchoolStaffDocProfile);

    expect(flattenMenuIds()).toEqual(['spaces', 'documents']);
    expect(service.defaultLandingUrl()).toBe('/admin/spaces');
    expect(service.showSchoolSelector()).toBe(false);
    expect(service.showSchoolColumn()).toBe(false);

    // Multi-school staff member sees the school selector
    service.setUser(multiSchoolStaffDocProfile);
    expect(service.showSchoolSelector()).toBe(true);
    expect(service.showSchoolColumn()).toBe(true);
    expect(service.activeSchoolId()).toBe('school-a');

    service.selectSchool('school-b');
    expect(service.activeSchoolId()).toBe('school-b');
    expect(service.activeSchoolName()).toBe('Demo School B');
  });

  it('updates the sidebar menu reactively when switching accounts without page reload', () => {
    service.setUser(platformAdminProfile);
    expect(flattenMenuIds()).toContain('roles');
    expect(flattenMenuIds()).toContain('schools');

    service.clearSession();
    service.setUser(schoolAdminProfile);
    expect(flattenMenuIds()).not.toContain('roles');
    expect(flattenMenuIds()).not.toContain('schools');
    expect(flattenMenuIds()).toContain('users');

    service.clearSession();
    service.setUser(singleSchoolStaffDocProfile);
    expect(flattenMenuIds()).toEqual(['spaces', 'documents']);
  });

  it('blocks direct URL access to hidden pages and redirects to /admin/forbidden via portalPermissionGuard', async () => {
    service.setUser(singleSchoolStaffDocProfile);

    const guard = portalPermissionGuard('users:read');
    const allowed = await firstValueFrom(
      TestBed.runInInjectionContext(() => guard({} as any, { url: '/admin/users' } as any)) as any
    );

    expect(allowed).toBe(false);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/admin/forbidden'], {
      queryParams: { blocked: '/admin/users' }
    });
  });

  it('redirects /admin to the role-appropriate default landing page via portalLandingGuard', async () => {
    service.setUser(singleSchoolStaffDocProfile);

    await firstValueFrom(
      TestBed.runInInjectionContext(() => portalLandingGuard({} as any, {} as any)) as any
    );

    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/admin/spaces');
  });

  it('loads the user profile from GET /auth/me', () => {
    service.loadProfile().subscribe();
    const req = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    expect(req.request.method).toBe('GET');
    req.flush(schoolAdminProfile);

    expect(service.user()?.email).toBe('admin.a@demo.test');
    expect(service.activeSchoolId()).toBe('school-a');
  });
});
