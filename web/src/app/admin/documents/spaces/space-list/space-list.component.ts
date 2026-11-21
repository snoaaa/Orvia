import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { EMPTY, Subject, catchError, switchMap } from 'rxjs';
import { PortalSessionService } from '../../../identity/services/portal-session.service';
import { ConfirmationModalComponent } from '../../../identity/users/components/confirmation-modal/confirmation-modal.component';
import { SchoolSummaryOption } from '../../../identity/users/models/user.model';
import { UserManagementService } from '../../../identity/users/services/user-management.service';
import {
  PaginatedSpaces,
  SPACE_SEARCH_MAX_LENGTH,
  SpaceEntity,
  spaceLanguageLabel,
  spacePrivacyOption
} from '../models/space.model';
import { SpaceManagementService } from '../services/space-management.service';

/** Debounce of the search box, in milliseconds. */
export const SPACE_SEARCH_DEBOUNCE_MS = 300;

/**
 * Spaces of the signed-in user's scope (#113, spec §4.1 / §4.5): search, pagination and delete.
 * - Platform admin: every school, with a school filter and a school column.
 * - School admin / staff with document-management rights: the active school only (the header selector
 *   picks it when they have several); no school filter or column.
 */
@Component({
  selector: 'app-space-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ConfirmationModalComponent],
  templateUrl: './space-list.component.html',
  styleUrls: ['./space-list.component.scss']
})
export class SpaceListComponent {
  private readonly spaceService = inject(SpaceManagementService);
  private readonly userService = inject(UserManagementService);
  private readonly toast = inject(GoeyToastService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  readonly session = inject(PortalSessionService);

  readonly searchMaxLength = SPACE_SEARCH_MAX_LENGTH;
  readonly languageLabel = spaceLanguageLabel;
  readonly privacyOption = spacePrivacyOption;

  readonly spaces = signal<SpaceEntity[]>([]);
  readonly total = signal(0);
  readonly currentPage = signal(1);
  readonly pageSize = signal(10);
  readonly totalPages = signal(1);
  readonly isInitialLoading = signal(true);
  readonly isUpdating = signal(false);
  readonly errorMessage = signal('');

  readonly searchTerm = signal('');
  /** School filter of platform admins ('' = all schools). */
  readonly selectedSchoolId = signal('');
  /** Schools offered to platform admins in the filter. */
  readonly schools = signal<SchoolSummaryOption[]>([]);

  readonly deleteTarget = signal<SpaceEntity | null>(null);
  readonly isDeleting = signal(false);

  readonly canCreate = computed(() => this.session.hasPermission('spaces:create'));
  readonly canEdit = computed(() => this.session.hasPermission('spaces:update'));
  readonly canDelete = computed(() => this.session.hasPermission('spaces:delete'));

  /** The school column only helps platform admins looking at every school. */
  readonly showSchoolColumn = computed(
    () => this.session.isPlatformAdmin() && !this.selectedSchoolId()
  );
  readonly columnCount = computed(() => (this.showSchoolColumn() ? 6 : 5));

  /**
   * Name of the school the list is limited to (not for platform admins). Hidden while only its id is
   * known: `/auth/me` does not always carry school names.
   */
  readonly activeSchoolLabel = computed<string | null>(() => {
    if (this.session.isPlatformAdmin()) return null;
    const id = this.session.activeSchoolId();
    const name = this.session.activeSchoolName();
    return name && name !== id ? name : null;
  });
  readonly hasFilters = computed(
    () => this.searchTerm().trim() !== '' || this.selectedSchoolId() !== ''
  );

  private readonly reload$ = new Subject<void>();
  private searchTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // switchMap drops the answer of an older request, so a slow page never replaces a newer one.
    // Errors are handled per request, so one failed load does not stop the next ones.
    this.reload$
      .pipe(
        switchMap(() =>
          this.spaceService
            .getSpaces({
              page: this.currentPage(),
              limit: this.pageSize(),
              search: this.searchTerm(),
              schoolId: this.effectiveSchoolId()
            })
            .pipe(
              catchError((error: unknown) => {
                this.showLoadError(error);
                return EMPTY;
              })
            )
        ),
        takeUntilDestroyed()
      )
      .subscribe((res) => this.showPage(res));

    // Loads the first page, then again whenever the header school selector changes the active school.
    effect(() => {
      this.session.activeSchoolId();
      untracked(() => {
        this.currentPage.set(1);
        this.loadSpaces();
      });
    });

    if (this.session.isPlatformAdmin()) {
      this.userService
        .getSchools()
        .pipe(takeUntilDestroyed())
        .subscribe({
          next: (schools) => this.schools.set(schools),
          error: () => this.schools.set([])
        });
    }

    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));
  }

  /** The `schoolId` sent to the API: the platform admin's filter, or the active school of everyone else. */
  effectiveSchoolId(): string | undefined {
    if (this.session.isPlatformAdmin()) return this.selectedSchoolId() || undefined;
    return this.session.activeSchoolId() ?? undefined;
  }

  loadSpaces(): void {
    if (this.spaces().length > 0) this.isUpdating.set(true);
    this.errorMessage.set('');
    this.reload$.next();
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.currentPage.set(1);
      this.loadSpaces();
    }, SPACE_SEARCH_DEBOUNCE_MS);
  }

  clearFilters(): void {
    clearTimeout(this.searchTimer);
    this.searchTerm.set('');
    this.selectedSchoolId.set('');
    this.currentPage.set(1);
    this.loadSpaces();
  }

  onSchoolFilterChange(schoolId: string): void {
    this.selectedSchoolId.set(schoolId);
    this.currentPage.set(1);
    this.loadSpaces();
  }

  changePageSize(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
    this.loadSpaces();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
    this.loadSpaces();
  }

  schoolName(schoolId: string | null): string {
    if (!schoolId) return '—';
    const known = [...this.schools(), ...this.session.schools()].find((s) => s.id === schoolId);
    return known?.name ?? schoolId;
  }

  openDeleteModal(space: SpaceEntity): void {
    this.deleteTarget.set(space);
  }

  closeDeleteModal(): void {
    if (this.isDeleting()) return;
    this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const space = this.deleteTarget();
    if (!space || this.isDeleting()) return;
    this.isDeleting.set(true);

    this.spaceService.deleteSpace(space.id).subscribe({
      next: () => {
        this.toast?.success('Space deleted', { description: `"${space.name}" was deleted.` });
        this.afterDelete();
      },
      error: (error) => {
        if (error?.status === 404) {
          // Already deleted, for example by someone else: the list is simply out of date.
          this.toast?.info('Space already deleted', {
            description: `"${space.name}" no longer exists.`
          });
          this.afterDelete();
          return;
        }
        this.isDeleting.set(false);
        this.deleteTarget.set(null);
        this.toast?.error('Could not delete the space', {
          description: this.spaceService.errorMessage(error, 'The space could not be deleted.')
        });
      }
    });
  }

  private afterDelete(): void {
    this.isDeleting.set(false);
    this.deleteTarget.set(null);
    // Deleting the last space of the last page shows the previous page instead of an empty one.
    if (this.spaces().length === 1 && this.currentPage() > 1) {
      this.currentPage.update((p) => p - 1);
    }
    this.loadSpaces();
  }

  private showPage(res: PaginatedSpaces): void {
    this.spaces.set(res.data);
    this.total.set(res.total);
    this.currentPage.set(res.page);
    this.pageSize.set(res.limit);
    this.totalPages.set(res.totalPages || Math.ceil(res.total / res.limit) || 1);
    this.isInitialLoading.set(false);
    this.isUpdating.set(false);
  }

  private showLoadError(error: unknown): void {
    this.isInitialLoading.set(false);
    this.isUpdating.set(false);
    const message = this.spaceService.errorMessage(error, 'Failed to load the spaces.');
    this.errorMessage.set(message);
    this.toast?.error('Failed to load spaces', { description: message });
  }
}
