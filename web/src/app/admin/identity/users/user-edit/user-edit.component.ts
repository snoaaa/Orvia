import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { CardComponent } from '../../../theme/shared/components/card/card.component';
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
  readonly selectedAssignSchoolId = signal<string>('');
  readonly selectedAssignRole = signal<string>('');
  readonly isAssigningRole = signal<boolean>(false);
  readonly isTogglingDocMgmt = signal<boolean>(false);

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

  readonly successMessage = signal<string>('');
  readonly errorMessage = signal<string>('');
  readonly sessionSuccessMessage = signal<string>('');
  readonly sessionErrorMessage = signal<string>('');

  readonly modalType = signal<'suspend' | 'reactivate' | 'revoke-session' | 'revoke-all' | null>(null);
  readonly modalLoading = signal<boolean>(false);
  readonly selectedSessionToRevoke = signal<ActiveSession | null>(null);

  editForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(150)]]
  });

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

    if (fixedSchool) {
      this.selectedAssignSchoolId.set(fixedSchool);
    }

    if (typeof this.userService.getAssignableRoles === 'function') {
      this.userService.getAssignableRoles(fixedSchool).subscribe({
        next: (roles) => {
          this.rawRoles.set(roles);
          const filtered = this.assignableRoles();
          if (filtered.length > 0 && !this.selectedAssignRole()) {
            this.selectedAssignRole.set(filtered[0].name);
          }
        },
        error: () => {}
      });
    }

    if (this.session.isPlatformAdmin() && typeof this.userService.getSchools === 'function') {
      this.userService.getSchools().subscribe({
        next: (schools) => {
          this.schools.set(schools);
          if (schools.length > 0 && !this.selectedAssignSchoolId()) {
            this.selectedAssignSchoolId.set(schools[0].id);
          }
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

  /**
   * Assigns or updates the user's role in the selected (or fixed) school (#94).
   */
  assignRoleInSchool(): void {
    if (this.isAssigningRole() || !this.canTouchCurrentUser()) return;

    const schoolId = this.session.isPlatformAdmin()
      ? this.selectedAssignSchoolId()
      : (this.session.activeSchoolId() ?? this.selectedAssignSchoolId());
    const role = this.selectedAssignRole();

    if (!schoolId || !role) return;

    this.isAssigningRole.set(true);
    this.userService.assignRole(this.userId(), schoolId, role).subscribe({
      next: () => {
        this.isAssigningRole.set(false);
        this.toast.success('Role Assigned', {
          description: `Assigned ${role} in the selected school.`
        });
        this.loadUserData(this.userId());
      },
      error: (error) => {
        this.isAssigningRole.set(false);
        const msg = this.userService.extractErrorMessage(error, 'Failed to assign role.');
        this.toast.error('Role Assignment Failed', { description: msg });
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
    }
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
        this.successMessage.set('User reactivated successfully.');
        this.toast.success('User Reactivated', {
          description: 'Account access has been restored.'
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
