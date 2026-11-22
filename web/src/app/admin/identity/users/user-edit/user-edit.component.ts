import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { catchError, forkJoin, of, switchMap, tap } from 'rxjs';
import { CardComponent } from '../../../theme/shared/components/card/card.component';
import { GroupOption, UpdateAssignmentPayload } from '../../assignments/models/assignment.model';
import { AssignmentService } from '../../assignments/services/assignment.service';
import { PortalSessionService } from '../../services/portal-session.service';
import { ConfirmationModalComponent } from '../components/confirmation-modal/confirmation-modal.component';
import {
  ActiveSession,
  AssignableRoleOption,
  SchoolSummaryOption,
  UserEntity,
  UserSchoolAssignment
} from '../models/user.model';
import { UserManagementService } from '../services/user-management.service';

@Component({
  selector: 'app-user-edit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule,
    CardComponent,
    ConfirmationModalComponent
  ],
  templateUrl: './user-edit.component.html',
  styleUrls: ['./user-edit.component.scss']
})
export class UserEditComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserManagementService);
  private readonly assignmentService = inject(AssignmentService);
  private readonly toast = inject(GoeyToastService);
  readonly session = inject(PortalSessionService);

  readonly userId = signal<string>('');
  readonly user = signal<UserEntity | null>(null);
  readonly sessions = signal<ActiveSession[]>([]);
  readonly isLoading = signal<boolean>(true);
  readonly isSaving = signal<boolean>(false);
  readonly isSessionsLoading = signal<boolean>(false);
  readonly copiedId = signal<boolean>(false);

  // Role assignment & document management state (#94)
  readonly rawRoles = signal<AssignableRoleOption[]>([]);
  readonly schools = signal<SchoolSummaryOption[]>([]);
  readonly isAssigningRole = signal<boolean>(false);
  readonly isTogglingDocMgmt = signal<boolean>(false);

  // Create, edit and remove an assignment (#61), inside the School Assignments section
  readonly assignmentMode = signal<'create' | 'edit' | null>(null);
  readonly editingAssignment = signal<UserSchoolAssignment | null>(null);
  readonly assignmentToRemove = signal<UserSchoolAssignment | null>(null);
  readonly groups = signal<GroupOption[]>([]);
  readonly isLookupLoading = signal<boolean>(false);

  readonly assignmentForm = this.fb.nonNullable.group({
    schoolId: ['', Validators.required],
    groupId: [''],
    role: ['', Validators.required]
  });

  /** Values to apply once the groups and roles of the edited school have loaded. */
  private pendingEdit: { role: string; groupId: string } | null = null;

  /**
   * Roles the signed-in admin may assign (#94):
   * platform-scoped roles are filtered out for school admins.
   */
  readonly assignableRoles = computed<AssignableRoleOption[]>(() => {
    const isPlatform = this.session.isPlatformAdmin();
    return this.rawRoles().filter((r) => isPlatform || r.scope !== 'platform');
  });

  /**
   * Assignments visible to the current administrator:
   * platform admins see all school assignments; school admins see only their school's assignments.
   */
  readonly visibleAssignments = computed<UserSchoolAssignment[]>(() => {
    const list = this.user()?.assignments ?? [];
    if (this.session.isPlatformAdmin()) return list;
    const adminSchools = this.session.user()?.schoolIds ?? [];
    if (adminSchools.length === 0) return list;
    return list.filter((a) => adminSchools.includes(a.schoolId));
  });

  /** Schools the admin can assign in: every school for a platform admin, the active school otherwise. */
  private readonly assignableSchools = computed<SchoolSummaryOption[]>(() => {
    if (this.session.isPlatformAdmin()) return this.schools();
    const id = this.session.activeSchoolId();
    return id ? [{ id, name: this.session.activeSchoolName() ?? id }] : [];
  });

  /** A user has at most one assignment per school, so schools already used are not offered when adding. */
  readonly availableSchools = computed<SchoolSummaryOption[]>(() => {
    const used = new Set((this.user()?.assignments ?? []).map((a) => a.schoolId));
    return this.assignableSchools().filter((s) => !used.has(s.id));
  });

  /** Options of the school select: the locked school of the assignment being edited, or the free schools. */
  readonly schoolOptions = computed<SchoolSummaryOption[]>(() => {
    const editing = this.editingAssignment();
    if (!editing) return this.availableSchools();
    return [{ id: editing.schoolId, name: this.getAssignmentSchoolName(editing) }];
  });

  /**
   * True when the signed-in admin may create, edit and remove assignments (#61): a platform admin, the `*`
   * wildcard or the `users:assign_role` permission, read from PortalSessionService (GET /auth/me). Nobody
   * signed in means no access, whatever the browser storage says.
   */
  readonly canAssign = computed<boolean>(() => {
    if (!this.session.user()) return false;
    if (this.session.isPlatformAdmin()) return true;
    const permissions = this.session.activePermissions();
    return permissions.includes('*') || permissions.includes('users:assign_role');
  });

  /** Name of the school the form works on, shown as a badge when the school select is hidden. */
  readonly formSchoolName = computed<string | null>(() => {
    const editing = this.editingAssignment();
    return editing ? this.getAssignmentSchoolName(editing) : this.session.activeSchoolName();
  });

  readonly successMessage = signal<string>('');
  readonly errorMessage = signal<string>('');
  readonly sessionSuccessMessage = signal<string>('');
  readonly sessionErrorMessage = signal<string>('');

  readonly modalType = signal<'suspend' | 'reactivate' | 'revoke-session' | 'revoke-all' | 'remove-assignment' | null>(null);
  readonly modalLoading = signal<boolean>(false);
  readonly selectedSessionToRevoke = signal<ActiveSession | null>(null);

  editForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(150)]]
  });

  constructor() {
    // The groups and the assignable roles follow the school; switchMap drops stale answers when it changes quickly.
    this.assignmentForm.controls.schoolId.valueChanges
      .pipe(
        takeUntilDestroyed(),
        tap(() => {
          this.groups.set([]);
          this.rawRoles.set([]);
          this.assignmentForm.patchValue({ groupId: '', role: '' }, { emitEvent: false });
        }),
        switchMap((schoolId) => {
          if (!schoolId) {
            return of({ groups: [] as GroupOption[], roles: [] as AssignableRoleOption[] });
          }
          this.isLookupLoading.set(true);
          return forkJoin({
            groups: this.assignmentService.getGroups(schoolId).pipe(
              catchError((error) => {
                this.notifyAssignmentError('Could Not Load Groups', error, 'Failed to load the groups of this school.');
                return of([] as GroupOption[]);
              })
            ),
            roles: this.userService.getAssignableRoles(schoolId).pipe(
              catchError((error) => {
                this.notifyAssignmentError('Could Not Load Roles', error, 'Failed to load the assignable roles.');
                return of([] as AssignableRoleOption[]);
              })
            )
          });
        })
      )
      .subscribe(({ groups, roles }) => {
        this.groups.set(groups);
        this.rawRoles.set(roles);
        this.isLookupLoading.set(false);
        if (this.pendingEdit) {
          this.assignmentForm.patchValue(this.pendingEdit);
          this.assignmentForm.markAsPristine();
          this.pendingEdit = null;
        }
      });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      void this.router.navigate(['/admin/users']);
      return;
    }
    this.userId.set(id);
    this.loadUserData(id);
    this.loadUserSessions(id);
    this.loadRoleAndSchoolOptions();
  }

  loadRoleAndSchoolOptions(): void {
    const fixedSchool = this.session.isPlatformAdmin()
      ? undefined
      : (this.session.activeSchoolId() ?? undefined);

    if (typeof this.userService.getAssignableRoles === 'function') {
      this.userService.getAssignableRoles(fixedSchool).subscribe({
        next: (roles) => {
          this.rawRoles.set(roles);
        },
        error: () => {}
      });
    }

    if (this.session.isPlatformAdmin() && typeof this.userService.getSchools === 'function') {
      this.userService.getSchools().subscribe({
        next: (schools) => {
          this.schools.set(schools);
        },
        error: () => {}
      });
    }
  }

  loadUserData(id: string): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.userService.getUserById(id).subscribe({
      next: (userData) => {
        this.user.set(userData);
        this.editForm.patchValue({
          fullName: userData.fullName,
          email: userData.email
        });
        this.editForm.markAsPristine();
        this.isLoading.set(false);
      },
      error: (error) => {
        this.isLoading.set(false);
        this.errorMessage.set(this.userService.extractErrorMessage(error, 'Failed to load user details.'));
      }
    });
  }

  loadUserSessions(id: string): void {
    this.isSessionsLoading.set(true);
    this.sessionErrorMessage.set('');

    this.userService.getUserSessions(id).subscribe({
      next: (sessionsData) => {
        this.sessions.set(sessionsData);
        this.isSessionsLoading.set(false);
      },
      error: (error) => {
        this.isSessionsLoading.set(false);
        this.sessionErrorMessage.set(
          this.userService.extractErrorMessage(error, 'Could not retrieve user sessions.')
        );
      }
    });
  }

  getAssignmentRoleName(a: UserSchoolAssignment): string {
    if (!a.role) return '';
    return typeof a.role === 'string' ? a.role : a.role.name;
  }

  getAssignmentSchoolName(a: UserSchoolAssignment): string {
    return a.schoolName || a.school?.name || this.session.activeSchoolName() || a.schoolId;
  }

  /**
   * True when the assignment is a staff role (`STAFF` or `CONTENT_MANAGER`),
   * making it eligible for the 'Document management' toggle (#94).
   */
  isStaffAssignment(a: UserSchoolAssignment): boolean {
    const roleName = this.getAssignmentRoleName(a).toUpperCase();
    return roleName === 'STAFF' || roleName === 'CONTENT_MANAGER';
  }

  /**
   * True when the staff assignment currently holds document-management rights (`CONTENT_MANAGER`).
   */
  hasDocumentManagement(a: UserSchoolAssignment): boolean {
    return this.getAssignmentRoleName(a).toUpperCase() === 'CONTENT_MANAGER';
  }

  /**
   * True when the signed-in administrator may edit/manage the viewed user (#94):
   * school admins cannot touch platform admins or users outside their school.
   */
  canTouchCurrentUser(): boolean {
    const target = this.user();
    if (!target) return false;
    if (this.session.isPlatformAdmin()) return true;

    const assignments = target.assignments ?? [];
    const hasPlatformRole = assignments.some((a) => {
      const roleName = this.getAssignmentRoleName(a).toUpperCase();
      const scope = a.roleScope || (typeof a.role === 'object' ? a.role?.scope : undefined);
      return roleName === 'PLATFORM_ADMIN' || scope === 'platform';
    });
    if (hasPlatformRole) return false;

    const adminSchools = this.session.user()?.schoolIds ?? [];
    if (adminSchools.length > 0 && assignments.length > 0) {
      return assignments.some((a) => adminSchools.includes(a.schoolId));
    }
    return true;
  }

  /**
   * True when the signed-in administrator may suspend or reactivate the viewed user (#94):
   * nobody can suspend their own account, and school admins cannot act on higher-level admins.
   */
  canChangeCurrentUserStatus(): boolean {
    const target = this.user();
    if (!target || !this.canTouchCurrentUser()) return false;
    const currentUserId = this.session.user()?.id;
    if (currentUserId && target.id === currentUserId) return false;
    return this.session.hasPermission('users:suspend');
  }

  /**
   * Toggles document-management rights (`documents:manage`) on a staff assignment (#88, #94).
   */
  toggleDocumentManagement(assignment: UserSchoolAssignment, granted: boolean): void {
    if (this.isTogglingDocMgmt() || !this.canTouchCurrentUser()) return;

    this.isTogglingDocMgmt.set(true);
    this.userService.setDocumentManagement(this.userId(), assignment.schoolId, granted).subscribe({
      next: () => {
        const nextRole = granted ? 'CONTENT_MANAGER' : 'STAFF';
        this.user.update((current) => {
          if (!current) return current;
          const updatedAssignments = (current.assignments ?? []).map((a) =>
            a.schoolId === assignment.schoolId ? { ...a, role: nextRole } : a
          );
          return { ...current, assignments: updatedAssignments };
        });
        this.isTogglingDocMgmt.set(false);
        this.toast.success(
          granted ? 'Document Management Granted' : 'Document Management Revoked',
          {
            description: granted
              ? 'Staff member can now access the web portal to manage spaces and documents.'
              : 'Document-management portal rights have been removed.'
          }
        );
      },
      error: (error) => {
        this.isTogglingDocMgmt.set(false);
        const msg = this.userService.extractErrorMessage(
          error,
          'Could not update document-management permission.'
        );
        this.toast.error('Permission Update Failed', { description: msg });
      }
    });
  }

  /** Detail line of the remove-assignment confirmation: role, school and group. */
  removeAssignmentDetail(): string {
    const a = this.assignmentToRemove();
    if (!a) return '';
    return [this.getAssignmentRoleName(a), this.getAssignmentSchoolName(a), a.groupName].filter(Boolean).join(' · ');
  }

  /** True when the signed-in administrator may create, edit and remove this user's assignments. */
  canManageAssignments(): boolean {
    return this.canTouchCurrentUser() && this.canAssign();
  }

  /** The group of an assignment is not allowed on a platform role: the API rejects it. */
  get groupDisabled(): boolean {
    const selected = this.rawRoles().find((r) => r.name === this.assignmentForm.controls.role.value);
    return selected?.scope === 'platform';
  }

  /** Edit mode: true when the role or the group differs from the saved assignment. */
  hasAssignmentChanges(): boolean {
    const current = this.editingAssignment();
    if (!current) return true;
    const { role, groupId } = this.assignmentForm.getRawValue();
    return role !== this.getAssignmentRoleName(current) || (groupId || null) !== (current.groupId ?? null);
  }

  openCreateAssignmentForm(): void {
    if (!this.canManageAssignments()) return;
    this.editingAssignment.set(null);
    this.pendingEdit = null;
    this.assignmentForm.controls.schoolId.enable({ emitEvent: false });
    this.assignmentForm.reset({ schoolId: '', groupId: '', role: '' }, { emitEvent: false });
    this.groups.set([]);
    this.assignmentMode.set('create');

    // A school admin has a single school: preselect it so the groups and roles load right away.
    const available = this.availableSchools();
    if (!this.session.isPlatformAdmin() && available.length === 1) {
      this.assignmentForm.controls.schoolId.setValue(available[0].id);
    }
  }

  openEditAssignmentForm(assignment: UserSchoolAssignment): void {
    if (!this.canManageAssignments()) return;
    this.editingAssignment.set(assignment);
    this.assignmentMode.set('edit');
    this.pendingEdit = { role: this.getAssignmentRoleName(assignment), groupId: assignment.groupId ?? '' };
    // The school of an assignment cannot change (PATCH rejects schoolId): show it, locked.
    this.assignmentForm.controls.schoolId.enable({ emitEvent: false });
    this.assignmentForm.controls.schoolId.setValue(assignment.schoolId);
    this.assignmentForm.controls.schoolId.disable({ emitEvent: false });
  }

  closeAssignmentForm(): void {
    if (this.isAssigningRole()) return;
    this.assignmentMode.set(null);
    this.editingAssignment.set(null);
    this.pendingEdit = null;
  }

  onAssignmentRoleChange(): void {
    if (this.groupDisabled) {
      this.assignmentForm.controls.groupId.setValue('');
    }
  }

  /** Creates the assignment, or in edit mode sends only the fields that changed (PATCH keeps what is left out). */
  saveAssignment(): void {
    if (this.assignmentForm.invalid || this.isAssigningRole() || !this.canManageAssignments()) return;
    const { schoolId, groupId, role } = this.assignmentForm.getRawValue();

    if (this.assignmentMode() === 'edit') {
      const current = this.editingAssignment();
      if (!current?.id || !this.hasAssignmentChanges()) return;
      const payload: UpdateAssignmentPayload = {};
      if (role !== this.getAssignmentRoleName(current)) payload.role = role;
      if ((groupId || null) !== (current.groupId ?? null)) payload.groupId = groupId || null;

      this.isAssigningRole.set(true);
      this.assignmentService.updateAssignment(current.id, payload).subscribe({
        next: () => this.onAssignmentSaved('Assignment Updated', 'The assignment has been updated.'),
        error: (error) => this.onAssignmentSaveFailed('Update Failed', error, 'Failed to update the assignment.')
      });
      return;
    }

    this.isAssigningRole.set(true);
    this.assignmentService
      .createAssignment({ userId: this.userId(), schoolId, role, ...(groupId ? { groupId } : {}) })
      .subscribe({
        next: () => this.onAssignmentSaved('Assignment Created', 'The user has been assigned.'),
        error: (error) => this.onAssignmentSaveFailed('Assignment Failed', error, 'Failed to create the assignment.')
      });
  }

  openRemoveAssignmentModal(assignment: UserSchoolAssignment): void {
    this.assignmentToRemove.set(assignment);
    this.modalType.set('remove-assignment');
  }

  private onAssignmentSaved(title: string, description: string): void {
    this.isAssigningRole.set(false);
    this.assignmentMode.set(null);
    this.editingAssignment.set(null);
    this.toast.success(title, { description });
    this.refreshAssignments();
  }

  private onAssignmentSaveFailed(title: string, error: unknown, fallback: string): void {
    this.isAssigningRole.set(false);
    this.notifyAssignmentError(title, error, fallback);
  }

  private notifyAssignmentError(title: string, error: unknown, fallback: string): void {
    this.toast.error(title, { description: this.userService.extractErrorMessage(error, fallback) });
  }

  /** Reloads the user after an assignment changed, without the full-page loader or touching the profile form. */
  refreshAssignments(): void {
    this.userService.getUserById(this.userId()).subscribe({
      next: (userData) => this.user.update((current) => (current ? { ...current, assignments: userData.assignments } : userData)),
      error: (error) => {
        const msg = this.userService.extractErrorMessage(error, 'Failed to refresh the assignments.');
        this.toast.error('Refresh Failed', { description: msg });
      }
    });
  }

  saveProfile(): void {
    if (this.editForm.invalid || this.isSaving() || !this.canTouchCurrentUser()) return;

    this.isSaving.set(true);
    this.successMessage.set('');
    this.errorMessage.set('');

    const formValues = this.editForm.value;
    const payload = {
      fullName: formValues.fullName.trim(),
      email: formValues.email.trim().toLowerCase()
    };

    this.userService.updateUser(this.userId(), payload).subscribe({
      next: (updatedUser) => {
        this.user.update((prev) => ({ ...prev, ...updatedUser, assignments: updatedUser.assignments ?? prev?.assignments }));
        this.editForm.patchValue({
          fullName: updatedUser.fullName,
          email: updatedUser.email
        });
        this.editForm.markAsPristine();
        this.isSaving.set(false);
        this.successMessage.set('User profile updated successfully.');
        this.toast.success('Profile Saved', {
          description: 'User details have been successfully updated.'
        });
        setTimeout(() => this.successMessage.set(''), 4000);
      },
      error: (error) => {
        this.isSaving.set(false);
        const msg = this.userService.extractErrorMessage(error, 'Failed to update user profile.');
        this.errorMessage.set(msg);
        this.toast.error('Update Failed', { description: msg });
      }
    });
  }

  resetForm(): void {
    const current = this.user();
    if (current) {
      this.editForm.patchValue({
        fullName: current.fullName,
        email: current.email
      });
      this.editForm.markAsPristine();
      this.errorMessage.set('');
    }
  }

  copyUserId(): void {
    const id = this.userId();
    if (id && navigator.clipboard) {
      navigator.clipboard.writeText(id);
      this.copiedId.set(true);
      this.toast.info('Copied', { description: 'User identifier copied to clipboard.' });
      setTimeout(() => this.copiedId.set(false), 2000);
    }
  }

  getInitials(name?: string): string {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  getStatusBadgeClass(status?: string): string {
    switch (status?.toUpperCase()) {
      case 'ACTIVE':
        return 'bg-success';
      case 'SUSPENDED':
        return 'bg-danger';
      case 'INVITED':
        return 'bg-warning';
      default:
        return 'bg-secondary';
    }
  }

  getStatusPillClass(status?: string): string {
    switch (status?.toUpperCase()) {
      case 'ACTIVE':
        return 'bg-light-success text-success';
      case 'SUSPENDED':
        return 'bg-light-danger text-danger';
      case 'INVITED':
        return 'bg-light-warning text-warning';
      default:
        return 'bg-light-secondary text-secondary';
    }
  }

  getStatusDotClass(status?: string): string {
    switch (status?.toUpperCase()) {
      case 'ACTIVE':
        return 'bg-success';
      case 'SUSPENDED':
        return 'bg-danger';
      case 'INVITED':
        return 'bg-warning';
      default:
        return 'bg-secondary';
    }
  }

  getDeviceIcon(platform?: string | null, userAgent?: string | null): string {
    const text = ((platform || '') + ' ' + (userAgent || '')).toLowerCase();
    if (text.includes('android') || text.includes('iphone') || text.includes('ios') || text.includes('mobile')) {
      return 'ti-device-mobile';
    }
    if (text.includes('tablet') || text.includes('ipad')) {
      return 'ti-device-tablet';
    }
    return 'ti-device-laptop';
  }

  openSuspendModal(): void {
    this.modalType.set('suspend');
  }

  openReactivateModal(): void {
    this.modalType.set('reactivate');
  }

  openRevokeSessionModal(session: ActiveSession): void {
    this.selectedSessionToRevoke.set(session);
    this.modalType.set('revoke-session');
  }

  openRevokeAllModal(): void {
    this.modalType.set('revoke-all');
  }

  closeModal(): void {
    if (this.modalLoading()) return;
    this.modalType.set(null);
    this.selectedSessionToRevoke.set(null);
    this.assignmentToRemove.set(null);
  }

  handleModalConfirm(): void {
    const currentModal = this.modalType();
    if (!currentModal || this.modalLoading()) return;

    this.modalLoading.set(true);
    this.successMessage.set('');
    this.errorMessage.set('');
    this.sessionSuccessMessage.set('');
    this.sessionErrorMessage.set('');

    switch (currentModal) {
      case 'suspend':
        this.executeSuspend();
        break;
      case 'reactivate':
        this.executeReactivate();
        break;
      case 'revoke-session':
        this.executeRevokeSession();
        break;
      case 'revoke-all':
        this.executeRevokeAllSessions();
        break;
      case 'remove-assignment':
        this.executeRemoveAssignment();
        break;
    }
  }

  private executeRemoveAssignment(): void {
    const target = this.assignmentToRemove();
    if (!target?.id) {
      this.modalLoading.set(false);
      this.closeModal();
      return;
    }

    this.assignmentService.removeAssignment(target.id).subscribe({
      next: () => {
        this.modalLoading.set(false);
        this.closeModal();
        if (this.editingAssignment()?.id === target.id) {
          this.closeAssignmentForm();
        }
        this.toast.success('Assignment Removed', {
          description: `${this.getAssignmentRoleName(target)} in ${this.getAssignmentSchoolName(target)} has been removed.`
        });
        this.refreshAssignments();
      },
      error: (error) => {
        this.modalLoading.set(false);
        this.closeModal();
        this.notifyAssignmentError('Removal Failed', error, 'Failed to remove the assignment.');
      }
    });
  }

  private executeSuspend(): void {
    this.userService.suspendUser(this.userId()).subscribe({
      next: (updatedUser) => {
        this.user.update((prev) => ({ ...prev, ...updatedUser, assignments: updatedUser.assignments ?? prev?.assignments }));
        this.modalLoading.set(false);
        this.closeModal();
        this.successMessage.set('User suspended. All active sessions have been revoked.');
        this.toast.success('User Suspended', {
          description: 'All active sessions have been revoked and sign-in is blocked.'
        });
        this.loadUserSessions(this.userId());
      },
      error: (error) => {
        this.modalLoading.set(false);
        this.closeModal();
        const msg = this.userService.extractErrorMessage(error, 'Failed to suspend user.');
        this.errorMessage.set(msg);
        this.toast.error('Suspend Failed', { description: msg });
      }
    });
  }

  private executeReactivate(): void {
    this.userService.reactivateUser(this.userId()).subscribe({
      next: (updatedUser) => {
        this.user.update((prev) => ({ ...prev, ...updatedUser, assignments: updatedUser.assignments ?? prev?.assignments }));
        this.modalLoading.set(false);
        this.closeModal();
        const isInvited = updatedUser.status === 'INVITED';
        this.successMessage.set(
          isInvited
            ? 'User reactivated (status restored to Invited).'
            : 'User reactivated successfully.'
        );
        this.toast.success('User Reactivated', {
          description: isInvited
            ? 'Invitation flow resumed (status restored to Invited).'
            : 'Account access has been restored.'
        });
      },
      error: (error) => {
        this.modalLoading.set(false);
        this.closeModal();
        const msg = this.userService.extractErrorMessage(error, 'Failed to reactivate user.');
        this.errorMessage.set(msg);
        this.toast.error('Reactivation Failed', { description: msg });
      }
    });
  }

  private executeRevokeSession(): void {
    const session = this.selectedSessionToRevoke();
    if (!session) {
      this.modalLoading.set(false);
      this.closeModal();
      return;
    }

    this.userService.revokeSession(this.userId(), session.id).subscribe({
      next: () => {
        this.modalLoading.set(false);
        this.closeModal();
        this.sessionSuccessMessage.set('Session successfully revoked.');
        this.toast.success('Session Revoked', {
          description: 'The selected device session has been terminated.'
        });
        this.loadUserSessions(this.userId());
        setTimeout(() => this.sessionSuccessMessage.set(''), 4000);
      },
      error: (error) => {
        this.modalLoading.set(false);
        this.closeModal();
        const msg = this.userService.extractErrorMessage(error, 'Failed to revoke session.');
        this.sessionErrorMessage.set(msg);
        this.toast.error('Revocation Failed', { description: msg });
      }
    });
  }

  private executeRevokeAllSessions(): void {
    this.userService.revokeAllSessions(this.userId()).subscribe({
      next: (res) => {
        this.modalLoading.set(false);
        this.closeModal();
        this.sessionSuccessMessage.set(`All active sessions revoked (${res.revoked || 0} session(s) closed).`);
        this.toast.success('All Sessions Revoked', {
          description: `${res.revoked || 0} active session(s) terminated.`
        });
        this.loadUserSessions(this.userId());
        setTimeout(() => this.sessionSuccessMessage.set(''), 4000);
      },
      error: (error) => {
        this.modalLoading.set(false);
        this.closeModal();
        const msg = this.userService.extractErrorMessage(error, 'Failed to revoke all sessions.');
        this.sessionErrorMessage.set(msg);
        this.toast.error('Revocation Failed', { description: msg });
      }
    });
  }
}
