import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { EMPTY, Subject, catchError, switchMap } from 'rxjs';
import { PortalSessionService } from '../../../identity/services/portal-session.service';
import { ConfirmationModalComponent } from '../../../identity/users/components/confirmation-modal/confirmation-modal.component';
import { grantsApiPermission, sessionGrants } from '../../shared/api-permissions.util';
import {
  PaginatedSpaces,
  SchoolOption,
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

  /** What is typed in the search box. */
  readonly searchInput = signal('');
  /** The search the list shows: the typed text once typing pauses (or another action needs a page). */
  readonly searchTerm = signal('');
  /** School filter of platform admins ('' = all schools). */
  readonly selectedSchoolId = signal('');
  /** Schools offered to platform admins in the filter. */
  readonly schools = signal<SchoolOption[]>([]);

  readonly deleteTarget = signal<SpaceEntity | null>(null);
  readonly isDeleting = signal(false);

  /** Actions are offered only when the API accepts them in the active/target school (same permission rules, no 403). */
  readonly canCreate = computed(() =>
    this.hasSchoolPermission(this.session.activeSchoolId(), 'spaces:create')
  );
  readonly canEdit = computed(() =>
    this.hasSchoolPermission(this.session.activeSchoolId(), 'spaces:update')
  );
  readonly canDelete = computed(() =>
    this.hasSchoolPermission(this.session.activeSchoolId(), 'spaces:delete')
  );

  canEditSpace(space: SpaceEntity): boolean {
    return this.hasSchoolPermission(space.schoolId, 'spaces:update');
  }

  canDeleteSpace(space: SpaceEntity): boolean {
    return this.hasSchoolPermission(space.schoolId, 'spaces:delete');
  }

  private hasSchoolPermission(schoolId: string | null | undefined, permission: string): boolean {
    if (this.session.isPlatformAdmin()) return true;
    const user = this.session.user();
    if (!user) return false;
    const assignments = user.assignments ?? [];
    if (assignments.length === 0) {
      return sessionGrants(this.session, permission);
    }
    const scoped = schoolId
      ? assignments.filter((a) => a.schoolId === schoolId || a.scope === 'platform')
      : assignments;
    return scoped.some((a) => grantsApiPermission(a.permissions ?? [], permission));
  }

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

    // Loads the first page, closes any pending delete modal, then reloads when the active school changes.
    effect(() => {
      this.session.activeSchoolId();
      untracked(() => {
        this.deleteTarget.set(null);
        this.currentPage.set(1);
        this.loadSpaces();
      });
    });

    if (this.session.isPlatformAdmin()) {
      this.spaceService
        .getAllSchools()
        .pipe(takeUntilDestroyed())
        .subscribe({
          next: (schools) => this.schools.set(schools),
          error: (error) =>
            this.toast?.warning('School names could not be loaded', {
              description: this.spaceService.errorMessage(error, 'The school filter is empty.')
            })
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
    this.applyTypedSearch();
    if (this.spaces().length > 0) this.isUpdating.set(true);
    this.errorMessage.set('');
    this.reload$.next();
  }

  onSearchChange(term: string): void {
    this.searchInput.set(term);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadSpaces(), SPACE_SEARCH_DEBOUNCE_MS);
  }

  clearFilters(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = undefined;
    this.searchInput.set('');
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

  /**
   * Applies what was typed in the search box before any request, and cancels the pending search: a page,
   * page size or filter change made while typing never sends the old search, and the timer never sends a
   * second request afterwards. A new search starts from the first page.
   */
  private applyTypedSearch(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = undefined;
    if (this.searchInput() !== this.searchTerm()) {
      this.searchTerm.set(this.searchInput());
      this.currentPage.set(1);
    }
  }

  private showPage(res: PaginatedSpaces): void {
    const totalPages = res.totalPages || Math.ceil(res.total / res.limit) || 1;
    // A page past the end (spaces deleted meanwhile, by someone else too): show the last page instead.
    if (res.data.length === 0 && res.total > 0 && res.page > totalPages) {
      this.currentPage.set(totalPages);
      this.loadSpaces();
      return;
    }
    this.spaces.set(res.data);
    this.total.set(res.total);
    this.currentPage.set(res.page);
    this.pageSize.set(res.limit);
    this.totalPages.set(totalPages);
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
