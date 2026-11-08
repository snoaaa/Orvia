import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { of, throwError } from 'rxjs';
import { RoleEntity } from '../models/role.model';
import { RoleManagementService } from '../services/role-management.service';
import { RoleEditComponent } from './role-edit.component';

describe('RoleEditComponent', () => {
  let component: RoleEditComponent;
  let fixture: ComponentFixture<RoleEditComponent>;
  let roleService: {
    getRoleById: ReturnType<typeof vi.fn>;
    getPermissions: ReturnType<typeof vi.fn>;
    createRole: ReturnType<typeof vi.fn>;
    updateRole: ReturnType<typeof vi.fn>;
    deleteRole: ReturnType<typeof vi.fn>;
    groupPermissions: ReturnType<typeof vi.fn>;
    extractErrorMessage: ReturnType<typeof vi.fn>;
    isBaseRole: ReturnType<typeof vi.fn>;
  };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warning: ReturnType<typeof vi.fn> };
  let activatedRouteMock: { snapshot: { paramMap: { get: ReturnType<typeof vi.fn> } } };

  const mockPermissions = [
    { code: 'system:manage', description: 'System Manage' },
    { code: 'schools:read', description: 'Read Schools' },
    { code: 'documents:read', description: 'Read Documents' },
    { code: 'documents:create', description: 'Create Documents' }
  ];

  const mockCustomRole: RoleEntity = {
    id: 'role-ta',
    name: 'TEACHING_ASSISTANT',
    scope: 'school',
    permissions: ['documents:read', 'documents:create'],
    assignedUsersCount: 2,
    isBase: false,
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z'
  };

  const mockBaseRole: RoleEntity = {
    id: 'role-base',
    name: 'PLATFORM_ADMIN',
    scope: 'platform',
    permissions: ['system:manage'],
    assignedUsersCount: 1,
    isBase: true,
    createdAt: '2026-10-17T12:00:00Z',
    updatedAt: '2026-10-17T12:00:00Z'
  };

  beforeEach(async () => {
    roleService = {
      getRoleById: vi.fn().mockReturnValue(of(mockCustomRole)),
      getPermissions: vi.fn().mockReturnValue(of(mockPermissions)),
      createRole: vi.fn().mockReturnValue(of(mockCustomRole)),
      updateRole: vi.fn().mockReturnValue(of(mockCustomRole)),
      deleteRole: vi.fn().mockReturnValue(of({ success: true, message: 'Deleted' })),
      groupPermissions: vi.fn().mockReturnValue([
        {
          key: 'documents',
          title: 'Documents',
          icon: 'ti-file-text',
          description: 'Doc operations',
          permissions: [
            { code: 'documents:read', description: 'Read Documents' },
            { code: 'documents:create', description: 'Create Documents' }
          ]
        }
      ]),
      extractErrorMessage: vi.fn().mockReturnValue('Extracted error message'),
      isBaseRole: vi.fn().mockImplementation((name: string) => name === 'PLATFORM_ADMIN')
    };

    router = { navigate: vi.fn() };
    toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
    activatedRouteMock = {
      snapshot: {
        paramMap: {
          get: vi.fn().mockReturnValue('create')
        }
      }
    };

    await TestBed.configureTestingModule({
      imports: [RoleEditComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RoleManagementService, useValue: roleService },
        { provide: Router, useValue: router },
        { provide: GoeyToastService, useValue: toast },
        { provide: ActivatedRoute, useValue: activatedRouteMock }
      ]
    }).compileComponents();
  });

  describe('Create Mode', () => {
    beforeEach(() => {
      activatedRouteMock.snapshot.paramMap.get.mockReturnValue('create');
      fixture = TestBed.createComponent(RoleEditComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('initializes in create mode with empty form and permissions', () => {
      expect(component.isCreateMode()).toBe(true);
      expect(component.isReadOnly()).toBe(false);
      expect(component.roleForm.get('name')?.value).toBe('');
      expect(component.roleForm.get('scope')?.value).toBe('school');
    });

    it('toggles permission selection correctly', () => {
      expect(component.isPermissionSelected('documents:read')).toBe(false);
      component.togglePermission('documents:read');
      expect(component.isPermissionSelected('documents:read')).toBe(true);
      component.togglePermission('documents:read');
      expect(component.isPermissionSelected('documents:read')).toBe(false);
    });

    it('selects all and clears all permissions', () => {
      component.selectAllPermissions();
      expect(component.totalSelectedCount()).toBe(4);

      component.clearAllPermissions();
      expect(component.totalSelectedCount()).toBe(0);
    });

    it('switches category tabs and filters displayed categories', () => {
      expect(component.activeCategoryTab()).toBe('all');
      expect(component.displayedCategories().length).toBe(1);

      component.activeCategoryTab.set('nonexistent');
      expect(component.displayedCategories().length).toBe(0);

      component.activeCategoryTab.set('documents');
      expect(component.displayedCategories().length).toBe(1);
    });

    it('resets form back to pristine initial state in create mode', () => {
      expect(component.isDirty()).toBe(false);
      component.roleForm.patchValue({ name: 'DRAFT_ROLE', scope: 'platform' });
      component.togglePermission('documents:read');
      expect(component.isDirty()).toBe(true);

      component.resetForm();
      expect(component.roleForm.get('name')?.value).toBe('');
      expect(component.roleForm.get('scope')?.value).toBe('school');
      expect(component.totalSelectedCount()).toBe(0);
      expect(component.isDirty()).toBe(false);
    });

    it('creates a new role successfully when valid', () => {
      component.roleForm.patchValue({
        name: 'INSTRUCTOR',
        scope: 'school'
      });
      component.togglePermission('documents:read');

      component.onSave();

      expect(roleService.createRole).toHaveBeenCalledWith({
        name: 'INSTRUCTOR',
        scope: 'school',
        permissions: ['documents:read']
      });
      expect(toast.success).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/roles']);
    });
  });

  describe('Edit Mode (Custom Role)', () => {
    beforeEach(() => {
      activatedRouteMock.snapshot.paramMap.get.mockReturnValue('role-ta');
      fixture = TestBed.createComponent(RoleEditComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('loads custom role and populates form and permissions', () => {
      expect(component.isCreateMode()).toBe(false);
      expect(component.isReadOnly()).toBe(false);
      expect(component.roleForm.get('name')?.value).toBe('TEACHING_ASSISTANT');
      expect(component.roleForm.get('scope')?.value).toBe('school');
      expect(component.isPermissionSelected('documents:read')).toBe(true);
    });

    it('tracks dirty state and resets back to loaded values in edit mode', () => {
      expect(component.isDirty()).toBe(false);

      component.roleForm.patchValue({ name: 'MODIFIED_NAME' });
      expect(component.isDirty()).toBe(true);

      component.resetForm();
      expect(component.roleForm.get('name')?.value).toBe('TEACHING_ASSISTANT');
      expect(component.roleForm.get('scope')?.value).toBe('school');
      expect(component.isDirty()).toBe(false);

      // Test permission dirty state
      component.togglePermission('documents:read'); // uncheck
      expect(component.isDirty()).toBe(true);

      component.resetForm();
      expect(component.isPermissionSelected('documents:read')).toBe(true);
      expect(component.isDirty()).toBe(false);
    });

    it('updates custom role successfully', () => {
      component.roleForm.patchValue({
        name: 'LEAD_TA',
        scope: 'group'
      });

      component.onSave();

      expect(roleService.updateRole).toHaveBeenCalledWith('role-ta', {
        name: 'LEAD_TA',
        scope: 'group',
        permissions: expect.arrayContaining(['documents:read', 'documents:create'])
      });
      expect(toast.success).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/roles']);
    });

    it('deletes custom role upon confirmation', () => {
      component.openDeleteModal();
      expect(component.isDeleteModalOpen()).toBe(true);

      component.confirmDelete();
      expect(roleService.deleteRole).toHaveBeenCalledWith('role-ta');
      expect(toast.success).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/roles']);
    });
  });

  describe('Read-Only Mode (System Base Role)', () => {
    beforeEach(() => {
      roleService.getRoleById.mockReturnValue(of(mockBaseRole));
      activatedRouteMock.snapshot.paramMap.get.mockReturnValue('role-base');
      fixture = TestBed.createComponent(RoleEditComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('enforces read-only protection for system base roles', () => {
      expect(component.isCreateMode()).toBe(false);
      expect(component.isReadOnly()).toBe(true);
      expect(component.roleForm.disabled).toBe(true);
    });

    it('blocks toggling permissions when in read-only mode', () => {
      component.togglePermission('documents:read');
      expect(component.isPermissionSelected('documents:read')).toBe(false);

      component.selectAllPermissions();
      expect(component.totalSelectedCount()).toBe(1); // Only system:manage from base role
    });

    it('prevents saving or opening delete modal for base role', () => {
      component.onSave();
      expect(roleService.updateRole).not.toHaveBeenCalled();

      component.openDeleteModal();
      expect(component.isDeleteModalOpen()).toBe(false);
    });
  });
});

