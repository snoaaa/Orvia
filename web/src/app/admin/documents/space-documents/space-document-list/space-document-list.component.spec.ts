import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { Subject, of, throwError } from 'rxjs';
import {
  PortalSessionService,
  PortalSessionUser
} from '../../../identity/services/portal-session.service';
import { SpaceManagementService } from '../../spaces/services/space-management.service';
import { DocumentStatus, PaginatedDocuments, SpaceDocument } from '../models/document.model';
import { SpaceDocumentService } from '../services/space-document.service';
import {
  DOCUMENT_FILTER_DEBOUNCE_MS,
  DOCUMENT_STATUS_REFRESH_MS,
  SpaceDocumentListComponent
} from './space-document-list.component';

function user(permissions: string[]): PortalSessionUser {
  return {
    id: 'u1',
    email: 'u1@school.edu',
    fullName: 'User One',
    status: 'ACTIVE',
    role: null,
    permissions,
    schoolIds: ['school-a'],
    isPlatformAdmin: false,
    assignments: [
      {
        role: 'SCHOOL_ADMIN',
        scope: 'school',
        schoolId: 'school-a',
        schoolName: 'School A',
        groupId: null,
        permissions
      }
    ]
  };
}

const MANAGER = user(['documents:manage', 'documents:read', 'spaces:read']);
const READER = user(['documents:read', 'spaces:read']);

const doc = (
  id: string,
  status: DocumentStatus | null,
  overrides: Partial<SpaceDocument> = {}
): SpaceDocument => ({
  id,
  spaceId: 'sp1',
  title: `Doc ${id}`,
  author: '',
  tags: 'math,exam',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-02T10:00:00Z',
  currentVersion: status
    ? {
        id: `${id}-v`,
        documentId: id,
        versionNo: 2,
        mimeType: 'application/pdf',
        status,
        statusError: status === 'error' ? 'Page 3 is unreadable' : null,
        pageCount: 3,
        createdAt: '2026-11-01T10:00:00Z',
        updatedAt: '2026-11-01T10:00:00Z'
      }
    : null,
  ...overrides
});

const page = (
  data: SpaceDocument[],
  total = data.length,
  pageNo = 1,
  limit = 10
): PaginatedDocuments => ({
  data,
  total,
  page: pageNo,
  limit
});

