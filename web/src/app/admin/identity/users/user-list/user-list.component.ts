import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { IconDirective, IconService } from '@ant-design/icons-angular';
import { FallOutline, RiseOutline } from '@ant-design/icons-angular/icons';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { GoeyToastService } from 'goey-toast-angular';
import { CardComponent } from '../../../theme/shared/components/card/card.component';
import { PortalSessionService } from '../../services/portal-session.service';
import { ConfirmationModalComponent } from '../components/confirmation-modal/confirmation-modal.component';
import {
  AssignableRoleOption,
  PaginatedUsers,
  SchoolSummaryOption,
  UserEntity,
  UserSchoolAssignment
} from '../models/user.model';
import { UserManagementService } from '../services/user-management.service';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    CardComponent,
    IconDirective,
    ConfirmationModalComponent,
    NgbDropdownModule
  ],
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.scss']
})
export class UserListComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly userService = inject(UserManagementService);
  private readonly iconService = inject(IconService);
  private readonly toast = inject(GoeyToastService);
  readonly session = inject(PortalSessionService);

  // Users data
  readonly users = signal<UserEntity[]>([]);
  readonly totalUsers = signal<number>(0);
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(10);
  readonly totalPages = signal<number>(1);

  // Loading states (split to prevent layout jumps/glitches during pagination & tab switching)
  readonly isInitialLoading = signal<boolean>(true);
  readonly isUpdating = signal<boolean>(false);
  readonly isLoading = signal<boolean>(true);

  // Filter state
  readonly searchTerm = signal<string>('');
  readonly selectedStatus = signal<string>('ALL');
  readonly selectedSchoolId = signal<string>('');
  readonly selectedRole = signal<string>('ALL');
  readonly sortBy = signal<'createdAt' | 'email' | 'fullName' | 'status'>('createdAt');
  readonly sortOrder = signal<'asc' | 'desc'>('desc');

  // Filter lookup options (#94)
  readonly schools = signal<SchoolSummaryOption[]>([]);
  readonly rawRoles = signal<AssignableRoleOption[]>([]);

  /**
   * Assignable roles limited to the signed-in administrator's level (#94):
   * school admins never see platform-level roles.
   */
  readonly assignableRoles = computed<AssignableRoleOption[]>(() => {
    const isPlatform = this.session.isPlatformAdmin();
    return this.rawRoles().filter((r) => isPlatform || r.scope !== 'platform');
  });

  // Dashboard counter figures
  readonly activeCount = signal<number>(0);
  readonly suspendedCount = signal<number>(0);
  readonly invitedCount = signal<number>(0);

  // Feedback notifications
  readonly successMessage = signal<string>('');
  readonly errorMessage = signal<string>('');

  // Confirmation modal state
  readonly targetUser = signal<UserEntity | null>(null);
  readonly modalAction = signal<'suspend' | 'reactivate' | null>(null);
  readonly modalLoading = signal<boolean>(false);

  private searchDebounceTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.iconService.addIcon(...[RiseOutline, FallOutline]);
  }

  ngOnInit(): void {
    this.loadFilterLookups();
    this.loadUsers();
    this.loadCounters();
  }

  loadFilterLookups(): void {
    const activeSchool = this.session.isPlatformAdmin()
      ? undefined
      : (this.session.activeSchoolId() ?? undefined);

    if (typeof this.userService.getAssignableRoles === 'function') {
      this.userService.getAssignableRoles(activeSchool).subscribe({
        next: (roles) => this.rawRoles.set(roles),
        error: () => {}
      });
    }

    if (this.session.isPlatformAdmin() && typeof this.userService.getSchools === 'function') {
      this.userService.getSchools().subscribe({
        next: (schools) => this.schools.set(schools),
        error: () => {}
      });
    }
  }

  /** Effective schoolId filter: fixed to the school admin's school, or selectable for platform admin. */
  get effectiveSchoolId(): string | undefined {
    if (!this.session.isPlatformAdmin()) {
      return this.session.activeSchoolId() ?? undefined;
    }
    return this.selectedSchoolId() || undefined;
  }

  loadUsers(): void {
    if (this.users().length === 0) {
      this.isInitialLoading.set(true);
    } else {
      this.isUpdating.set(true);
    }
    this.errorMessage.set('');

    this.userService
      .getUsers({
        page: this.currentPage(),
        limit: this.pageSize(),
        status: this.selectedStatus(),
        search: this.searchTerm(),
        ...(this.effectiveSchoolId ? { schoolId: this.effectiveSchoolId } : {}),
        ...(this.selectedRole() !== 'ALL' ? { role: this.selectedRole() } : {}),
        sortBy: this.sortBy(),
        sortOrder: this.sortOrder()
      })
      .subscribe({
        next: (res: PaginatedUsers) => {
          this.users.set(res.data);
          this.totalUsers.set(res.total);
          this.currentPage.set(res.page);
          this.pageSize.set(res.limit);
          this.totalPages.set(res.totalPages || Math.ceil(res.total / res.limit) || 1);
          this.isInitialLoading.set(false);
          this.isUpdating.set(false);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.isInitialLoading.set(false);
          this.isUpdating.set(false);
          this.isLoading.set(false);
          const msg = this.userService.extractErrorMessage(error, 'Failed to retrieve users.');
          this.errorMessage.set(msg);
          this.toast.error('Failed to load users', { description: msg });
        }
      });
  }

  loadCounters(): void {
    const schoolFilter = this.effectiveSchoolId ? { schoolId: this.effectiveSchoolId } : {};
    this.userService.getUsers({ ...schoolFilter, status: 'ACTIVE', limit: 1 }).subscribe({
      next: (res) => this.activeCount.set(res.total),
      error: () => {}
    });
    this.userService.getUsers({ ...schoolFilter, status: 'SUSPENDED', limit: 1 }).subscribe({
      next: (res) => this.suspendedCount.set(res.total),
      error: () => {}
    });
    this.userService.getUsers({ ...schoolFilter, status: 'INVITED', limit: 1 }).subscribe({
      next: (res) => this.invitedCount.set(res.total),
      error: () => {}
    });
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
      this.currentPage.set(1);
      this.loadUsers();
    }, 300);
  }

  clearSearch(): void {
    this.searchTerm.set('');
    this.currentPage.set(1);
    this.loadUsers();
  }

  setStatusFilter(status: string): void {
    if (this.selectedStatus() === status) return;
    this.selectedStatus.set(status);
    this.currentPage.set(1);
    this.loadUsers();
  }

  onSchoolFilterChange(schoolId: string): void {
    this.selectedSchoolId.set(schoolId);
    this.currentPage.set(1);
    this.loadUsers();
    this.loadCounters();
  }

  onRoleFilterChange(role: string): void {
    this.selectedRole.set(role || 'ALL');
    this.currentPage.set(1);
    this.loadUsers();
  }

  toggleSort(column: 'createdAt' | 'email' | 'fullName' | 'status'): void {
    if (this.sortBy() === column) {
      this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortBy.set(column);
      this.sortOrder.set('asc');
    }
    this.currentPage.set(1);
    this.loadUsers();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
    this.loadUsers();
  }

  changePageSize(newSize: number): void {
    this.pageSize.set(newSize);
    this.currentPage.set(1);
    this.loadUsers();
  }

  getAssignmentRoleName(a: UserSchoolAssignment): string {
    if (!a.role) return '';
    return typeof a.role === 'string' ? a.role : a.role.name;
  }

  getAssignmentSchoolName(a: UserSchoolAssignment): string {
    return a.schoolName || a.school?.name || '';
  }

  /**
   * True when the signed-in administrator is allowed to edit/manage `target` (#94):
   * school admins cannot touch platform admins or users outside their school.
   */
  canTouchUser(target: UserEntity): boolean {
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
   * True when the signed-in administrator may suspend or reactivate `target` (#94):
   * nobody can suspend their own account, and school admins cannot act on higher-level admins.
   */
  canChangeUserStatus(target: UserEntity): boolean {
    if (!this.canTouchUser(target)) return false;
    const currentUserId = this.session.user()?.id;
    if (currentUserId && target.id === currentUserId) return false;
    return this.session.hasPermission('users:suspend');
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

  openSuspendModal(user: UserEntity, event: Event): void {
    event.stopPropagation();
    this.targetUser.set(user);
    this.modalAction.set('suspend');
  }

  openReactivateModal(user: UserEntity, event: Event): void {
    event.stopPropagation();
    this.targetUser.set(user);
    this.modalAction.set('reactivate');
  }

  closeModal(): void {
    if (this.modalLoading()) return;
    this.modalAction.set(null);
    this.targetUser.set(null);
  }

  confirmModalAction(): void {
    const user = this.targetUser();
    const action = this.modalAction();
    if (!user || !action || this.modalLoading()) return;

    this.modalLoading.set(true);
    this.successMessage.set('');
    this.errorMessage.set('');

    if (action === 'suspend') {
      this.userService.suspendUser(user.id).subscribe({
        next: (updatedUser) => {
          this.updateUserInList(updatedUser);
          this.modalLoading.set(false);
          this.closeModal();
          this.successMessage.set(`User ${user.fullName} suspended successfully.`);
          this.toast.success(`User ${user.fullName} suspended`, {
            description: 'Account access blocked and all active sessions revoked.'
          });
          this.loadCounters();
          setTimeout(() => this.successMessage.set(''), 4000);
        },
        error: (error) => {
          this.modalLoading.set(false);
          this.closeModal();
          const msg = this.userService.extractErrorMessage(error, 'Failed to suspend user.');
          this.errorMessage.set(msg);
          this.toast.error('Action Failed', { description: msg });
        }
      });
    } else {
      this.userService.reactivateUser(user.id).subscribe({
        next: (updatedUser) => {
          this.updateUserInList(updatedUser);
          this.modalLoading.set(false);
          this.closeModal();
          this.successMessage.set(`User ${user.fullName} reactivated successfully.`);
          this.toast.success(`User ${user.fullName} reactivated`, {
            description: 'Account access has been restored.'
          });
          this.loadCounters();
          setTimeout(() => this.successMessage.set(''), 4000);
        },
        error: (error) => {
          this.modalLoading.set(false);
          this.closeModal();
          const msg = this.userService.extractErrorMessage(error, 'Failed to reactivate user.');
          this.errorMessage.set(msg);
          this.toast.error('Action Failed', { description: msg });
        }
      });
    }
  }

  private updateUserInList(updated: UserEntity): void {
    this.users.update((list) => list.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
  }
}
