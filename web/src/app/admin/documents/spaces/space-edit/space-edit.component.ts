import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { Observable } from 'rxjs';
import { CardComponent } from '../../../theme/shared/components/card/card.component';
import {
  PortalSchool,
  PortalSessionService
} from '../../../identity/services/portal-session.service';
import { UserManagementService } from '../../../identity/users/services/user-management.service';
import { notBlank, trimmedMaxLength } from '../../shared/form-validators';
import {
  CreateSpacePayload,
  DEFAULT_SPACE_LANGUAGE,
  DEFAULT_SPACE_PRIVACY,
  SPACE_DESCRIPTION_MAX_LENGTH,
  SPACE_LANGUAGE_OPTIONS,
  SPACE_NAME_MAX_LENGTH,
  SPACE_PRIVACY_OPTIONS,
  SpaceEntity,
  SpaceFormField,
  SpaceLanguage,
  SpacePrivacy,
  UpdateSpacePayload
} from '../models/space.model';
import { SpaceManagementService } from '../services/space-management.service';
import { schoolsManagingSpaces } from '../utils/space-scope.util';

const FIELD_LABELS: Record<SpaceFormField, string> = {
  schoolId: 'School',
  name: 'Name',
  description: 'Description',
  language: 'Main language',
  privacy: 'Privacy'
};

/**
 * Create (`/admin/spaces/new`) or edit (`/admin/spaces/:id/edit`) a space (#113).
 * The school is picked by platform admins, fixed for single-school users and chosen among their
 * schools by staff managing documents in several; it cannot change once the space exists.
 */
