import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { of, throwError } from 'rxjs';
import { RoleEntity } from '../models/role.model';
import { RoleManagementService } from '../services/role-management.service';
import { RoleListComponent } from './role-list.component';

describe('RoleListComponent', () => {
  let component: RoleListComponent;
  let fixture: ComponentFixture<RoleListComponent>;
  let roleService: {
    getRoles: ReturnType<typeof vi.fn>;
    getPermissions: ReturnType<typeof vi.fn>;
    deleteRole: ReturnType<typeof vi.fn>;
    groupPermissions: ReturnType<typeof vi.fn>;
    extractErrorMessage: ReturnType<typeof vi.fn>;
    isBaseRole: ReturnType<typeof vi.fn>;
  };
  let router: Router;
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; warning: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };

  const mockRoles: RoleEntity[] = [
    {
      id: 'role-base-1',
      name: 'PLATFORM_ADMIN',
      scope: 'platform',
      permissions: ['system:manage', 'audit:read'],
      assignedUsersCount: 1,
      isBase: true,
      createdAt: '2026-10-17T12:00:00Z',
      updatedAt: '2026-10-17T12:00:00Z'
    },
    {
      id: 'role-base-2',
      name: 'SCHOOL_ADMIN',
      scope: 'school',
      permissions: ['users:read', 'schools:read'],
      assignedUsersCount: 5,
      isBase: true,
      createdAt: '2026-10-17T12:00:00Z',
      updatedAt: '2026-10-17T12:00:00Z'
    },
    {
      id: 'role-custom-1',
      name: 'TEACHING_ASSISTANT',
      scope: 'school',
      permissions: ['documents:read'],
      assignedUsersCount: 2,
      isBase: false,
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-01T10:00:00Z'
    }
  ];

  beforeEach(async () => {
    roleService = {
      getRoles: vi.fn().mockReturnValue(of(mockRoles)),
      getPermissions: vi.fn().mockReturnValue(of([{ code: 'system:manage', description: 'System' }])),
      deleteRole: vi.fn().mockReturnValue(of({ success: true, message: 'Deleted' })),
      groupPermissions: vi.fn().mockReturnValue([]),
      extractErrorMessage: vi.fn().mockReturnValue('Error message'),
      isBaseRole: vi.fn().mockImplementation((name: string) => name === 'PLATFORM_ADMIN' || name === 'SCHOOL_ADMIN')
    };

    toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [RoleListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: RoleManagementService, useValue: roleService },
        { provide: GoeyToastService, useValue: toast }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));

    fixture = TestBed.createComponent(RoleListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should initialize and load roles and metrics', () => {
    expect(component.roles().length).toBe(3);
    expect(component.totalRolesCount()).toBe(3);
    expect(component.baseRolesCount()).toBe(2);
    expect(component.customRolesCount()).toBe(1);
    expect(component.isLoading()).toBe(false);
  });

  it('should filter roles by search query', () => {
    component.onSearchChange('ASSISTANT');
    expect(component.filteredRoles().length).toBe(1);
    expect(component.filteredRoles()[0].name).toBe('TEACHING_ASSISTANT');
  });

  it('should filter roles by type (Base vs Custom)', () => {
    component.setTypeFilter('BASE');
    expect(component.filteredRoles().length).toBe(2);
    expect(component.filteredRoles().every((r) => r.isBase)).toBe(true);

    component.setTypeFilter('CUSTOM');
    expect(component.filteredRoles().length).toBe(1);
    expect(component.filteredRoles()[0].name).toBe('TEACHING_ASSISTANT');
  });

  it('should filter roles by scope', () => {
    component.setScopeFilter('platform');
    expect(component.filteredRoles().length).toBe(1);
    expect(component.filteredRoles()[0].name).toBe('PLATFORM_ADMIN');

    component.setScopeFilter('school');
    expect(component.filteredRoles().length).toBe(2);
  });

  it('should reset all filters', () => {
    component.onSearchChange('ASSISTANT');
    component.setScopeFilter('school');
    component.setTypeFilter('CUSTOM');
    expect(component.filteredRoles().length).toBe(1);

    component.resetFilters();
    expect(component.searchTerm()).toBe('');
    expect(component.selectedScope()).toBe('ALL');
    expect(component.selectedType()).toBe('ALL');
    expect(component.filteredRoles().length).toBe(3);
  });

  it('should navigate to create role page', () => {
    component.navigateToCreate();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/roles/create']);
  });

  it('should prevent editing base roles and show information toast', () => {
    component.navigateToEdit(mockRoles[0]);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      'System Base Role',
      expect.objectContaining({ description: expect.stringContaining('immutable') })
    );
  });

  it('should navigate to edit custom role', () => {
    component.navigateToEdit(mockRoles[2]);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/roles', 'role-custom-1', 'edit']);
  });

  it('should open delete modal for custom role and prevent for base role', () => {
    // Attempt on base role
    component.openDeleteModal(mockRoles[0]);
    expect(component.isDeleteModalOpen()).toBe(false);
    expect(toast.warning).toHaveBeenCalled();

    // Custom role
    component.openDeleteModal(mockRoles[2]);
    expect(component.isDeleteModalOpen()).toBe(true);
    expect(component.roleToDelete()?.id).toBe('role-custom-1');
  });

  it('should execute delete custom role upon confirmation', () => {
    component.openDeleteModal(mockRoles[2]);
    component.confirmDelete();

    expect(roleService.deleteRole).toHaveBeenCalledWith('role-custom-1');
    expect(component.isDeleteModalOpen()).toBe(false);
    expect(component.roles().length).toBe(2);
    expect(toast.success).toHaveBeenCalled();
  });

  it('should handle deletion error when role is in use', () => {
    roleService.deleteRole.mockReturnValueOnce(throwError(() => ({ status: 400 })));
    component.openDeleteModal(mockRoles[2]);
    component.confirmDelete();

    expect(roleService.deleteRole).toHaveBeenCalledWith('role-custom-1');
    expect(component.isDeleting()).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });
});
