import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { IconDirective, IconService } from '@ant-design/icons-angular';
import { FallOutline, RiseOutline } from '@ant-design/icons-angular/icons';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { GoeyToastService } from 'goey-toast-angular';
import { CardComponent } from '../../../theme/shared/components/card/card.component';
import { ConfirmationModalComponent } from '../../users/components/confirmation-modal/confirmation-modal.component';
import {
  GroupedPermissionCategory,
  PermissionEntity,
  RoleEntity,
  RoleScope,
  isSystemBaseRole
} from '../models/role.model';
import { RoleManagementService } from '../services/role-management.service';

@Component({
  selector: 'app-role-list',
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
  templateUrl: './role-list.component.html',
  styleUrls: ['./role-list.component.scss']
})
export class RoleListComponent implements OnInit {
  private readonly roleService = inject(RoleManagementService);
  private readonly router = inject(Router);
  private readonly iconService = inject(IconService);
  private readonly toast = inject(GoeyToastService, { optional: true });

  // Data signals
  readonly roles = signal<RoleEntity[]>([]);
  readonly allPermissions = signal<PermissionEntity[]>([]);
  readonly isLoading = signal<boolean>(true);
  readonly isUpdating = signal<boolean>(false);

  // Filters & sorting
  readonly searchTerm = signal<string>('');
  readonly selectedScope = signal<'ALL' | RoleScope>('ALL');
  readonly selectedType = signal<'ALL' | 'BASE' | 'CUSTOM'>('ALL');
  readonly sortBy = signal<'name' | 'createdAt'>('name');
  readonly sortOrder = signal<'asc' | 'desc'>('asc');

  // Delete modal state
  readonly isDeleteModalOpen = signal<boolean>(false);
  readonly roleToDelete = signal<RoleEntity | null>(null);
  readonly isDeleting = signal<boolean>(false);

  // Preview permissions modal state
  readonly isPreviewModalOpen = signal<boolean>(false);
  readonly previewRole = signal<RoleEntity | null>(null);
  readonly activePreviewTab = signal<string>('all');

  // Computed metrics
  readonly totalRolesCount = computed(() => this.roles().length);
  readonly baseRolesCount = computed(() => this.roles().filter((r) => r.isBase).length);
  readonly customRolesCount = computed(() => this.roles().filter((r) => !r.isBase).length);
  readonly totalPermissionsCount = computed(() => {
    const fromApi = this.allPermissions().length;
    return fromApi > 0 ? fromApi : 42;
  });

  // Filtered and sorted roles list
  readonly filteredRoles = computed(() => {
    let result = this.roles();
    const query = this.searchTerm().trim().toLowerCase();
    const scope = this.selectedScope();
    const type = this.selectedType();

    if (query) {
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(query) ||
          r.scope.toLowerCase().includes(query)
      );
    }

    if (scope !== 'ALL') {
      result = result.filter((r) => r.scope === scope);
    }

    if (type === 'BASE') {
      result = result.filter((r) => r.isBase);
    } else if (type === 'CUSTOM') {
      result = result.filter((r) => !r.isBase);
    }

    const sortField = this.sortBy();
    const order = this.sortOrder();
    result = [...result].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortField === 'createdAt') {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return order === 'asc' ? comparison : -comparison;
    });

    return result;
  });

  // Grouped permissions for the preview modal
  readonly previewGrouped = computed<GroupedPermissionCategory[]>(() => {
    const role = this.previewRole();
    if (!role) return [];
    const rolePermCodes = new Set(role.permissions ?? []);
    const groups = this.roleService.groupPermissions(this.allPermissions());
    return groups
      .map((g) => ({
        ...g,
        permissions: g.permissions.filter((p) => rolePermCodes.has(p.code))
      }))
      .filter((g) => g.permissions.length > 0);
  });

  readonly activePreviewCategories = computed<GroupedPermissionCategory[]>(() => {
    const active = this.activePreviewTab();
    const categories = this.previewGrouped();
    if (active === 'all') return categories;
    return categories.filter((c) => c.key === active);
  });

  getCoveragePercentage(role: RoleEntity): number {
    const total = this.totalPermissionsCount() || 42;
    return Math.min(100, Math.round(((role.permissions?.length ?? 0) / total) * 100));
  }

  constructor() {
    this.iconService.addIcon(...[RiseOutline, FallOutline]);
  }

  ngOnInit(): void {
    this.loadRoles();
    this.loadPermissions();
  }

  loadRoles(): void {
    this.isLoading.set(true);
    this.roleService.getRoles().subscribe({
      next: (data) => {
        this.roles.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        const msg = this.roleService.extractErrorMessage(err, 'Failed to retrieve roles.');
        this.toast?.error('Failed to load roles', { description: msg });
      }
    });
  }

  loadPermissions(): void {
    this.roleService.getPermissions().subscribe({
      next: (perms) => {
        this.allPermissions.set(perms);
      }
    });
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
  }

  setScopeFilter(scope: 'ALL' | RoleScope): void {
    this.selectedScope.set(scope);
  }

  setTypeFilter(type: 'ALL' | 'BASE' | 'CUSTOM'): void {
    this.selectedType.set(type);
  }

  toggleSort(field: 'name' | 'createdAt'): void {
    if (this.sortBy() === field) {
      this.sortOrder.update((curr) => (curr === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortBy.set(field);
      this.sortOrder.set('asc');
    }
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.selectedScope.set('ALL');
    this.selectedType.set('ALL');
  }

  navigateToCreate(): void {
    void this.router.navigate(['/admin/roles/create']);
  }

  navigateToEdit(role: RoleEntity): void {
    if (role.isBase) {
      this.toast?.info('System Base Role', {
        description: 'Base roles are immutable system definitions and cannot be edited.'
      });
      return;
    }
    void this.router.navigate(['/admin/roles', role.id, 'edit']);
  }

  openPermissionsPreview(role: RoleEntity): void {
    this.previewRole.set(role);
    this.isPreviewModalOpen.set(true);
  }

  closePermissionsPreview(): void {
    this.isPreviewModalOpen.set(false);
    this.previewRole.set(null);
  }

  openDeleteModal(role: RoleEntity): void {
    if (role.isBase) {
      this.toast?.warning('Action Denied', {
        description: 'System base roles are protected and cannot be deleted.'
      });
      return;
    }
    this.roleToDelete.set(role);
    this.isDeleteModalOpen.set(true);
  }

  cancelDelete(): void {
    if (this.isDeleting()) return;
    this.isDeleteModalOpen.set(false);
    this.roleToDelete.set(null);
  }

  confirmDelete(): void {
    const role = this.roleToDelete();
    if (!role) return;

    this.isDeleting.set(true);
    this.roleService.deleteRole(role.id).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.isDeleteModalOpen.set(false);
        this.roles.update((list) => list.filter((r) => r.id !== role.id));
        this.toast?.success('Role Deleted', {
          description: `Role '${role.name}' was successfully deleted.`
        });
        this.roleToDelete.set(null);
      },
      error: (error) => {
        this.isDeleting.set(false);
        const msg = this.roleService.extractErrorMessage(
          error,
          `Cannot delete role '${role.name}'. It may still be assigned to active users.`
        );
        this.toast?.error('Deletion Blocked', {
          description: msg
        });
      }
    });
  }
}