@Component({
  selector: 'app-space-edit',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, CardComponent],
  templateUrl: './space-edit.component.html',
  styleUrls: ['./space-edit.component.scss']
})
export class SpaceEditComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly spaceService = inject(SpaceManagementService);
  private readonly userService = inject(UserManagementService);
  private readonly toast = inject(GoeyToastService, { optional: true });
  readonly session = inject(PortalSessionService);

  readonly nameMaxLength = SPACE_NAME_MAX_LENGTH;
  readonly descriptionMaxLength = SPACE_DESCRIPTION_MAX_LENGTH;
  readonly languageOptions = SPACE_LANGUAGE_OPTIONS;
  readonly privacyOptions = SPACE_PRIVACY_OPTIONS;

  readonly spaceId = this.route.snapshot.paramMap.get('id');
  readonly isEditMode = this.spaceId !== null;
  readonly space = signal<SpaceEntity | null>(null);
  readonly isLoading = signal(this.isEditMode);
  readonly loadFailed = signal(false);
  readonly isSaving = signal(false);
  readonly generalError = signal<string | null>(null);

  /** Schools platform admins can pick from (loaded from the API). */
  private readonly allSchools = signal<PortalSchool[]>([]);

  /** Schools offered in the school field. */
  readonly schoolOptions = computed<PortalSchool[]>(() =>
    this.session.isPlatformAdmin()
      ? this.allSchools()
      : schoolsManagingSpaces(this.session.user(), this.session.schools())
  );

  /** The school field is hidden when the user manages a single school (#113). */
  readonly showSchoolField = computed(
    () => this.session.isPlatformAdmin() || this.schoolOptions().length > 1
  );

  readonly form = this.fb.nonNullable.group({
    schoolId: ['', Validators.required],
    name: ['', [notBlank, trimmedMaxLength(SPACE_NAME_MAX_LENGTH)]],
    description: ['', trimmedMaxLength(SPACE_DESCRIPTION_MAX_LENGTH)],
    language: [DEFAULT_SPACE_LANGUAGE as SpaceLanguage, Validators.required],
    privacy: [DEFAULT_SPACE_PRIVACY as SpacePrivacy, Validators.required]
  });

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  readonly descriptionLength = computed(() => (this.formValue().description ?? '').trim().length);

  /** Edit mode: the fields that differ from the stored space (what PATCH sends). */
  readonly changes = computed<UpdateSpacePayload>(() => {
    const space = this.space();
    const value = this.formValue();
    if (!space) return {};
    const changes: UpdateSpacePayload = {};
    const name = (value.name ?? '').trim();
    const description = (value.description ?? '').trim();
    if (name !== space.name) changes.name = name;
    if (description !== (space.description ?? '')) changes.description = description || null;
    if (value.language && value.language !== space.language) changes.language = value.language;
    if (value.privacy && value.privacy !== space.privacy) changes.privacy = value.privacy;
    return changes;
  });

  readonly hasChanges = computed(() => Object.keys(this.changes()).length > 0);

  constructor() {
    if (this.session.isPlatformAdmin()) {
      this.userService
        .getSchools()
        .pipe(takeUntilDestroyed())
        .subscribe({
          next: (schools) => this.allSchools.set(schools),
          error: () =>
            this.generalError.set(
              'The list of schools could not be loaded. Please reload the page.'
            )
        });
    }

    if (this.isEditMode) {
      this.form.controls.schoolId.disable();
      this.loadSpace(this.spaceId as string);
    } else {
      this.presetSchool();
    }
  }

  /** Name of the space's school, shown read-only in edit mode. */
  schoolName(schoolId: string | null | undefined): string {
    if (!schoolId) return '—';
    const known = [...this.allSchools(), ...this.session.schools()].find((s) => s.id === schoolId);
    return known?.name ?? schoolId;
  }

  /** The message to show under a field, once the user has touched it or tried to save. */
  fieldError(field: SpaceFormField): string | null {
    const control = this.form.controls[field];
    if (!control.errors || !(control.touched || control.dirty)) return null;
    const errors = control.errors;
    if (errors['server']) return errors['server'] as string;
    if (errors['required']) return `${FIELD_LABELS[field]} is required.`;
    if (errors['maxlength']) {
      return `${FIELD_LABELS[field]} cannot exceed ${errors['maxlength'].requiredLength} characters.`;
    }
    return `${FIELD_LABELS[field]} is not valid.`;
  }

  onSubmit(): void {
    if (this.isSaving()) return;
    this.generalError.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      // A hidden school field cannot be fixed by the user: say why instead.
      if (this.form.controls.schoolId.invalid && !this.showSchoolField()) {
        this.generalError.set(
          'You do not manage documents in any school, so you cannot create a space.'
        );
      }
      return;
    }
    if (this.isEditMode && !this.hasChanges()) return;

    this.isSaving.set(true);
    const request: Observable<SpaceEntity> = this.isEditMode
      ? this.spaceService.updateSpace(this.spaceId as string, this.changes())
      : this.spaceService.createSpace(this.createPayload());

    request.subscribe({
      next: (space) => {
        this.isSaving.set(false);
        this.toast?.success(this.isEditMode ? 'Space updated' : 'Space created', {
          description: `"${space.name}" was saved.`
        });
        void this.router.navigate(['/admin/spaces']);
      },
      error: (error) => {
        this.isSaving.set(false);
        this.showSaveErrors(error);
      }
    });
  }

  cancel(): void {
    void this.router.navigate(['/admin/spaces']);
  }

  private createPayload(): CreateSpacePayload {
    const value = this.form.getRawValue();
    const description = value.description.trim();
    return {
      schoolId: value.schoolId,
      name: value.name.trim(),
      ...(description ? { description } : {}),
      language: value.language,
      privacy: value.privacy
    };
  }

  private showSaveErrors(error: unknown): void {
    const { fields, general } = this.spaceService.formErrors(error);
    const hidden: string[] = [];
    for (const [field, message] of Object.entries(fields) as [SpaceFormField, string][]) {
      const control = this.form.controls[field];
      if (control.disabled || (field === 'schoolId' && !this.showSchoolField())) {
        hidden.push(message);
        continue;
      }
      control.setErrors({ ...control.errors, server: message });
      control.markAsTouched();
    }
    const messages = [...hidden, ...(general ? [general] : [])];
    this.generalError.set(messages.length > 0 ? messages.join(' ') : null);
  }

  private presetSchool(): void {
    if (this.session.isPlatformAdmin()) {
      this.form.controls.schoolId.setValue(this.session.activeSchoolId() ?? '');
      return;
    }
    const options = this.schoolOptions();
    const active = this.session.activeSchoolId();
    const preset = options.find((s) => s.id === active) ?? options[0];
    this.form.controls.schoolId.setValue(preset?.id ?? '');
  }

  private loadSpace(id: string): void {
    this.spaceService.getSpace(id).subscribe({
      next: (space) => {
        this.space.set(space);
        this.form.reset({
          schoolId: space.schoolId ?? '',
          name: space.name,
          description: space.description ?? '',
          language: space.language,
          privacy: space.privacy
        });
        this.isLoading.set(false);
      },
      error: (error) => {
        this.isLoading.set(false);
        const message = this.spaceService.errorMessage(error, 'The space could not be loaded.');
        if (error?.status === 404) {
          this.toast?.error('Space not found', { description: message });
          void this.router.navigate(['/admin/spaces']);
          return;
        }
        this.loadFailed.set(true);
        this.generalError.set(message);
      }
    });
  }
}
