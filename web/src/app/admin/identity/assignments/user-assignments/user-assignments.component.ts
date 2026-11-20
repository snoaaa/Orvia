import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { GoeyToastService } from 'goey-toast-angular';
import { catchError, forkJoin, of, switchMap, tap } from 'rxjs';
import { CardComponent } from '../../../theme/shared/components/card/card.component';
import { ConfirmationModalComponent } from '../../users/components/confirmation-modal/confirmation-modal.component';
import { getAdminTypeFromStorage } from '../../roles/guards/platform-admin.guard';
import {
  AssignableRole,
  GroupOption,
  SchoolOption,
  UpdateAssignmentPayload,
  UserAssignment
} from '../models/assignment.model';
import { AssignmentService } from '../services/assignment.service';

export const ASSIGN_ROLE_PERMISSION = 'users:assign_role';

@Component({
  selector: 'app-user-assignments',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CardComponent, ConfirmationModalComponent],
  templateUrl: './user-assignments.component.html'
})
export class UserAssignmentsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly assignmentService = inject(AssignmentService);
  private readonly toast = inject(GoeyToastService);

  readonly userId = input.required<string>();
  readonly assignments = input<UserAssignment[]>([]);
  /** Emitted after the list changed on the server so the parent reloads the user. */
  readonly changed = output<void>();

  /** Platform admins pick among all schools, school admins only get their own (the API scopes the list). */
  readonly adminType = getAdminTypeFromStorage();

  /** The card stays hidden until GET /auth/me says the admin holds users:assign_role. */
  readonly canManage = signal<boolean>(false);

  readonly formMode = signal<'create' | 'edit' | null>(null);
  readonly editing = signal<UserAssignment | null>(null);
  readonly isSaving = signal<boolean>(false);
  readonly isLookupLoading = signal<boolean>(false);

  readonly schools = signal<SchoolOption[]>([]);
  readonly groups = signal<GroupOption[]>([]);
  readonly roles = signal<AssignableRole[]>([]);

  readonly removeTarget = signal<UserAssignment | null>(null);
  readonly modalLoading = signal<boolean>(false);

  /** A user has at most one assignment per school, so schools already used are not offered when adding. */
  readonly availableSchools = computed(() => {
    const used = new Set(this.assignments().map((a) => a.schoolId));
    return this.schools().filter((s) => !used.has(s.id));
  });

  readonly form = this.fb.nonNullable.group({
    schoolId: ['', Validators.required],
    groupId: [''],
    role: ['', Validators.required]
  });

  /** Values to apply once the groups and roles of the edited school have loaded. */
  private pendingEdit: { role: string; groupId: string } | null = null;

  constructor() {
    // The group and role lists follow the school; switchMap drops stale answers when it changes quickly.
    this.form.controls.schoolId.valueChanges
      .pipe(
        takeUntilDestroyed(),
        tap(() => {
          this.groups.set([]);
          this.roles.set([]);
          this.form.patchValue({ groupId: '', role: '' }, { emitEvent: false });
        }),
        switchMap((schoolId) => {
          if (!schoolId) {
            return of({ groups: [] as GroupOption[], roles: [] as AssignableRole[] });
          }
          this.isLookupLoading.set(true);
          return forkJoin({
            groups: this.assignmentService.getGroups(schoolId).pipe(
              catchError((error) => {
                this.notifyError('Could Not Load Groups', error, 'Failed to load the groups of this school.');
                return of([] as GroupOption[]);
              })
            ),
            roles: this.assignmentService.getAssignableRoles(schoolId).pipe(
              catchError((error) => {
                this.notifyError('Could Not Load Roles', error, 'Failed to load the assignable roles.');
                return of([] as AssignableRole[]);
              })
            )
          });
        })
      )
      .subscribe(({ groups, roles }) => {
        this.groups.set(groups);
        this.roles.set(roles);
        this.isLookupLoading.set(false);
        if (this.pendingEdit) {
          this.form.patchValue(this.pendingEdit);
          this.form.markAsPristine();
          this.pendingEdit = null;
        }
      });
  }

  ngOnInit(): void {
    this.assignmentService.getCurrentAdmin().subscribe({
      next: (me) => this.canManage.set((me.permissions ?? []).includes(ASSIGN_ROLE_PERMISSION)),
      error: () => this.canManage.set(false)
    });
  }

  /** Platform roles apply to every school, so the API rejects a group on them. */
  get groupDisabled(): boolean {
    const selected = this.roles().find((r) => r.name === this.form.controls.role.value);
    return selected?.scope === 'platform';
  }

  /** Edit mode: true when the role or the group differs from the saved assignment. */
  hasChanges(): boolean {
    const current = this.editing();
    if (!current) return true;
    const { role, groupId } = this.form.getRawValue();
    return role !== current.role || (groupId || null) !== current.groupId;
  }

  openCreateForm(): void {
    this.editing.set(null);
    this.pendingEdit = null;
    this.form.controls.schoolId.enable({ emitEvent: false });
    this.form.reset({ schoolId: '', groupId: '', role: '' }, { emitEvent: false });
    this.groups.set([]);
    this.roles.set([]);
    this.formMode.set('create');

    this.assignmentService.getSchools().subscribe({
      next: (schools) => {
        this.schools.set(schools);
        // A school admin has a single school: preselect it so groups and roles load right away.
        const available = this.availableSchools();
        if (this.adminType === 'school' && available.length === 1) {
          this.form.controls.schoolId.setValue(available[0].id);
        }
      },
      error: (error) => this.notifyError('Could Not Load Schools', error, 'Failed to load the schools.')
    });
  }

  openEditForm(assignment: UserAssignment): void {
    this.editing.set(assignment);
    this.formMode.set('edit');
    this.pendingEdit = { role: assignment.role, groupId: assignment.groupId ?? '' };
    // The school of an assignment cannot change (PATCH rejects schoolId): show it, locked.
    this.schools.set([{ id: assignment.schoolId, name: assignment.schoolName }]);
    this.form.controls.schoolId.enable({ emitEvent: false });
    this.form.controls.schoolId.setValue(assignment.schoolId);
    this.form.controls.schoolId.disable({ emitEvent: false });
  }

  closeForm(): void {
    if (this.isSaving()) return;
    this.formMode.set(null);
    this.editing.set(null);
    this.pendingEdit = null;
  }

  onRoleChange(): void {
    if (this.groupDisabled) {
      this.form.controls.groupId.setValue('');
    }
  }

  submit(): void {
    if (this.form.invalid || this.isSaving()) return;
    const mode = this.formMode();
    const { schoolId, groupId, role } = this.form.getRawValue();

    if (mode === 'edit') {
      const current = this.editing();
      if (!current || !this.hasChanges()) return;
      // Only send what changed: PATCH keeps what is left out.
      const payload: UpdateAssignmentPayload = {};
      if (role !== current.role) payload.role = role;
      if ((groupId || null) !== current.groupId) payload.groupId = groupId || null;

      this.isSaving.set(true);
      this.assignmentService.updateAssignment(current.id, payload).subscribe({
        next: () => this.onSaved('Assignment Updated', 'The assignment has been updated.'),
        error: (error) => this.onSaveFailed('Update Failed', error, 'Failed to update the assignment.')
      });
      return;
    }

    this.isSaving.set(true);
    this.assignmentService
      .createAssignment({ userId: this.userId(), schoolId, role, ...(groupId ? { groupId } : {}) })
      .subscribe({
        next: () => this.onSaved('Assignment Created', 'The user has been assigned.'),
        error: (error) => this.onSaveFailed('Assignment Failed', error, 'Failed to create the assignment.')
      });
  }

  openRemoveModal(assignment: UserAssignment): void {
    this.removeTarget.set(assignment);
  }

  closeModal(): void {
    if (this.modalLoading()) return;
    this.removeTarget.set(null);
  }

  confirmRemove(): void {
    const target = this.removeTarget();
    if (!target || this.modalLoading()) return;

    this.modalLoading.set(true);
    this.assignmentService.removeAssignment(target.id).subscribe({
      next: () => {
        this.modalLoading.set(false);
        this.removeTarget.set(null);
        if (this.editing()?.id === target.id) {
          this.closeForm();
        }
        this.toast.success('Assignment Removed', {
          description: `${target.role} in ${target.schoolName} has been removed.`
        });
        this.changed.emit();
      },
      error: (error) => {
        this.modalLoading.set(false);
        this.removeTarget.set(null);
        this.notifyError('Removal Failed', error, 'Failed to remove the assignment.');
      }
    });
  }

  private onSaved(title: string, description: string): void {
    this.isSaving.set(false);
    this.formMode.set(null);
    this.editing.set(null);
    this.toast.success(title, { description });
    this.changed.emit();
  }

  private onSaveFailed(title: string, error: unknown, fallback: string): void {
    this.isSaving.set(false);
    this.notifyError(title, error, fallback);
  }

  private notifyError(title: string, error: unknown, fallback: string): void {
    this.toast.error(title, { description: this.assignmentService.extractErrorMessage(error, fallback) });
  }
}
