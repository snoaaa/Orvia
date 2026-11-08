import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
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
  selector: 'app-role-edit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule,
    CardComponent,
    ConfirmationModalComponent
  ],
  templateUrl: './role-edit.component.html',
  styleUrls: ['./role-edit.component.scss']
})
export class RoleEditComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly roleService = inject(RoleManagementService);
  private readonly toast = inject(GoeyToastService, { optional: true });

  // State signals
  readonly roleId = signal<string>('');
  readonly isCreateMode = signal<boolean>(false);
  readonly isReadOnly = signal<boolean>(false);
  readonly isLoading = signal<boolean>(true);
  readonly isSaving = signal<boolean>(false);
  readonly copiedId = signal<boolean>(false);
  readonly role = signal<RoleEntity | null>(null);

  // Baseline tracking for dirty state & reset functionality
  readonly initialRoleName = signal<string>('');
  readonly initialScope = signal<RoleScope>('school');
  readonly initialPermissions = signal<Set<string>>(new Set());

  // Permissions state
  readonly allPermissions = signal<PermissionEntity[]>([]);
  readonly selectedPermissions = signal<Set<string>>(new Set());
  readonly permissionSearchTerm = signal<string>('');
  readonly activeCategoryTab = signal<string>('all');

  // Delete modal state
  readonly isDeleteModalOpen = signal<boolean>(false);
  readonly isDeleting = signal<boolean>(false);

  // Form modification tracker for reactive dirty state evaluation
  readonly formVersion = signal<number>(0);

  // Reactive form
  roleForm: FormGroup = this.fb.group({
    name: [
      '',
      [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(50),
        Validators.pattern(/^[A-Za-z0-9_-]+$/)
      ]
    ],
    scope: ['school', [Validators.required]]
  });

  constructor() {
    this.roleForm.valueChanges.subscribe(() => {
      this.formVersion.update((v) => v + 1);
    });
  }

  // Grouped permissions computed from catalog
  readonly groupedCategories = computed<GroupedPermissionCategory[]>(() => {
    return this.roleService.groupPermissions(this.allPermissions());
  });

  // Filtered categories based on the permission search input
  readonly filteredCategories = computed<GroupedPermissionCategory[]>(() => {
    const query = this.permissionSearchTerm().trim().toLowerCase();
    const categories = this.groupedCategories();
    if (!query) return categories;

    return categories
      .map((cat) => ({
        ...cat,
        permissions: cat.permissions.filter(
          (p) =>
            p.code.toLowerCase().includes(query) ||
            (p.description && p.description.toLowerCase().includes(query))
        )
      }))
      .filter((cat) => cat.permissions.length > 0);
  });

  readonly displayedCategories = computed<GroupedPermissionCategory[]>(() => {
    const active = this.activeCategoryTab();
    const categories = this.filteredCategories();
    if (active === 'all') return categories;
    return categories.filter((c) => c.key === active);
  });

  readonly totalSelectedCount = computed(() => this.selectedPermissions().size);
  readonly totalAvailableCount = computed(() => this.allPermissions().length);

  readonly isDirty = computed<boolean>(() => {
    // Unconditionally evaluate all reactive signals upfront so dependency tracking is always complete
    this.formVersion();
    const currentPerms = this.selectedPermissions();
    const initialPerms = this.initialPermissions();
    const isCreate = this.isCreateMode();
    const readOnly = this.isReadOnly();
    const initialName = this.initialRoleName();
    const initialScopeVal = this.initialScope();

    if (readOnly) return false;

    const rawName = (this.roleForm.get('name')?.value || '').trim();
    const rawScope = this.roleForm.get('scope')?.value;

    if (isCreate) {
      return rawName.length > 0 || rawScope !== 'school' || currentPerms.size > 0;
    }

    const currentName = rawName.toUpperCase();
    if (currentName !== initialName) return true;
    if (rawScope !== initialScopeVal) return true;

    if (currentPerms.size !== initialPerms.size) return true;
    for (const p of currentPerms) {
      if (!initialPerms.has(p)) return true;
    }
    return false;
  });

  resetForm(): void {
    if (this.isReadOnly()) return;
    if (this.isCreateMode()) {
      this.roleForm.reset({ name: '', scope: 'school' });
      this.selectedPermissions.set(new Set());
    } else {
      this.roleForm.reset({
        name: this.initialRoleName(),
        scope: this.initialScope()
      });
      this.selectedPermissions.set(new Set(this.initialPermissions()));
    }
    this.roleForm.markAsPristine();
    this.formVersion.update((v) => v + 1);
  }

  setScope(scope: RoleScope): void {
    if (this.isReadOnly()) return;
    const control = this.roleForm.get('scope');
    if (control && control.value !== scope) {
      control.setValue(scope);
      control.markAsDirty();
    }
  }

  onRoleNameInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const transformed = input.value.toUpperCase().replace(/\s+/g, '_');
    if (input.value !== transformed) {
      input.value = transformed;
      this.roleForm.get('name')?.setValue(transformed);
    }
  }

  onSearchTermChange(term: string): void {
    this.permissionSearchTerm.set(term || '');
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');

    if (!id || id === 'create') {
      this.isCreateMode.set(true);
      this.isReadOnly.set(false);
      this.initialRoleName.set('');
      this.initialScope.set('school');
      this.initialPermissions.set(new Set());
      this.loadPermissionsCatalog(() => {
        this.isLoading.set(false);
      });
    } else {
      this.roleId.set(id);
      this.isCreateMode.set(false);
      this.loadPermissionsCatalog(() => {
        this.loadRoleData(id);
      });
    }
  }

  loadPermissionsCatalog(onDone?: () => void): void {
    this.roleService.getPermissions().subscribe({
      next: (perms) => {
        this.allPermissions.set(perms);
        if (onDone) onDone();
      },
      error: () => {
        if (onDone) onDone();
      }
    });
  }

  loadRoleData(id: string): void {
    this.isLoading.set(true);
    this.roleService.getRoleById(id).subscribe({
      next: (roleData) => {
        this.role.set(roleData);
        const isBase = roleData.isBase ?? isSystemBaseRole(roleData.name);
        this.isReadOnly.set(isBase);

        this.roleForm.patchValue({
          name: roleData.name,
          scope: roleData.scope
        });
        this.roleForm.markAsPristine();

        this.initialRoleName.set(roleData.name);
        this.initialScope.set(roleData.scope);

        if (isBase) {
          this.roleForm.disable();
        }

        const permSet = new Set(roleData.permissions ?? []);
        this.initialPermissions.set(new Set(permSet));
        this.selectedPermissions.set(permSet);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.isLoading.set(false);
        const msg = this.roleService.extractErrorMessage(error, 'Role could not be found.');
        this.toast?.error('Failed to Load Role', { description: msg });
        void this.router.navigate(['/admin/roles']);
      }
    });
  }

  copyRoleId(): void {
    const id = this.role()?.id;
    if (!id) return;
    void navigator.clipboard.writeText(id);
    this.copiedId.set(true);
    setTimeout(() => this.copiedId.set(false), 2000);
  }

  togglePermission(code: string): void {
    if (this.isReadOnly()) return;

    this.selectedPermissions.update((set) => {
      const next = new Set(set);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }

  isPermissionSelected(code: string): boolean {
    return this.selectedPermissions().has(code);
  }

  toggleCategory(category: GroupedPermissionCategory): void {
    if (this.isReadOnly()) return;

    const allInCatSelected = this.isCategoryFullySelected(category);
    this.selectedPermissions.update((set) => {
      const next = new Set(set);
      category.permissions.forEach((p) => {
        if (allInCatSelected) {
          next.delete(p.code);
        } else {
          next.add(p.code);
        }
      });
      return next;
    });
  }

  isCategoryFullySelected(category: GroupedPermissionCategory): boolean {
    if (category.permissions.length === 0) return false;
    return category.permissions.every((p) => this.selectedPermissions().has(p.code));
  }

  getCategorySelectedCount(category: GroupedPermissionCategory): number {
    return category.permissions.filter((p) => this.selectedPermissions().has(p.code)).length;
  }

  selectAllPermissions(): void {
    if (this.isReadOnly()) return;
    const all = new Set(this.allPermissions().map((p) => p.code));
    this.selectedPermissions.set(all);
  }

  clearAllPermissions(): void {
    if (this.isReadOnly()) return;
    this.selectedPermissions.set(new Set());
  }

  onSave(): void {
    if (this.isReadOnly()) return;
    if (this.roleForm.invalid) {
      this.roleForm.markAllAsTouched();
      this.toast?.error('Validation Error', {
        description: 'Please fix form fields before saving.'
      });
      return;
    }

    const formValue = this.roleForm.getRawValue();
    const roleName = (formValue.name as string).trim().toUpperCase();
    const scope = formValue.scope as RoleScope;
    const permissions = Array.from(this.selectedPermissions());

    this.isSaving.set(true);

    if (this.isCreateMode()) {
      this.roleService
        .createRole({
          name: roleName,
          scope,
          permissions
        })
        .subscribe({
          next: () => {
            this.isSaving.set(false);
            this.toast?.success('Role Created', {
              description: `Role '${roleName}' has been successfully registered.`
            });
            void this.router.navigate(['/admin/roles']);
          },
          error: (err) => {
            this.isSaving.set(false);
            const msg = this.roleService.extractErrorMessage(
              err,
              'Failed to create role. Please verify the name is unique.'
            );
            this.toast?.error('Creation Failed', { description: msg });
          }
        });
    } else {
      this.roleService
        .updateRole(this.roleId(), {
          name: roleName,
          scope,
          permissions
        })
        .subscribe({
          next: () => {
            this.isSaving.set(false);
            this.toast?.success('Role Updated', {
              description: `Role '${roleName}' has been updated successfully.`
            });
            void this.router.navigate(['/admin/roles']);
          },
          error: (err) => {
            this.isSaving.set(false);
            const msg = this.roleService.extractErrorMessage(
              err,
              'Failed to update role. Please verify input data.'
            );
            this.toast?.error('Update Failed', { description: msg });
          }
        });
    }
  }

  openDeleteModal(): void {
    if (this.isReadOnly()) return;
    this.isDeleteModalOpen.set(true);
  }

  cancelDelete(): void {
    if (this.isDeleting()) return;
    this.isDeleteModalOpen.set(false);
  }

  confirmDelete(): void {
    const roleId = this.roleId();
    if (!roleId || this.isReadOnly()) return;

    this.isDeleting.set(true);
    this.roleService.deleteRole(roleId).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.isDeleteModalOpen.set(false);
        this.toast?.success('Role Deleted', {
          description: `Role was successfully deleted.`
        });
        void this.router.navigate(['/admin/roles']);
      },
      error: (error) => {
        this.isDeleting.set(false);
        const msg = this.roleService.extractErrorMessage(
          error,
          'Cannot delete role: still assigned to active users.'
        );
        this.toast?.error('Deletion Blocked', {
          description: msg
        });
      }
    });
  }
}
