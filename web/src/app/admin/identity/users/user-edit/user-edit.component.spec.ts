import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { Subject, of, throwError } from 'rxjs';
import { ADMIN_TYPE_STORAGE_KEY } from 'src/app/admin/theme/layouts/admin-layout/navigation/navigation';
import { PortalSessionService } from '../../services/portal-session.service';
import { AssignmentService } from '../../assignments/services/assignment.service';
import { ActiveSession, UserEntity, UserSchoolAssignment } from '../models/user.model';
import { UserManagementService } from '../services/user-management.service';
import { UserEditComponent } from './user-edit.component';

describe('UserEditComponent', () => {
  let component: UserEditComponent;
  let fixture: ComponentFixture<UserEditComponent>;
  let mockUserService: any;
  let mockAssignmentService: any;
  let session: PortalSessionService;

  const mockUser: UserEntity = {
    id: 'user-123',
    email: 'test@school.edu',
    fullName: 'Test User',
    authProvider: 'local',
    status: 'ACTIVE',
    createdAt: '2026-10-15T08:00:00.000Z',
    updatedAt: '2026-10-15T08:00:00.000Z'
  };

  const mockSessions: ActiveSession[] = [
    {
      id: 'session-1',
      current: true,
      device: { id: 'device-1', platform: 'windows', lastSyncAt: '2026-10-15T08:00:00.000Z' },
      ip: '192.168.1.1',
      userAgent: 'Chrome on Windows',
      createdAt: '2026-10-15T08:00:00.000Z',
      lastUsedAt: '2026-10-15T09:00:00.000Z',
      expiresAt: '2026-11-15T08:00:00.000Z'
    }
  ];

  beforeEach(async () => {
    mockUserService = {
      getUserById: vi.fn().mockReturnValue(of(mockUser)),
      getUserSessions: vi.fn().mockReturnValue(of(mockSessions)),
      updateUser: vi.fn().mockReturnValue(of({ ...mockUser, fullName: 'Updated Name' })),
      suspendUser: vi.fn().mockReturnValue(of({ ...mockUser, status: 'SUSPENDED' })),
      reactivateUser: vi.fn().mockReturnValue(of({ ...mockUser, status: 'ACTIVE' })),
      revokeSession: vi.fn().mockReturnValue(of(undefined)),
      revokeAllSessions: vi.fn().mockReturnValue(of({ revoked: 1 })),
      getAssignableRoles: vi.fn().mockReturnValue(
        of([
          { id: 'r-pa', name: 'PLATFORM_ADMIN', scope: 'platform', level: 3 },
          { id: 'r-sa', name: 'SCHOOL_ADMIN', scope: 'school', level: 2 },
          { id: 'r-staff', name: 'STAFF', scope: 'school', level: 2 },
          { id: 'r-stu', name: 'STUDENT', scope: 'group', level: 1 }
        ])
      ),
      getSchools: vi.fn().mockReturnValue(of([{ id: 'school-a', name: 'Demo School A' }])),
      assignRole: vi.fn().mockReturnValue(of(mockUser)),
      setDocumentManagement: vi.fn().mockReturnValue(of(mockUser)),
      extractErrorMessage: vi.fn().mockImplementation((_err, fallback) => fallback || 'Error')
    };

    mockAssignmentService = {
      getGroups: vi.fn().mockImplementation((schoolId: string) =>
        of([{ id: `g-${schoolId}`, schoolId, name: `Group of ${schoolId}`, type: 'class' }])
      ),
      createAssignment: vi.fn().mockReturnValue(of({})),
      updateAssignment: vi.fn().mockReturnValue(of({})),
      removeAssignment: vi.fn().mockReturnValue(of(undefined))
    };

    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [UserEditComponent],
      providers: [
        PortalSessionService,
        { provide: UserManagementService, useValue: mockUserService },
        { provide: AssignmentService, useValue: mockAssignmentService },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 'user-123' })
            }
          }
        }
      ]
    }).compileComponents();

    session = TestBed.inject(PortalSessionService);
    fixture = TestBed.createComponent(UserEditComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load user profile and sessions on init', () => {
    expect(component).toBeTruthy();
    expect(mockUserService.getUserById).toHaveBeenCalledWith('user-123');
    expect(mockUserService.getUserSessions).toHaveBeenCalledWith('user-123');
    expect(component.user()?.fullName).toBe('Test User');
    expect(component.sessions().length).toBe(1);
    expect(component.editForm.get('fullName')?.value).toBe('Test User');
    expect(component.editForm.get('email')?.value).toBe('test@school.edu');
  });

  it('should refresh only the assignments after a change', () => {
    const assignment = { id: 'as-1', schoolId: 's1', schoolName: 'A', role: 'STAFF', groupId: null, groupName: null };
    mockUserService.getUserById.mockReturnValue(of({ ...mockUser, fullName: 'Server Name', assignments: [assignment] }));
    component.refreshAssignments();
    expect(component.user()?.assignments).toEqual([assignment]);
    expect(component.user()?.fullName).toBe('Test User');
  });

  it('should validate edit form fields correctly', () => {
    component.editForm.patchValue({ fullName: '', email: 'invalid-email' });
    expect(component.editForm.invalid).toBe(true);
    expect(component.editForm.get('fullName')?.hasError('required')).toBe(true);
    expect(component.editForm.get('email')?.hasError('email')).toBe(true);

    component.editForm.patchValue({ fullName: 'Valid Name', email: 'valid@school.edu' });
    expect(component.editForm.valid).toBe(true);
  });

  it('should save edited user profile', () => {
    component.editForm.patchValue({ fullName: 'Updated Name', email: 'test@school.edu' });
    component.editForm.markAsDirty();

    component.saveProfile();

    expect(mockUserService.updateUser).toHaveBeenCalledWith('user-123', {
      fullName: 'Updated Name',
      email: 'test@school.edu'
    });
    expect(component.user()?.fullName).toBe('Updated Name');
    expect(component.successMessage()).toContain('profile updated successfully');
  });

  it('should reset form values to initial user data', () => {
    component.editForm.patchValue({ fullName: 'Modified', email: 'mod@school.edu' });
    component.resetForm();

    expect(component.editForm.get('fullName')?.value).toBe('Test User');
    expect(component.editForm.get('email')?.value).toBe('test@school.edu');
    expect(component.editForm.pristine).toBe(true);
  });

  it('should identify device icons based on platform and user agent', () => {
    expect(component.getDeviceIcon('android', '')).toBe('ti-device-mobile');
    expect(component.getDeviceIcon('ios', 'iphone')).toBe('ti-device-mobile');
    expect(component.getDeviceIcon('ipad', '')).toBe('ti-device-tablet');
    expect(component.getDeviceIcon('windows', 'Chrome')).toBe('ti-device-laptop');
  });

  it('should handle API errors and show error banner when user update fails', () => {
    mockUserService.updateUser.mockReturnValueOnce(throwError(() => new Error('Server failure')));
    component.editForm.patchValue({ fullName: 'New Name', email: 'test@school.edu' });
    component.editForm.markAsDirty();

    component.saveProfile();

    expect(component.isSaving()).toBe(false);
    expect(component.errorMessage()).toBeTruthy();
  });

  it('should open suspend modal and suspend user on confirmation, updating status badge', () => {
    component.openSuspendModal();
    expect(component.modalType()).toBe('suspend');

    component.handleModalConfirm();

    expect(mockUserService.suspendUser).toHaveBeenCalledWith('user-123');
    expect(component.user()?.status).toBe('SUSPENDED');
    expect(component.modalType()).toBeNull();
    expect(component.successMessage()).toContain('suspended');
  });

  it('should open reactivate modal and reactivate user on confirmation, updating status badge', () => {
    component.openReactivateModal();
    expect(component.modalType()).toBe('reactivate');

    component.handleModalConfirm();

    expect(mockUserService.reactivateUser).toHaveBeenCalledWith('user-123');
    expect(component.user()?.status).toBe('ACTIVE');
    expect(component.modalType()).toBeNull();
    expect(component.successMessage()).toContain('reactivated');
  });

  it('should revoke a single session on confirmation', () => {
    component.openRevokeSessionModal(mockSessions[0]);
    expect(component.modalType()).toBe('revoke-session');
    expect(component.selectedSessionToRevoke()?.id).toBe('session-1');

    component.handleModalConfirm();

    expect(mockUserService.revokeSession).toHaveBeenCalledWith('user-123', 'session-1');
    expect(component.modalType()).toBeNull();
  });

  it('should revoke all active sessions on confirmation', () => {
    component.openRevokeAllModal();
    expect(component.modalType()).toBe('revoke-all');

    component.handleModalConfirm();

    expect(mockUserService.revokeAllSessions).toHaveBeenCalledWith('user-123');
    expect(component.modalType()).toBeNull();
  });

  it('toggles document-management rights on a staff assignment and hides school selector & platform roles for a school admin (#94)', () => {
    session.setUser({
      id: 'sa-1',
      email: 'school.admin@demo.test',
      fullName: 'School A Admin',
      status: 'ACTIVE',
      role: 'SCHOOL_ADMIN',
      permissions: ['users:read', 'users:update', 'users:suspend', 'users:assign_role'],
      schoolIds: ['school-a'],
      schools: [{ id: 'school-a', name: 'Demo School A' }],
      isPlatformAdmin: false,
      assignments: []
    });

    const staffAssignment = {
      schoolId: 'school-a',
      schoolName: 'Demo School A',
      role: 'STAFF',
      groupId: null,
      groupName: null
    };
    component.user.set({
      ...mockUser,
      assignments: [staffAssignment]
    });
    fixture.detectChanges();

    // School selector is hidden for school admin; role list excludes PLATFORM_ADMIN
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#assign-school-select')).toBeNull();
    expect(component.assignableRoles().map((r) => r.name)).not.toContain('PLATFORM_ADMIN');

    // Document management toggle is rendered on staff assignment and grants CONTENT_MANAGER
    const toggle = el.querySelector('.doc-management-toggle') as HTMLInputElement | null;
    expect(toggle).not.toBeNull();
    expect(component.hasDocumentManagement(staffAssignment)).toBe(false);

    component.toggleDocumentManagement(staffAssignment, true);
    expect(mockUserService.setDocumentManagement).toHaveBeenCalledWith('user-123', 'school-a', true);
    expect(component.user()?.assignments?.[0]?.role).toBe('CONTENT_MANAGER');
  });

  describe('assignment actions in the School Assignments section (#61)', () => {
    const assignments: UserSchoolAssignment[] = [
      { id: 'as-1', schoolId: 's1', schoolName: 'School A', role: 'STAFF', groupId: 'g1', groupName: 'ISI 4' },
      { id: 'as-2', schoolId: 's2', schoolName: 'School B', role: 'STUDENT', groupId: null, groupName: null }
    ];
    let toast: GoeyToastService;

    function signIn(permissions: string[], isPlatformAdmin = true, schoolIds: string[] = []): void {
      session.setUser({
        id: 'admin-1',
        email: 'admin@demo.test',
        fullName: 'Admin',
        status: 'ACTIVE',
        role: isPlatformAdmin ? 'PLATFORM_ADMIN' : 'SCHOOL_ADMIN',
        permissions,
        schoolIds,
        schools: schoolIds.map((id) => ({ id, name: id })),
        isPlatformAdmin,
        assignments: []
      });
    }

    beforeEach(() => {
      toast = TestBed.inject(GoeyToastService);
      vi.spyOn(toast, 'success').mockImplementation(() => undefined as never);
      vi.spyOn(toast, 'error').mockImplementation(() => undefined as never);
      mockUserService.getAssignableRoles.mockReturnValue(
        of([
          { id: 'r1', name: 'STAFF', scope: 'school', level: 2 },
          { id: 'r2', name: 'PLATFORM_ADMIN', scope: 'platform', level: 3 }
        ])
      );
      signIn(['*']);
      component.schools.set([
        { id: 's1', name: 'School A' },
        { id: 's2', name: 'School B' },
        { id: 's3', name: 'School C' }
      ]);
      component.user.set({ ...mockUser, assignments });
      fixture.detectChanges();
    });

    it('shows the add button and the row actions to an admin who can assign roles', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('#btn-add-assignment')).not.toBeNull();
      expect(el.querySelectorAll('.btn-edit-assignment').length).toBe(2);
      expect(el.querySelectorAll('.btn-remove-assignment').length).toBe(2);
    });

    it('hides the add button and the row actions without users:assign_role', () => {
      signIn(['users:read'], false, ['s1']);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('#btn-add-assignment')).toBeNull();
      expect(el.querySelector('.btn-edit-assignment')).toBeNull();
      expect(component.canManageAssignments()).toBe(false);
    });

    it('does not add a separate assignments card', () => {
      expect(fixture.nativeElement.querySelector('app-user-assignments')).toBeNull();
    });

    describe('canAssign, read from PortalSessionService', () => {
      it('is true for a platform admin, even without the permission code', () => {
        signIn([], true);
        expect(component.canAssign()).toBe(true);
      });

      it('is true for the * wildcard', () => {
        signIn(['*'], false, ['s1']);
        expect(component.canAssign()).toBe(true);
      });

      it('is true for users:assign_role', () => {
        signIn(['users:read', 'users:assign_role'], false, ['s1']);
        expect(component.canAssign()).toBe(true);
      });

      it('is false for an admin who only reads users', () => {
        signIn(['users:read', 'users:update'], false, ['s1']);
        expect(component.canAssign()).toBe(false);
      });

      it('is false when nobody is signed in, whatever the browser storage says', () => {
        session.clearSession();
        localStorage.setItem(ADMIN_TYPE_STORAGE_KEY, 'platform');
        expect(component.canAssign()).toBe(false);
        expect(component.canManageAssignments()).toBe(false);
      });

      it('follows the session when the account changes, without a reload', () => {
        signIn(['users:assign_role'], false, ['s1']);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.btn-edit-assignment')).not.toBeNull();

        signIn(['users:read'], false, ['s1']);
        fixture.detectChanges();
        expect(component.canAssign()).toBe(false);
        expect(fixture.nativeElement.querySelector('.btn-edit-assignment')).toBeNull();
      });

      it('does not call GET /auth/me itself: the admin comes from the session', () => {
        expect((mockAssignmentService as Record<string, unknown>)['getCurrentAdmin']).toBeUndefined();
      });
    });

    describe('create form', () => {
      beforeEach(() => component.openCreateAssignmentForm());

      it('offers only schools where the user has no assignment yet', () => {
        expect(component.assignmentMode()).toBe('create');
        expect(component.availableSchools().map((s) => s.id)).toEqual(['s3']);
      });

      it('reloads groups and roles for the chosen school, and again when the school changes', () => {
        component.assignmentForm.controls.schoolId.setValue('s3');
        expect(mockAssignmentService.getGroups).toHaveBeenCalledWith('s3');
        expect(mockUserService.getAssignableRoles).toHaveBeenCalledWith('s3');
        expect(component.groups().map((g) => g.id)).toEqual(['g-s3']);

        component.assignmentForm.patchValue({ groupId: 'g-s3', role: 'STAFF' });
        component.assignmentForm.controls.schoolId.setValue('s9');
        expect(mockAssignmentService.getGroups).toHaveBeenLastCalledWith('s9');
        expect(component.groups().map((g) => g.id)).toEqual(['g-s9']);
        // the previous group and role no longer apply to the new school
        expect(component.assignmentForm.controls.groupId.value).toBe('');
        expect(component.assignmentForm.controls.role.value).toBe('');
      });

      it('creates the assignment with the selected school, group and role, then refreshes the list', () => {
        component.assignmentForm.controls.schoolId.setValue('s3');
        component.assignmentForm.patchValue({ groupId: 'g-s3', role: 'STAFF' });
        mockUserService.getUserById.mockClear();

        component.saveAssignment();

        expect(mockAssignmentService.createAssignment).toHaveBeenCalledWith({
          userId: 'user-123',
          schoolId: 's3',
          role: 'STAFF',
          groupId: 'g-s3'
        });
        expect(toast.success).toHaveBeenCalled();
        expect(mockUserService.getUserById).toHaveBeenCalledWith('user-123');
        expect(component.assignmentMode()).toBeNull();
      });

      it('omits the group when none is selected', () => {
        component.assignmentForm.controls.schoolId.setValue('s3');
        component.assignmentForm.patchValue({ role: 'STAFF' });
        component.saveAssignment();
        expect(mockAssignmentService.createAssignment).toHaveBeenCalledWith({
          userId: 'user-123',
          schoolId: 's3',
          role: 'STAFF'
        });
      });

      it('does not submit an incomplete form', () => {
        component.saveAssignment();
        expect(mockAssignmentService.createAssignment).not.toHaveBeenCalled();
      });

      it('clears and locks the group for a platform role', () => {
        component.assignmentForm.controls.schoolId.setValue('s3');
        component.assignmentForm.patchValue({ groupId: 'g-s3', role: 'PLATFORM_ADMIN' });
        expect(component.groupDisabled).toBe(true);
        component.onAssignmentRoleChange();
        expect(component.assignmentForm.controls.groupId.value).toBe('');
      });

      it('shows the API message in a toast on a 409 and keeps the form open', () => {
        mockAssignmentService.createAssignment.mockReturnValue(throwError(() => new Error('409')));
        mockUserService.extractErrorMessage.mockReturnValue('The user already has an assignment in this school');
        component.assignmentForm.controls.schoolId.setValue('s3');
        component.assignmentForm.patchValue({ role: 'STAFF' });

        component.saveAssignment();

        expect(toast.error).toHaveBeenCalledWith('Assignment Failed', {
          description: 'The user already has an assignment in this school'
        });
        expect(component.assignmentMode()).toBe('create');
        expect(component.isAssigningRole()).toBe(false);
      });

      it('toasts when the groups or the roles of the school cannot be loaded', () => {
        mockAssignmentService.getGroups.mockReturnValue(throwError(() => new Error('403')));
        mockUserService.extractErrorMessage.mockReturnValue('Forbidden');
        component.assignmentForm.controls.schoolId.setValue('s3');
        expect(toast.error).toHaveBeenCalledWith('Could Not Load Groups', { description: 'Forbidden' });
        expect(component.isLookupLoading()).toBe(false);
      });

      it('preselects the only school of a school admin', () => {
        // a user without any assignment yet is in the scope of a school admin
        component.user.set({ ...mockUser, assignments: [] });
        signIn(['users:assign_role'], false, ['s3']);
        component.openCreateAssignmentForm();
        expect(component.assignmentForm.controls.schoolId.value).toBe('s3');
        expect(mockAssignmentService.getGroups).toHaveBeenCalledWith('s3');
        // no school select for a school admin: the school shows as a badge
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('#assign-school-select')).toBeNull();
        expect(fixture.nativeElement.querySelector('#fixed-assign-school')).not.toBeNull();
      });
    });

    describe('edit form', () => {
      beforeEach(() => component.openEditAssignmentForm(assignments[0]));

      it('locks the school and prefills role and group', () => {
        expect(component.assignmentMode()).toBe('edit');
        expect(component.assignmentForm.controls.schoolId.disabled).toBe(true);
        expect(component.assignmentForm.getRawValue()).toEqual({ schoolId: 's1', groupId: 'g1', role: 'STAFF' });
        expect(mockUserService.getAssignableRoles).toHaveBeenCalledWith('s1');
      });

      it('needs a change before saving', () => {
        expect(component.hasAssignmentChanges()).toBe(false);
        component.saveAssignment();
        expect(mockAssignmentService.updateAssignment).not.toHaveBeenCalled();
      });

      it('sends only the changed field', () => {
        component.assignmentForm.patchValue({ groupId: '' });
        component.saveAssignment();
        expect(mockAssignmentService.updateAssignment).toHaveBeenCalledWith('as-1', { groupId: null });
      });

      it('sends the new role without touching the group', () => {
        component.assignmentForm.patchValue({ role: 'PLATFORM_ADMIN' });
        component.saveAssignment();
        expect(mockAssignmentService.updateAssignment).toHaveBeenCalledWith('as-1', { role: 'PLATFORM_ADMIN' });
      });

      it('shows the API message in a toast when the update is refused (403)', () => {
        mockAssignmentService.updateAssignment.mockReturnValue(throwError(() => new Error('403')));
        mockUserService.extractErrorMessage.mockReturnValue('You cannot assign a role above your level');
        component.assignmentForm.patchValue({ role: 'PLATFORM_ADMIN' });
        component.saveAssignment();
        expect(toast.error).toHaveBeenCalledWith('Update Failed', {
          description: 'You cannot assign a role above your level'
        });
      });
    });

    describe('selects and row actions while the form is open', () => {
      const select = (id: string) => fixture.nativeElement.querySelector(`#${id}`) as HTMLSelectElement;
      const rowButtons = () =>
        Array.from<HTMLButtonElement>(
          fixture.nativeElement.querySelectorAll('.btn-edit-assignment, .btn-remove-assignment')
        );

      it('keeps the group and role disabled until a school is selected', () => {
        component.openCreateAssignmentForm();
        fixture.detectChanges();
        const { groupId, role } = component.assignmentForm.controls;
        expect(groupId.disabled).toBe(true);
        expect(role.disabled).toBe(true);
        expect(select('assign-group-select').disabled).toBe(true);
        expect(select('assign-role-select').disabled).toBe(true);

        component.assignmentForm.controls.schoolId.setValue('s3');
        fixture.detectChanges();
        expect(groupId.enabled).toBe(true);
        expect(role.enabled).toBe(true);
        expect(select('assign-group-select').disabled).toBe(false);
        expect(select('assign-role-select').disabled).toBe(false);

        // going back to no school locks them again
        component.assignmentForm.controls.schoolId.setValue('');
        fixture.detectChanges();
        expect(groupId.disabled).toBe(true);
        expect(role.disabled).toBe(true);
      });

      it('keeps them disabled while the groups and roles load, then enables them', () => {
        const groups$ = new Subject<any[]>();
        mockAssignmentService.getGroups.mockReturnValue(groups$);
        component.openCreateAssignmentForm();
        component.assignmentForm.controls.schoolId.setValue('s3');
        fixture.detectChanges();

        const { groupId, role } = component.assignmentForm.controls;
        expect(component.isLookupLoading()).toBe(true);
        expect(groupId.disabled).toBe(true);
        expect(role.disabled).toBe(true);
        expect(select('assign-role-select').disabled).toBe(true);

        groups$.next([{ id: 'g3', schoolId: 's3', name: 'G3', type: 'class' }]);
        groups$.complete();
        fixture.detectChanges();
        expect(component.isLookupLoading()).toBe(false);
        expect(groupId.enabled).toBe(true);
        expect(role.enabled).toBe(true);
        expect(select('assign-role-select').disabled).toBe(false);
      });

      it('shows on the select the state of its form control', () => {
        component.openCreateAssignmentForm();
        component.assignmentForm.controls.schoolId.setValue('s3');
        component.assignmentForm.controls.groupId.disable({ emitEvent: false });
        fixture.detectChanges();
        expect(select('assign-group-select').disabled).toBe(true);
        component.assignmentForm.controls.groupId.enable({ emitEvent: false });
        fixture.detectChanges();
        expect(select('assign-group-select').disabled).toBe(false);
      });

      it('locks the group for a platform role and unlocks it again for another role', () => {
        component.openCreateAssignmentForm();
        component.assignmentForm.controls.schoolId.setValue('s3');
        component.assignmentForm.patchValue({ groupId: 'g-s3', role: 'PLATFORM_ADMIN' });
        component.onAssignmentRoleChange();
        expect(component.assignmentForm.controls.groupId.disabled).toBe(true);
        expect(component.assignmentForm.controls.groupId.value).toBe('');

        component.assignmentForm.patchValue({ role: 'STAFF' });
        component.onAssignmentRoleChange();
        expect(component.assignmentForm.controls.groupId.enabled).toBe(true);
      });

      it('submits the raw values, including those of disabled controls', () => {
        component.openCreateAssignmentForm();
        component.assignmentForm.controls.schoolId.setValue('s3');
        component.assignmentForm.patchValue({ groupId: 'g-s3', role: 'PLATFORM_ADMIN' });
        component.onAssignmentRoleChange();
        const rawValue = vi.spyOn(component.assignmentForm, 'getRawValue');

        component.saveAssignment();

        expect(rawValue).toHaveBeenCalled();
        // the group is disabled (and emptied) for a platform role, the school and role still go through
        expect(mockAssignmentService.createAssignment).toHaveBeenCalledWith({
          userId: 'user-123',
          schoolId: 's3',
          role: 'PLATFORM_ADMIN'
        });
      });

      it('edit mode sends the changes although the school control is disabled', () => {
        component.openEditAssignmentForm(assignments[0]);
        expect(component.assignmentForm.controls.schoolId.disabled).toBe(true);
        component.assignmentForm.patchValue({ role: 'PLATFORM_ADMIN' });
        component.saveAssignment();
        expect(mockAssignmentService.updateAssignment).toHaveBeenCalledWith('as-1', { role: 'PLATFORM_ADMIN' });
      });

      it('does not save while the groups and roles are still loading', () => {
        mockAssignmentService.getGroups.mockReturnValue(new Subject<any[]>());
        component.openCreateAssignmentForm();
        component.assignmentForm.controls.schoolId.setValue('s3');
        component.assignmentForm.patchValue({ role: 'STAFF' });
        component.saveAssignment();
        expect(mockAssignmentService.createAssignment).not.toHaveBeenCalled();
      });

      it('enables the Edit and Remove buttons when no form is open', () => {
        const buttons = rowButtons();
        expect(buttons.length).toBe(4);
        expect(buttons.every((b) => !b.disabled)).toBe(true);
      });

      it('disables the Edit and Remove buttons while the create form is open, and enables them on cancel', () => {
        component.openCreateAssignmentForm();
        fixture.detectChanges();
        expect(rowButtons().every((b) => b.disabled)).toBe(true);

        component.closeAssignmentForm();
        fixture.detectChanges();
        expect(rowButtons().every((b) => !b.disabled)).toBe(true);
      });

      it('disables the Edit and Remove buttons while the edit form is open', () => {
        component.openEditAssignmentForm(assignments[0]);
        fixture.detectChanges();
        expect(rowButtons().every((b) => b.disabled)).toBe(true);
      });

      it('ignores an edit request while a form is already open', () => {
        component.openCreateAssignmentForm();
        component.openEditAssignmentForm(assignments[0]);
        expect(component.assignmentMode()).toBe('create');
        expect(component.editingAssignment()).toBeNull();
      });

      it('disables the document-management toggle while an assignment form is open', () => {
        const staffRow: UserSchoolAssignment = {
          id: 'as-staff',
          schoolId: 's1',
          schoolName: 'School A',
          role: 'STAFF',
          groupId: null,
          groupName: null
        };
        component.user.set({ ...mockUser, assignments: [staffRow] });
        fixture.detectChanges();

        const toggle = () => fixture.nativeElement.querySelector('.doc-management-toggle') as HTMLInputElement;
        expect(toggle().disabled).toBe(false);

        component.openCreateAssignmentForm();
        fixture.detectChanges();
        expect(toggle().disabled).toBe(true);

        mockUserService.setDocumentManagement.mockClear();
        component.toggleDocumentManagement(staffRow, true);
        expect(mockUserService.setDocumentManagement).not.toHaveBeenCalled();
      });

      it('falls back to schools() or schoolId in getAssignmentSchoolName instead of activeSchoolName', () => {
        signIn(['users:assign_role'], false, ['s1', 's2']);
        session.selectSchool('s1');
        expect(
          component.getAssignmentSchoolName({ id: 'a-missing', schoolId: 'unknown-school', role: 'STAFF' })
        ).toBe('unknown-school');
        expect(
          component.getAssignmentSchoolName({ id: 'a-known', schoolId: 's2', role: 'STAFF' })
        ).toBe('School B');
      });

      it('keeps formSchoolName aligned with assignmentForm schoolId if the active school changes', () => {
        component.user.set({ ...mockUser, assignments: [] });
        session.setUser({
          id: 'admin-1',
          email: 'admin@demo.test',
          fullName: 'Admin',
          status: 'ACTIVE',
          role: 'SCHOOL_ADMIN',
          permissions: ['users:assign_role'],
          schoolIds: ['s1', 's2'],
          schools: [
            { id: 's1', name: 'School A' },
            { id: 's2', name: 'School B' }
          ],
          isPlatformAdmin: false,
          assignments: [
            { role: 'SCHOOL_ADMIN', scope: 'school', schoolId: 's1', groupId: null, permissions: ['users:assign_role'] },
            { role: 'SCHOOL_ADMIN', scope: 'school', schoolId: 's2', groupId: null, permissions: ['users:assign_role'] }
          ]
        });
        session.selectSchool('s1');
        component.openCreateAssignmentForm();
        expect(component.assignmentForm.controls.schoolId.value).toBe('s1');
        expect(component.formSchoolName()).toBe('School A');

        session.selectSchool('s2');
        fixture.detectChanges();
        expect(component.assignmentForm.controls.schoolId.value).toBe('s2');
        expect(component.formSchoolName()).toBe('School B');
      });
    });

    describe('remove', () => {
      it('asks for confirmation, removes the assignment and refreshes the list', () => {
        mockUserService.getUserById.mockClear();
        component.openRemoveAssignmentModal(assignments[0]);
        expect(component.modalType()).toBe('remove-assignment');
        expect(component.assignmentToRemove()).toEqual(assignments[0]);

        component.handleModalConfirm();

        expect(mockAssignmentService.removeAssignment).toHaveBeenCalledWith('as-1');
        expect(toast.success).toHaveBeenCalled();
        expect(mockUserService.getUserById).toHaveBeenCalledWith('user-123');
        expect(component.modalType()).toBeNull();
        expect(component.assignmentToRemove()).toBeNull();
      });

      it('shows the API message in a toast when removal fails (409 last school admin)', () => {
        mockAssignmentService.removeAssignment.mockReturnValue(throwError(() => new Error('409')));
        mockUserService.extractErrorMessage.mockReturnValue('The last school administrator cannot be removed');
        mockUserService.getUserById.mockClear();

        component.openRemoveAssignmentModal(assignments[0]);
        component.handleModalConfirm();

        expect(toast.error).toHaveBeenCalledWith('Removal Failed', {
          description: 'The last school administrator cannot be removed'
        });
        expect(mockUserService.getUserById).not.toHaveBeenCalled();
        expect(component.modalType()).toBeNull();
      });

      it('does not remove when the modal is cancelled', () => {
        component.openRemoveAssignmentModal(assignments[0]);
        component.closeModal();
        expect(component.assignmentToRemove()).toBeNull();
        expect(mockAssignmentService.removeAssignment).not.toHaveBeenCalled();
      });

      it('cannot be started while the create or edit form is open', () => {
        component.openEditAssignmentForm(assignments[0]);
        component.openRemoveAssignmentModal(assignments[1]);
        expect(component.modalType()).toBeNull();
        expect(component.assignmentToRemove()).toBeNull();
      });
    });
  });
});