describe('SpaceDocumentListComponent', () => {
  let fixture: ComponentFixture<SpaceDocumentListComponent>;
  let component: SpaceDocumentListComponent;
  let session: PortalSessionService;
  let router: Router;
  let documentService: {
    getDocuments: ReturnType<typeof vi.fn>;
    deleteDocument: ReturnType<typeof vi.fn>;
    getCurrentFile: ReturnType<typeof vi.fn>;
    errorMessage: ReturnType<typeof vi.fn>;
  };
  let spaceService: { getSpace: ReturnType<typeof vi.fn>; errorMessage: ReturnType<typeof vi.fn> };
  let toast: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const lastQuery = () => documentService.getDocuments.mock.calls.at(-1)?.[0];
  const loads = () => documentService.getDocuments.mock.calls.length;

  function create(signedIn: PortalSessionUser = MANAGER): void {
    session.setUser(signedIn);
    fixture = TestBed.createComponent(SpaceDocumentListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    documentService = {
      getDocuments: vi.fn().mockReturnValue(of(page([doc('d1', 'available'), doc('d2', 'error')]))),
      deleteDocument: vi.fn().mockReturnValue(of({})),
      getCurrentFile: vi.fn().mockReturnValue(of(new Blob(['%PDF']))),
      errorMessage: vi.fn().mockReturnValue('Something went wrong.')
    };
    spaceService = {
      getSpace: vi
        .fn()
        .mockReturnValue(of({ id: 'sp1', name: 'Mathematics', description: 'Algebra' })),
      errorMessage: vi.fn().mockReturnValue('Space error.')
    };
    toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SpaceDocumentListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SpaceDocumentService, useValue: documentService },
        { provide: SpaceManagementService, useValue: spaceService },
        { provide: GoeyToastService, useValue: toast },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ spaceId: 'sp1' }) } }
        }
      ]
    }).compileComponents();
    session = TestBed.inject(PortalSessionService);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('list', () => {
    it('shows only the documents of the space in the address, with its name', () => {
      create();
      expect(lastQuery()).toEqual({
        spaceId: 'sp1',
        page: 1,
        limit: 10,
        q: '',
        tags: '',
        status: undefined,
        type: undefined
      });
      expect(element().querySelector('#space-documents-title')?.textContent).toContain(
        'Mathematics'
      );
    });

    it('shows title, tags, type, current version, status and date', () => {
      create();
      const rows = element().querySelectorAll('tbody tr');
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('Doc d1');
      expect(rows[0].textContent).toContain('math');
      expect(rows[0].textContent).toContain('PDF');
      expect(rows[0].textContent).toContain('v2');
      expect(rows[0].textContent).toContain('Available');
      expect(rows[0].textContent).toContain('Nov 2, 2026');
    });

    it('shows why processing failed', () => {
      create();
      const badge = element()
        .querySelectorAll('tbody tr')[1]
        .querySelector('.status-badge') as HTMLElement;
      expect(badge.textContent).toContain('Error');
      expect(badge.getAttribute('title')).toBe('Page 3 is unreadable');
    });

    it('shows a document without a file', () => {
      documentService.getDocuments.mockReturnValue(of(page([doc('d3', null)])));
      create();
      const row = element().querySelector('tbody tr') as HTMLElement;
      expect(row.textContent).toContain('No file');
      expect((row.querySelector('.document-open-action') as HTMLButtonElement).disabled).toBe(true);
    });

    it('goes back to the spaces when the space does not exist', () => {
      spaceService.getSpace.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 404 }))
      );
      create();
      expect(toast.error).toHaveBeenCalledWith('Space not found', { description: 'Space error.' });
      expect(router.navigate).toHaveBeenCalledWith(['/admin/spaces']);
    });

    it('shows a load error and loads again on retry', () => {
      documentService.getDocuments.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      create();
      expect(component.errorMessage()).toBe('Something went wrong.');

      documentService.getDocuments.mockReturnValue(of(page([doc('d1', 'available')])));
      component.loadDocuments();
      expect(component.errorMessage()).toBe('');
      expect(component.documents().length).toBe(1);
    });

    it('keeps only the answer of the latest request', () => {
      create();
      const slow = new Subject<PaginatedDocuments>();
      const fast = new Subject<PaginatedDocuments>();
      documentService.getDocuments.mockReturnValueOnce(slow).mockReturnValueOnce(fast);
      component.loadDocuments();
      component.loadDocuments();
      fast.next(page([doc('new', 'available')]));
      slow.next(page([doc('old', 'available')]));
      expect(component.documents().map((d) => d.id)).toEqual(['new']);
    });
  });

  describe('filters', () => {
    it('searches title and tags after a pause in typing, from the first page', () => {
      create();
      vi.useFakeTimers();
      component.currentPage.set(3);
      const before = loads();
      component.onSearchChange('alg');
      component.onTagFilterChange('math');
      vi.advanceTimersByTime(DOCUMENT_FILTER_DEBOUNCE_MS - 1);
      expect(loads()).toBe(before);
      vi.advanceTimersByTime(1);
      expect(loads()).toBe(before + 1);
      expect(lastQuery()).toMatchObject({ page: 1, q: 'alg', tags: 'math' });
    });

    it('filters by status and type at once, and clears them', () => {
      create();
      component.onStatusFilterChange('error');
      component.onTypeFilterChange('image');
      expect(lastQuery()).toMatchObject({ page: 1, status: 'error', type: 'image' });
      expect(component.hasFilters()).toBe(true);

      component.clearFilters();
      expect(lastQuery()).toMatchObject({ q: '', tags: '', status: undefined, type: undefined });
      expect(component.hasFilters()).toBe(false);
    });

    it('offers to clear the filters when nothing matches', () => {
      documentService.getDocuments.mockReturnValue(of(page([])));
      create();
      expect(element().querySelector('#document-list-empty')?.textContent).toContain(
        'No document in this space yet'
      );
      component.onStatusFilterChange('error');
      fixture.detectChanges();
      expect(element().querySelector('#document-list-empty')?.textContent).toContain(
        'No document matches'
      );
    });

    it('pages and changes the page size', () => {
      documentService.getDocuments.mockReturnValue(of(page([doc('d1', 'available')], 30, 1, 10)));
      create();
      expect(component.totalPages()).toBe(3);
      component.goToPage(2);
      expect(lastQuery()).toMatchObject({ page: 2 });
      component.changePageSize(50);
      expect(lastQuery()).toMatchObject({ page: 1, limit: 50 });
    });
  });

  describe('status updates', () => {
    it('refreshes quietly while a document is processing, and stops once none is', () => {
      vi.useFakeTimers();
      documentService.getDocuments.mockReturnValue(of(page([doc('d1', 'ocr')])));
      create();
      expect(element().querySelector('#document-live-status')).not.toBeNull();
      const before = loads();

      documentService.getDocuments.mockReturnValue(of(page([doc('d1', 'indexing')])));
      vi.advanceTimersByTime(DOCUMENT_STATUS_REFRESH_MS);
      expect(loads()).toBe(before + 1);
      expect(component.isUpdating()).toBe(false);

      documentService.getDocuments.mockReturnValue(of(page([doc('d1', 'available')])));
      vi.advanceTimersByTime(DOCUMENT_STATUS_REFRESH_MS);
      expect(loads()).toBe(before + 2);
      expect(component.documents()[0].currentVersion?.status).toBe('available');

      vi.advanceTimersByTime(DOCUMENT_STATUS_REFRESH_MS * 3);
      expect(loads()).toBe(before + 2);
    });

    it('does not refresh when nothing is processing', () => {
      vi.useFakeTimers();
      create();
      const before = loads();
      vi.advanceTimersByTime(DOCUMENT_STATUS_REFRESH_MS * 3);
      expect(loads()).toBe(before);
      expect(element().querySelector('#document-live-status')).toBeNull();
    });

    it('waits while the browser tab is hidden, and refreshes when it is shown again', () => {
      vi.useFakeTimers();
      documentService.getDocuments.mockReturnValue(of(page([doc('d1', 'pending')])));
      create();
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      const before = loads();
      vi.advanceTimersByTime(DOCUMENT_STATUS_REFRESH_MS);
      expect(loads()).toBe(before);

      hidden.mockReturnValue(false);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(loads()).toBe(before + 1);
    });

    it('stops refreshing when the page is left', () => {
      vi.useFakeTimers();
      documentService.getDocuments.mockReturnValue(of(page([doc('d1', 'pending')])));
      create();
      const before = loads();
      fixture.destroy();
      vi.advanceTimersByTime(DOCUMENT_STATUS_REFRESH_MS * 2);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(loads()).toBe(before);
    });
  });

  describe('actions', () => {
    it('shows every action to document managers; versions and access wait for #116 and #117', () => {
      create();
      const row = element().querySelector('tbody tr') as HTMLElement;
      expect(row.querySelector('.document-open-action')).not.toBeNull();
      expect(row.querySelector('.document-edit-action')).not.toBeNull();
      expect(row.querySelector('.document-delete-action')).not.toBeNull();
      expect((row.querySelector('.document-versions-action') as HTMLButtonElement).disabled).toBe(
        true
      );
      expect((row.querySelector('.document-access-action') as HTMLButtonElement).disabled).toBe(
        true
      );
    });

    it('only lets other users open documents', () => {
      create(READER);
      const row = element().querySelector('tbody tr') as HTMLElement;
      expect(row.querySelector('.document-open-action')).not.toBeNull();
      expect(row.querySelector('.document-edit-action')).toBeNull();
      expect(row.querySelector('.document-versions-action')).toBeNull();
      expect(row.querySelector('.document-delete-action')).toBeNull();
    });

    it('opens the current version in a new tab, fetched with the session', () => {
      create();
      const tab = { location: { href: '' }, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      URL.createObjectURL = vi.fn().mockReturnValue('blob:file');
      URL.revokeObjectURL = vi.fn();

      component.openDocument(doc('d1', 'available'));
      expect(window.open).toHaveBeenCalledWith('', '_blank');
      expect(documentService.getCurrentFile).toHaveBeenCalledWith('d1');
      expect(tab.location.href).toBe('blob:file');
      expect(component.isOpening('d1')).toBe(false);
    });

    it('closes the new tab and explains when the file cannot be loaded', () => {
      create();
      const tab = { location: { href: '' }, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      documentService.getCurrentFile.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403 }))
      );
      component.openDocument(doc('d1', 'available'));
      expect(tab.close).toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Could not open the document', {
        description: 'Something went wrong.'
      });
    });

    it('explains when the browser blocks the new tab', () => {
      create();
      vi.spyOn(window, 'open').mockReturnValue(null);
      component.openDocument(doc('d1', 'available'));
      expect(documentService.getCurrentFile).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
    });

    it('edits the details in a dialog and reloads after saving', () => {
      create();
      component.openEditModal(doc('d1', 'available'));
      fixture.detectChanges();
      expect(element().querySelector('app-document-metadata-modal .modal')).not.toBeNull();

      const before = loads();
      component.onMetadataSaved(doc('d1', 'available', { title: 'Renamed' }));
      fixture.detectChanges();
      expect(element().querySelector('app-document-metadata-modal .modal')).toBeNull();
      expect(toast.success).toHaveBeenCalledWith('Document updated', {
        description: '"Renamed" was saved.'
      });
      expect(loads()).toBe(before + 1);
    });

    it('deletes after confirmation and reloads', () => {
      create();
      component.openDeleteModal(doc('d1', 'available'));
      fixture.detectChanges();
      expect(element().textContent).toContain('Document: Doc d1');
      expect(documentService.deleteDocument).not.toHaveBeenCalled();

      const before = loads();
      component.confirmDelete();
      expect(documentService.deleteDocument).toHaveBeenCalledWith('d1');
      expect(toast.success).toHaveBeenCalled();
      expect(component.deleteTarget()).toBeNull();
      expect(loads()).toBe(before + 1);
    });

    it('goes back a page after deleting the last document of a page', () => {
      documentService.getDocuments.mockReturnValue(of(page([doc('d11', 'available')], 11, 2, 10)));
      create();
      component.openDeleteModal(doc('d11', 'available'));
      component.confirmDelete();
      expect(lastQuery()).toMatchObject({ page: 1 });
    });

    it('treats a document deleted meanwhile (404) as deleted, and reports other failures', () => {
      create();
      documentService.deleteDocument.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 404 }))
      );
      component.openDeleteModal(doc('d1', 'available'));
      component.confirmDelete();
      expect(toast.info).toHaveBeenCalled();
      expect(component.deleteTarget()).toBeNull();

      documentService.deleteDocument.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403 }))
      );
      component.openDeleteModal(doc('d1', 'available'));
      component.confirmDelete();
      expect(toast.error).toHaveBeenCalledWith('Could not delete the document', {
        description: 'Something went wrong.'
      });
      expect(component.isDeleting()).toBe(false);
    });
  });

  describe('review fixes', () => {
    it('keeps the space error when the documents load, and retries the space', () => {
      spaceService.getSpace.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      documentService.getDocuments.mockReturnValue(of(page([])));
      create();
      expect(component.spaceError()).toBe('Space error.');
      expect(element().querySelector('#document-list-error')?.textContent).toContain(
        'Space error.'
      );
      expect(element().querySelector('#document-list-empty')).toBeNull();

      component.retry();
      fixture.detectChanges();
      expect(spaceService.getSpace).toHaveBeenCalledTimes(2);
      expect(component.spaceError()).toBe('');
      expect(element().querySelector('#space-documents-title')?.textContent).toContain(
        'Mathematics'
      );
    });

    it("goes back to the spaces for another school's space (403)", () => {
      spaceService.getSpace.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403 }))
      );
      create();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/spaces']);
    });

    it('keeps refreshing statuses after a failed automatic refresh, without an error message', () => {
      vi.useFakeTimers();
      documentService.getDocuments.mockReturnValue(of(page([doc('d1', 'ocr')])));
      create();
      const before = loads();

      documentService.getDocuments.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 0 }))
      );
      vi.advanceTimersByTime(DOCUMENT_STATUS_REFRESH_MS);
      expect(loads()).toBe(before + 1);
      expect(component.errorMessage()).toBe('');
      expect(toast.error).not.toHaveBeenCalled();

      documentService.getDocuments.mockReturnValue(of(page([doc('d1', 'available')])));
      vi.advanceTimersByTime(DOCUMENT_STATUS_REFRESH_MS);
      expect(loads()).toBe(before + 2);
      expect(component.documents()[0].currentVersion?.status).toBe('available');
    });

    it('a page change while typing sends the typed text once, from the first page', () => {
      documentService.getDocuments.mockReturnValue(of(page([doc('d1', 'available')], 30, 1, 10)));
      create();
      vi.useFakeTimers();
      const before = loads();
      component.onSearchChange('alg');
      component.goToPage(2);
      expect(loads()).toBe(before + 1);
      expect(lastQuery()).toMatchObject({ page: 1, q: 'alg' });
      vi.advanceTimersByTime(DOCUMENT_FILTER_DEBOUNCE_MS * 3);
      expect(loads()).toBe(before + 1);
    });

    it('an automatic refresh while typing keeps the filters the list shows', () => {
      vi.useFakeTimers();
      documentService.getDocuments.mockReturnValue(of(page([doc('d1', 'pending')])));
      create();
      component.onSearchChange('alg');
      vi.advanceTimersByTime(DOCUMENT_FILTER_DEBOUNCE_MS - 1);
      // Not yet: the refresh only fires after DOCUMENT_STATUS_REFRESH_MS; force one now.
      component.loadDocuments(true);
      expect(lastQuery()).toMatchObject({ q: '' });
      vi.advanceTimersByTime(1);
      expect(lastQuery()).toMatchObject({ q: 'alg', page: 1 });
    });

    it('does not send more tags than the API accepts, and says so', () => {
      create();
      vi.useFakeTimers();
      const before = loads();
      component.onTagFilterChange('a,b,c,d,e,f,g,h,i,j,k');
      fixture.detectChanges();
      expect(component.tooManyTags()).toBe(true);
      expect(element().querySelector('#document-tag-filter-error')?.textContent).toContain(
        'At most 10 tags'
      );
      vi.advanceTimersByTime(DOCUMENT_FILTER_DEBOUNCE_MS);
      expect(loads()).toBe(before);

      component.onTagFilterChange('a,b');
      vi.advanceTimersByTime(DOCUMENT_FILTER_DEBOUNCE_MS);
      expect(lastQuery()).toMatchObject({ tags: 'a,b' });
    });

    it('shows the last page when the page asked for no longer exists', () => {
      documentService.getDocuments
        .mockReturnValueOnce(of({ data: [], total: 10, page: 2, limit: 10, totalPages: 1 }))
        .mockReturnValue(of(page([doc('d1', 'available')], 10, 1, 10)));
      create();
      expect(lastQuery()).toMatchObject({ page: 1 });
      expect(component.documents().map((d) => d.id)).toEqual(['d1']);
    });

    it('opens several documents at once, each row on its own', () => {
      create();
      const tabs = [
        { location: { href: '' }, close: vi.fn() },
        { location: { href: '' }, close: vi.fn() }
      ];
      vi.spyOn(window, 'open')
        .mockReturnValueOnce(tabs[0] as unknown as Window)
        .mockReturnValueOnce(tabs[1] as unknown as Window);
      const first = new Subject<Blob>();
      documentService.getCurrentFile
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(of(new Blob(['x'])));
      URL.createObjectURL = vi.fn().mockReturnValue('blob:file');
      URL.revokeObjectURL = vi.fn();

      component.openDocument(doc('d1', 'available'));
      fixture.detectChanges();
      const rows = element().querySelectorAll('tbody tr');
      expect((rows[0].querySelector('.document-open-action') as HTMLButtonElement).disabled).toBe(
        true
      );
      expect((rows[1].querySelector('.document-open-action') as HTMLButtonElement).disabled).toBe(
        false
      );

      component.openDocument(doc('d2', 'error'));
      expect(tabs[1].location.href).toBe('blob:file');
      expect(component.isOpening('d1')).toBe(true);
      expect(component.isOpening('d2')).toBe(false);
    });

    it('closes the empty tab when the page is left before the file arrives', () => {
      create();
      const tab = { location: { href: '' }, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      documentService.getCurrentFile.mockReturnValue(new Subject<Blob>());
      component.openDocument(doc('d1', 'available'));
      fixture.destroy();
      expect(tab.close).toHaveBeenCalled();
    });

    it('offers the document actions exactly when the API accepts them', () => {
      create(user(['documents:publish', 'spaces:read']));
      expect(component.canManage()).toBe(true);
      const uploadLink = element().querySelector('#document-upload') as HTMLAnchorElement | null;
      expect(uploadLink).not.toBeNull();
      expect(uploadLink?.getAttribute('href')).toContain('/admin/documents/upload');
      expect(uploadLink?.getAttribute('href')).toContain('spaceId=sp1');
    });

    it('hides the upload link for read-only users', () => {
      create(READER);
      expect(component.canManage()).toBe(false);
      expect(element().querySelector('#document-upload')).toBeNull();
    });

    it('scopes canManage to the loaded space school so permissions from another school do not leak', () => {
      spaceService.getSpace.mockReturnValue(
        of({ id: 'sp-b', schoolId: 'school-b', name: 'History B', description: '' })
      );
      const multiSchoolUser: PortalSessionUser = {
        id: 'u1',
        email: 'u1@school.edu',
        fullName: 'User One',
        status: 'ACTIVE',
        role: null,
        permissions: ['documents:manage', 'documents:read', 'spaces:read'],
        schoolIds: ['school-a', 'school-b'],
        isPlatformAdmin: false,
        assignments: [
          {
            role: 'CONTENT_MANAGER',
            scope: 'school',
            schoolId: 'school-a',
            schoolName: 'School A',
            groupId: null,
            permissions: ['documents:manage', 'documents:read', 'spaces:read']
          },
          {
            role: 'STAFF',
            scope: 'school',
            schoolId: 'school-b',
            schoolName: 'School B',
            groupId: null,
            permissions: ['documents:read', 'spaces:read']
          }
        ]
      };
      session.selectSchool('school-a');
      create(multiSchoolUser);
      expect(component.canManage()).toBe(false);
    });
  });
});
