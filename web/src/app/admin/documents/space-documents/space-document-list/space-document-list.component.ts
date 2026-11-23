import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { EMPTY, Subject, catchError, finalize, switchMap } from 'rxjs';
import { PortalSessionService } from '../../../identity/services/portal-session.service';
import { ConfirmationModalComponent } from '../../../identity/users/components/confirmation-modal/confirmation-modal.component';
import { SpaceEntity } from '../../spaces/models/space.model';
import { SpaceManagementService } from '../../spaces/services/space-management.service';
import { sessionGrantsInSchool } from '../../shared/api-permissions.util';
import { DocumentMetadataModalComponent } from '../document-metadata-modal/document-metadata-modal.component';
import {
  DOCUMENT_SEARCH_MAX_LENGTH,
  DOCUMENT_STATUS_OPTIONS,
  DOCUMENT_TYPE_OPTIONS,
  DocumentStatus,
  DocumentType,
  PROCESSING_STATUSES,
  PaginatedDocuments,
  SpaceDocument,
  documentStatusOption,
  documentTypeLabel,
  DOCUMENT_MAX_TAGS,
  tagList
} from '../models/document.model';
import { SpaceDocumentService } from '../services/space-document.service';

/** Debounce of the search and tag boxes, in milliseconds. */
export const DOCUMENT_FILTER_DEBOUNCE_MS = 300;
/** How often the list refreshes while a document on the page is still being processed. */
export const DOCUMENT_STATUS_REFRESH_MS = 5000;
/** How long an opened file stays available to its browser tab. */
const OPENED_FILE_URL_LIFETIME_MS = 60_000;

/**
 * Documents of one space (#114, spec §4.5): filters, search, pagination and row actions.
 * Status changes show up by themselves: while a document of the page is processing, the page is
 * fetched again every few seconds (not while the browser tab is hidden).
 */
