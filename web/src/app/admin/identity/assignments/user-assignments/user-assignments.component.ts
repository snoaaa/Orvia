import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { GoeyToastService } from 'goey-toast-angular';
import { CardComponent } from '../../../theme/shared/components/card/card.component';
import { ConfirmationModalComponent } from '../../users/components/confirmation-modal/confirmation-modal.component';
import { UserSchoolAssignment } from '../../users/models/user.model';
import { AssignmentService } from '../services/assignment.service';

export const ASSIGN_ROLE_PERMISSION = 'users:assign_role';

@Component({
  selector: 'app-user-assignments',
  standalone: true,
  imports: [CommonModule, CardComponent, ConfirmationModalComponent],
  templateUrl: './user-assignments.component.html'
})
export class UserAssignmentsComponent implements OnInit {
  private readonly assignmentService = inject(AssignmentService);
  private readonly toast = inject(GoeyToastService);

  readonly userId = input.required<string>();
  readonly assignments = input<UserSchoolAssignment[]>([]);
  /** Emitted after the list changed on the server so the parent reloads the user. */
  readonly changed = output<void>();

  /** Unknown until GET /auth/me answers; the card stays hidden until the admin holds users:assign_role. */
  readonly canManage = signal<boolean>(false);
  readonly permissionsLoaded = signal<boolean>(false);

  readonly removeTarget = signal<UserSchoolAssignment | null>(null);
  readonly modalLoading = signal<boolean>(false);

  ngOnInit(): void {
    this.assignmentService.getCurrentAdmin().subscribe({
      next: (me) => {
        this.canManage.set((me.permissions ?? []).includes(ASSIGN_ROLE_PERMISSION));
        this.permissionsLoaded.set(true);
      },
      error: () => {
        this.canManage.set(false);
        this.permissionsLoaded.set(true);
      }
    });
  }

  openRemoveModal(assignment: UserSchoolAssignment): void {
    this.removeTarget.set(assignment);
  }

  closeModal(): void {
    if (this.modalLoading()) return;
    this.removeTarget.set(null);
  }

  confirmRemove(): void {
    const target = this.removeTarget();
    if (!target?.id || this.modalLoading()) return;

    this.modalLoading.set(true);
    this.assignmentService.removeAssignment(target.id).subscribe({
      next: () => {
        this.modalLoading.set(false);
        this.removeTarget.set(null);
        this.toast.success('Assignment Removed', {
          description: `${target.role} in ${target.schoolName} has been removed.`
        });
        this.changed.emit();
      },
      error: (error) => {
        this.modalLoading.set(false);
        this.removeTarget.set(null);
        const msg = this.assignmentService.extractErrorMessage(error, 'Failed to remove the assignment.');
        this.toast.error('Removal Failed', { description: msg });
      }
    });
  }
}
