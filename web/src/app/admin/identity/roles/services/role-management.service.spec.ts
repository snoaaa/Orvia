import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from 'src/environments/environment';
import { RoleEntity, isSystemBaseRole } from '../models/role.model';
import { RoleManagementService } from './role-management.service';

describe('RoleManagementService', () => {
  let service: RoleManagementService;
  let httpMock: HttpTestingController;

  const mockRoles: RoleEntity[] = [
    {
      id: 'role-platform-admin',
      name: 'PLATFORM_ADMIN',
      scope: 'platform',
      permissions: ['system:manage', 'audit:read'],
      assignedUsersCount: 1,
      isBase: true,
      createdAt: '2026-10-17T12:00:00Z',
      updatedAt: '2026-10-17T12:00:00Z'
    },
    {
      id: 'role-ta',
      name: 'TEACHING_ASSISTANT',
      scope: 'school',
      permissions: ['documents:read', 'spaces:read'],
      assignedUsersCount: 3,
      isBase: false,
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-01T10:00:00Z'
    }
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        RoleManagementService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });

    service = TestBed.inject(RoleManagementService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should fetch all roles and compute isBase properly', () => {
    service.getRoles().subscribe((roles) => {
      expect(roles.length).toBe(2);
      expect(roles[0].name).toBe('PLATFORM_ADMIN');
      expect(roles[0].isBase).toBe(true);
      expect(roles[1].name).toBe('TEACHING_ASSISTANT');
      expect(roles[1].isBase).toBe(false);
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/roles`);
    expect(req.request.method).toBe('GET');
    req.flush(mockRoles);
  });

  it('should fetch a single role by ID', () => {
    service.getRoleById('role-ta').subscribe((role) => {
      expect(role.id).toBe('role-ta');
      expect(role.name).toBe('TEACHING_ASSISTANT');
      expect(role.isBase).toBe(false);
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/roles/role-ta`);
    expect(req.request.method).toBe('GET');
    req.flush(mockRoles[1]);
  });

  it('should create a custom role with permissions', () => {
    const payload = {
      name: 'LAB_INSTRUCTOR',
      scope: 'school' as const,
      permissions: ['documents:read', 'documents:create']
    };

    service.createRole(payload).subscribe((role) => {
      expect(role.name).toBe('LAB_INSTRUCTOR');
      expect(role.scope).toBe('school');
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/roles`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush({
      id: 'new-role-id',
      name: 'LAB_INSTRUCTOR',
      scope: 'school',
      permissions: ['documents:read', 'documents:create'],
      createdAt: '2026-11-08T00:00:00Z',
      updatedAt: '2026-11-08T00:00:00Z'
    });
  });

  it('should update a custom role and permissions', () => {
    const payload = {
      name: 'SENIOR_TA',
      permissions: ['documents:read', 'spaces:read', 'conversations:create']
    };

    service.updateRole('role-ta', payload).subscribe((role) => {
      expect(role.name).toBe('SENIOR_TA');
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/roles/role-ta`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(payload);
    req.flush({
      ...mockRoles[1],
      name: 'SENIOR_TA',
      permissions: payload.permissions
    });
  });

  it('should delete a custom role', () => {
    service.deleteRole('role-ta').subscribe((res) => {
      expect(res.success).toBe(true);
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/roles/role-ta`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ success: true, message: 'Role deleted' });
  });

  it('should fetch permissions list and fall back cleanly on error', () => {
    service.getPermissions().subscribe((perms) => {
      expect(perms.length).toBeGreaterThan(0);
      expect(perms.some((p) => p.code === 'system:manage')).toBe(true);
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/permissions`);
    req.flush([], { status: 500, statusText: 'Server Error' });
  });

  it('should group permissions into 8 distinct categories', () => {
    const categories = service.groupPermissions([
      { code: 'system:manage', description: 'System' },
      { code: 'schools:read', description: 'Schools' },
      { code: 'users:invite', description: 'Users' },
      { code: 'groups:create', description: 'Groups' },
      { code: 'spaces:create', description: 'Spaces' },
      { code: 'documents:read', description: 'Documents' },
      { code: 'conversations:read', description: 'Conversations' },
      { code: 'devices:manage', description: 'Devices' }
    ]);

    expect(categories.length).toBe(8);
    expect(categories.find((c) => c.key === 'system')?.permissions.length).toBe(1);
    expect(categories.find((c) => c.key === 'users')?.permissions.length).toBe(1);
    expect(categories.find((c) => c.key === 'documents')?.permissions.length).toBe(1);
  });

  it('should correctly identify system base roles', () => {
    expect(service.isBaseRole('PLATFORM_ADMIN')).toBe(true);
    expect(service.isBaseRole('SCHOOL_ADMIN')).toBe(true);
    expect(service.isBaseRole('CONTENT_MANAGER')).toBe(true);
    expect(service.isBaseRole('STAFF')).toBe(true);
    expect(service.isBaseRole('STUDENT')).toBe(true);
    expect(service.isBaseRole('PARENT_GUEST')).toBe(true);
    expect(service.isBaseRole('TEACHING_ASSISTANT')).toBe(false);
    expect(service.isBaseRole(null)).toBe(false);
  });

  it('should extract error messages cleanly', () => {
    const errorWithArray = new HttpErrorResponse({
      error: { message: ['Role name too short', 'Scope is required'] },
      status: 400
    });
    expect(service.extractErrorMessage(errorWithArray)).toBe('Role name too short. Scope is required');

    const forbiddenError = new HttpErrorResponse({ status: 403 });
    expect(service.extractErrorMessage(forbiddenError)).toContain('Access denied');

    const conflictError = new HttpErrorResponse({ status: 409 });
    expect(service.extractErrorMessage(conflictError)).toContain('already exists');
  });
});