@Component({
  selector: 'app-space-document-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ConfirmationModalComponent,
    DocumentMetadataModalComponent
  ],
  templateUrl: './space-document-list.component.html',
  styleUrls: ['./space-document-list.component.scss']
})
export class SpaceDocumentListComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly documentService = inject(SpaceDocumentService);
  private readonly spaceService = inject(SpaceManagementService);
  private readonly toast = inject(GoeyToastService, { optional: true });
  private readonly browserDocument = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  readonly session = inject(PortalSessionService);

  readonly searchMaxLength = DOCUMENT_SEARCH_MAX_LENGTH;
  readonly statusOptions = DOCUMENT_STATUS_OPTIONS;
  readonly typeOptions = DOCUMENT_TYPE_OPTIONS;
  readonly statusOption = documentStatusOption;
  readonly typeLabel = documentTypeLabel;
  readonly tagsOf = tagList;

  readonly spaceId = this.route.snapshot.paramMap.get('spaceId') ?? '';
  readonly space = signal<SpaceEntity | null>(null);
  /** Why the space could not be loaded (kept apart from the documents' error, which a page load clears). */
  readonly spaceError = signal('');

  readonly documents = signal<SpaceDocument[]>([]);
  readonly total = signal(0);
  readonly currentPage = signal(1);
  readonly pageSize = signal(10);
  readonly totalPages = signal(1);
  readonly isInitialLoading = signal(true);
  readonly isUpdating = signal(false);
  readonly errorMessage = signal('');

  /** What is typed in the search and tag boxes. */
  readonly searchInput = signal('');
  readonly tagInput = signal('');
  /** The search and tags the list shows: the typed text once typing pauses (or another action needs a page). */
  readonly searchTerm = signal('');
  readonly tagFilter = signal('');
  readonly maxTags = DOCUMENT_MAX_TAGS;
  /** More tags typed than the API accepts: the list keeps the last valid tags until they are fixed. */
  readonly tooManyTags = computed(
    () => new Set(tagList(this.tagInput().toLowerCase())).size > DOCUMENT_MAX_TAGS
  );
  readonly statusFilter = signal<DocumentStatus | ''>('');
  readonly typeFilter = signal<DocumentType | ''>('');

  readonly editTarget = signal<SpaceDocument | null>(null);
  readonly deleteTarget = signal<SpaceDocument | null>(null);
  readonly isDeleting = signal(false);
  /** Documents whose file is being downloaded to open it (each row on its own). */
  readonly openingIds = signal<ReadonlySet<string>>(new Set());

  /**
   * Edit, versions, access and delete need `documents:manage` with the API's rules (any document or space
   * management permission grants it there), so the buttons shown always work.
   */
  readonly canManage = computed(() =>
    sessionGrantsInSchool(
      this.session,
      this.space()?.schoolId ?? this.session.activeSchoolId(),
      'documents:manage'
    )
  );
  readonly hasFilters = computed(
    () =>
      this.searchTerm().trim() !== '' ||
      this.tagFilter().trim() !== '' ||
      this.statusFilter() !== '' ||
      this.typeFilter() !== ''
  );
  /** True while a document of the page is still moving through the pipeline. */
  readonly hasProcessing = computed(() =>
    this.documents().some((d) => PROCESSING_STATUSES.has(d.currentVersion?.status ?? ''))
  );

  private readonly reload$ = new Subject<void>();
  private filterTimer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  /** Whether the request in flight is an automatic status refresh. */
  private quietLoad = false;

  constructor() {
    // switchMap keeps only the answer of the latest request; errors are handled per request.
    this.reload$
      .pipe(
        switchMap(() =>
          this.documentService
            .getDocuments({
              spaceId: this.spaceId,
              page: this.currentPage(),
              limit: this.pageSize(),
              q: this.searchTerm(),
              tags: this.tagFilter(),
              status: this.statusFilter() || undefined,
              type: this.typeFilter() || undefined
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

    this.loadSpace();
    this.loadDocuments();

    const onVisibilityChange = () => {
      if (!this.browserDocument.hidden && this.hasProcessing()) this.loadDocuments(true);
    };
    this.browserDocument.addEventListener('visibilitychange', onVisibilityChange);
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.filterTimer);
      clearTimeout(this.refreshTimer);
      this.browserDocument.removeEventListener('visibilitychange', onVisibilityChange);
    });
  }

  /**
   * Fetches the page again. `quiet` is the automatic status refresh: no loading indicator, no error message
   * (it simply tries again later), and it keeps the filters the list shows instead of applying half-typed text.
   */
  loadDocuments(quiet = false): void {
    clearTimeout(this.refreshTimer);
    if (!quiet) {
      this.applyTypedFilters();
      if (this.documents().length > 0) this.isUpdating.set(true);
      this.errorMessage.set('');
    }
    this.quietLoad = quiet;
    this.reload$.next();
  }

  onSearchChange(term: string): void {
    this.searchInput.set(term);
    this.reloadAfterTyping();
  }

  onTagFilterChange(tags: string): void {
    this.tagInput.set(tags);
    this.reloadAfterTyping();
  }

  /** Retries what failed: the space, the documents, or both. */
  retry(): void {
    if (!this.space()) this.loadSpace();
    this.loadDocuments();
  }

  onStatusFilterChange(status: DocumentStatus | ''): void {
    this.statusFilter.set(status);
    this.firstPage();
  }

  onTypeFilterChange(type: DocumentType | ''): void {
    this.typeFilter.set(type);
    this.firstPage();
  }

  clearFilters(): void {
    clearTimeout(this.filterTimer);
    this.filterTimer = undefined;
    this.searchInput.set('');
    this.tagInput.set('');
    this.searchTerm.set('');
    this.tagFilter.set('');
    this.statusFilter.set('');
    this.typeFilter.set('');
    this.firstPage();
  }

  changePageSize(size: number): void {
    this.pageSize.set(size);
    this.firstPage();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
    this.loadDocuments();
  }

  /**
   * Opens the current version in a new tab. The tab is opened right away (inside the click, so pop-up
   * blockers allow it) and receives the file once it is downloaded with the session's token.
   */
  openDocument(doc: SpaceDocument): void {
    if (this.isOpening(doc.id)) return;
    const tab = this.browserDocument.defaultView?.open('', '_blank');
    if (!tab) {
      this.toast?.error('Could not open the document', {
        description: 'Your browser blocked the new tab. Please allow pop-ups for this site.'
      });
      return;
    }
    this.setOpening(doc.id, true);
    let shown = false;
    this.documentService
      .getCurrentFile(doc.id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.setOpening(doc.id, false);
          // Failed, or the page was left before the file arrived: do not leave an empty tab behind.
          if (!shown) tab.close();
        })
      )
      .subscribe({
        next: (file) => {
          const url = URL.createObjectURL(file);
          tab.location.href = url;
          shown = true;
          setTimeout(() => URL.revokeObjectURL(url), OPENED_FILE_URL_LIFETIME_MS);
        },
        error: (error) =>
          this.toast?.error('Could not open the document', {
            description: this.documentService.errorMessage(error, 'The file could not be loaded.')
          })
      });
  }

  isOpening(id: string): boolean {
    return this.openingIds().has(id);
  }

  openEditModal(doc: SpaceDocument): void {
    this.editTarget.set(doc);
  }

  closeEditModal(): void {
    this.editTarget.set(null);
  }

  onMetadataSaved(updated: SpaceDocument): void {
    this.editTarget.set(null);
    this.toast?.success('Document updated', { description: `"${updated.title}" was saved.` });
    this.loadDocuments();
  }

  openDeleteModal(doc: SpaceDocument): void {
    this.deleteTarget.set(doc);
  }

  closeDeleteModal(): void {
    if (!this.isDeleting()) this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const doc = this.deleteTarget();
    if (!doc || this.isDeleting()) return;
    this.isDeleting.set(true);

    this.documentService.deleteDocument(doc.id).subscribe({
      next: () => {
        this.toast?.success('Document deleted', { description: `"${doc.title}" was deleted.` });
        this.afterDelete();
      },
      error: (error) => {
        if (error?.status === 404) {
          // Already deleted, for example by someone else: the list is simply out of date.
          this.toast?.info('Document already deleted', {
            description: `"${doc.title}" no longer exists.`
          });
          this.afterDelete();
          return;
        }
        this.isDeleting.set(false);
        this.deleteTarget.set(null);
        this.toast?.error('Could not delete the document', {
          description: this.documentService.errorMessage(
            error,
            'The document could not be deleted.'
          )
        });
      }
    });
  }

  private afterDelete(): void {
    this.isDeleting.set(false);
    this.deleteTarget.set(null);
    // Deleting the last document of the last page shows the previous page instead of an empty one.
    if (this.documents().length === 1 && this.currentPage() > 1) {
      this.currentPage.update((p) => p - 1);
    }
    this.loadDocuments();
  }

  private reloadAfterTyping(): void {
    clearTimeout(this.filterTimer);
    this.filterTimer = setTimeout(() => {
      this.filterTimer = undefined;
      // Nothing to send while the typed tags are over the limit and the search is unchanged.
      if (this.typedFiltersChanged()) this.loadDocuments();
    }, DOCUMENT_FILTER_DEBOUNCE_MS);
  }

  /**
   * Applies what was typed in the search and tag boxes before a request, and cancels the pending one: a
   * page, filter or size change made while typing never sends the old text, and the timer never sends a
   * second request afterwards. New text starts from the first page. Too many tags are not sent (the API
   * would refuse them); the box shows why.
   */
  private applyTypedFilters(): void {
    clearTimeout(this.filterTimer);
    this.filterTimer = undefined;
    if (this.typedFiltersChanged()) {
      this.searchTerm.set(this.searchInput());
      if (!this.tooManyTags()) this.tagFilter.set(this.tagInput());
      this.currentPage.set(1);
    }
  }

  /** Whether the typed search or (valid) tags differ from those the list shows. */
  private typedFiltersChanged(): boolean {
    return (
      this.searchInput() !== this.searchTerm() ||
      (!this.tooManyTags() && this.tagInput() !== this.tagFilter())
    );
  }

  private setOpening(id: string, opening: boolean): void {
    this.openingIds.update((ids) => {
      const next = new Set(ids);
      if (opening) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  private firstPage(): void {
    this.currentPage.set(1);
    this.loadDocuments();
  }

  private loadSpace(): void {
    this.spaceError.set('');
    this.spaceService
      .getSpace(this.spaceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (space) => this.space.set(space),
        error: (error) => {
          const message = this.spaceService.errorMessage(error, 'The space could not be loaded.');
          // 400 is an invalid id in the address and 403 a space of another school: none of them is
          // a space this user can open.
          if ([400, 403, 404].includes(error?.status)) {
            this.toast?.error('Space not found', { description: message });
            void this.router.navigate(['/admin/spaces']);
            return;
          }
          this.spaceError.set(message);
        }
      });
  }

  private showPage(res: PaginatedDocuments): void {
    const totalPages = res.totalPages || Math.ceil(res.total / res.limit) || 1;
    // A page past the end (documents deleted meanwhile, by someone else too): show the last page instead.
    if (res.data.length === 0 && res.total > 0 && res.page > totalPages) {
      this.currentPage.set(totalPages);
      this.loadDocuments(this.quietLoad);
      return;
    }
    this.documents.set(res.data);
    this.total.set(res.total);
    this.currentPage.set(res.page);
    this.pageSize.set(res.limit);
    this.totalPages.set(totalPages);
    this.isInitialLoading.set(false);
    this.isUpdating.set(false);
    this.errorMessage.set('');
    this.scheduleStatusRefresh();
  }

  private showLoadError(error: unknown): void {
    this.isInitialLoading.set(false);
    this.isUpdating.set(false);
    if (this.quietLoad) {
      // A failed automatic refresh (network blip...) is tried again later, without bothering the user.
      this.scheduleStatusRefresh();
      return;
    }
    const message = this.documentService.errorMessage(error, 'Failed to load the documents.');
    this.errorMessage.set(message);
    this.toast?.error('Failed to load documents', { description: message });
  }

  /** Fetches the page again in a few seconds while one of its documents is processing. */
  private scheduleStatusRefresh(): void {
    clearTimeout(this.refreshTimer);
    if (!this.hasProcessing()) return;
    this.refreshTimer = setTimeout(() => {
      if (!this.browserDocument.hidden) this.loadDocuments(true);
    }, DOCUMENT_STATUS_REFRESH_MS);
  }
}
