import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { Subject, of, throwError } from 'rxjs';
import {
  PortalSessionService,
  PortalSessionUser
} from '../../../identity/services/portal-session.service';
import { PaginatedSpaces, SpaceEntity } from '../models/space.model';
import { SpaceManagementService } from '../services/space-management.service';
import { SPACE_SEARCH_DEBOUNCE_MS, SpaceListComponent } from './space-list.component';

const MANAGE = [
  'documents:manage',
  'spaces:read',
  'spaces:create',
  'spaces:update',
  'spaces:delete'
];

function user(overrides: Partial<PortalSessionUser>): PortalSessionUser {
  return {
    id: 'u1',
    email: 'u1@school.edu',
    fullName: 'User One',
    status: 'ACTIVE',
    role: null,
    permissions: [],
    schoolIds: [],
    isPlatformAdmin: false,
    assignments: [],
    ...overrides
  };
}

const assignment = (schoolId: string, schoolName: string, permissions: string[]) => ({
  role: 'SCHOOL_ADMIN',
  scope: 'school',
  schoolId,
  schoolName,
  groupId: null,
  permissions
});

const PLATFORM_ADMIN = user({
  isPlatformAdmin: true,
  permissions: ['*'],
  assignments: [
    { role: 'PLATFORM_ADMIN', scope: 'platform', schoolId: '', groupId: null, permissions: ['*'] }
  ]
});
const SCHOOL_ADMIN = user({
  permissions: MANAGE,
  schoolIds: ['school-a'],
  assignments: [assignment('school-a', 'School A', MANAGE)]
});
const MULTI_SCHOOL_STAFF = user({
  permissions: MANAGE,
  schoolIds: ['school-a', 'school-b'],
  assignments: [
    assignment('school-a', 'School A', MANAGE),
    assignment('school-b', 'School B', MANAGE)
  ]
});
const READER = user({
  permissions: ['spaces:read', 'documents:read'],
  schoolIds: ['school-a'],
  assignments: [assignment('school-a', 'School A', ['spaces:read', 'documents:read'])]
});

const space = (id: string, overrides: Partial<SpaceEntity> = {}): SpaceEntity => ({
  id,
  schoolId: 'school-a',
  name: `Space ${id}`,
  description: '',
  language: 'en',
  privacy: 'public',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-02T10:00:00Z',
  ...overrides
});

const page = (
  data: SpaceEntity[],
  total = data.length,
  pageNo = 1,
  limit = 10
): PaginatedSpaces => ({
  data,
  total,
  page: pageNo,
  limit
});

describe('SpaceListComponent', () => {
  let fixture: ComponentFixture<SpaceListComponent>;
  let component: SpaceListComponent;
  let session: PortalSessionService;
  let spaceService: {
    getSpaces: ReturnType<typeof vi.fn>;
    deleteSpace: ReturnType<typeof vi.fn>;
    errorMessage: ReturnType<typeof vi.fn>;
    getAllSchools: ReturnType<typeof vi.fn>;
  };
  let toast: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const lastQuery = () => spaceService.getSpaces.mock.calls.at(-1)?.[0];

  function create(signedIn: PortalSessionUser): void {
    session.setUser(signedIn);
    fixture = TestBed.createComponent(SpaceListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    spaceService = {
      getSpaces: vi
        .fn()
        .mockReturnValue(of(page([space('s1'), space('s2', { privacy: 'private' })]))),
      deleteSpace: vi.fn().mockReturnValue(of(undefined)),
      errorMessage: vi.fn().mockReturnValue('Something went wrong.'),
      getAllSchools: vi.fn()
    };
    spaceService.getAllSchools = vi.fn().mockReturnValue(
      of([
        { id: 'school-a', name: 'School A' },
        { id: 'school-b', name: 'School B' }
      ])
    );
    toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SpaceListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SpaceManagementService, useValue: spaceService },
        { provide: GoeyToastService, useValue: toast }
      ]
    }).compileComponents();
    session = TestBed.inject(PortalSessionService);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  describe('scope', () => {
    it('platform admin: every school, with a school filter and a school column', () => {
      create(PLATFORM_ADMIN);
      expect(lastQuery()).toEqual({ page: 1, limit: 10, search: '', schoolId: undefined });
      expect(element().querySelector('#space-school-filter')).not.toBeNull();
      expect(element().textContent).toContain('SCHOOL');
      expect(element().textContent).toContain('School A');

      component.onSchoolFilterChange('school-b');
      fixture.detectChanges();
      expect(lastQuery()).toMatchObject({ page: 1, schoolId: 'school-b' });
      expect(component.showSchoolColumn()).toBe(false);
    });

    it('school admin: their school only, without school filter or column', () => {
      create(SCHOOL_ADMIN);
      expect(lastQuery()).toMatchObject({ schoolId: 'school-a' });
      expect(element().querySelector('#space-school-filter')).toBeNull();
      expect(component.showSchoolColumn()).toBe(false);
      expect(element().querySelector('#space-list-school')?.textContent).toContain('School A');
      expect(spaceService.getAllSchools).not.toHaveBeenCalled();
    });

    it('does not show a school badge while only the school id is known', () => {
      create(
        user({
          permissions: MANAGE,
          schoolIds: ['school-a'],
          assignments: [{ ...assignment('school-a', 'School A', MANAGE), schoolName: null }]
        })
      );
      expect(lastQuery()).toMatchObject({ schoolId: 'school-a' });
      expect(element().querySelector('#space-list-school')).toBeNull();
    });

    it('staff in several schools: follows the school chosen in the header', () => {
      create(MULTI_SCHOOL_STAFF);
      expect(lastQuery()).toMatchObject({ schoolId: 'school-a' });

      session.selectSchool('school-b');
      fixture.detectChanges();
      expect(lastQuery()).toMatchObject({ page: 1, schoolId: 'school-b' });
    });
  });

  describe('list', () => {
    it('shows each space with its language and privacy', () => {
      create(SCHOOL_ADMIN);
      const rows = element().querySelectorAll('tbody tr');
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('Space s1');
      expect(rows[0].textContent).toContain('English');
      expect(rows[1].textContent).toContain('Private');
      expect(element().textContent).toContain('(2 spaces)');
    });

    it('searches after a pause in typing, from the first page', () => {
      create(SCHOOL_ADMIN);
      vi.useFakeTimers();
      component.currentPage.set(3);
      const calls = spaceService.getSpaces.mock.calls.length;

      component.onSearchChange('ma');
      component.onSearchChange('maths');
      vi.advanceTimersByTime(SPACE_SEARCH_DEBOUNCE_MS - 1);
      expect(spaceService.getSpaces.mock.calls.length).toBe(calls);

      vi.advanceTimersByTime(1);
      expect(spaceService.getSpaces.mock.calls.length).toBe(calls + 1);
      expect(lastQuery()).toMatchObject({ page: 1, search: 'maths' });
    });

    it('pages forward and back, and changes the page size', () => {
      spaceService.getSpaces.mockReturnValue(of(page([space('s1')], 30, 1, 10)));
      create(SCHOOL_ADMIN);
      expect(component.totalPages()).toBe(3);

      spaceService.getSpaces.mockReturnValue(of(page([space('s11')], 30, 2, 10)));
      component.goToPage(2);
      expect(lastQuery()).toMatchObject({ page: 2 });
      component.goToPage(4);
      expect(lastQuery()).toMatchObject({ page: 2 });

      component.changePageSize(25);
      expect(lastQuery()).toMatchObject({ page: 1, limit: 25 });
    });

    it('keeps only the answer of the latest request', () => {
      create(SCHOOL_ADMIN);
      const slow = new Subject<PaginatedSpaces>();
      const fast = new Subject<PaginatedSpaces>();
      spaceService.getSpaces.mockReturnValueOnce(slow).mockReturnValueOnce(fast);

      component.loadSpaces();
      component.loadSpaces();
      fast.next(page([space('new')]));
      slow.next(page([space('old')]));
      expect(component.spaces().map((s) => s.id)).toEqual(['new']);
    });

    it('shows an error with a retry, and loads again after a failure', () => {
      spaceService.getSpaces.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      create(SCHOOL_ADMIN);
      expect(component.errorMessage()).toBe('Something went wrong.');
      expect(toast.error).toHaveBeenCalled();

      spaceService.getSpaces.mockReturnValue(of(page([space('s1')])));
      component.loadSpaces();
      expect(component.errorMessage()).toBe('');
      expect(component.spaces().length).toBe(1);
    });

    it('offers to clear the filters when nothing matches', () => {
      spaceService.getSpaces.mockReturnValue(of(page([])));
      create(PLATFORM_ADMIN);
      component.onSearchChange('zzz');
      component.loadSpaces();
      fixture.detectChanges();
      expect(element().querySelector('#space-list-empty')?.textContent).toContain(
        'No space matches these filters'
      );

      component.clearFilters();
      fixture.detectChanges();
      expect(lastQuery()).toMatchObject({ search: '', schoolId: undefined });
      expect(element().querySelector('#space-list-empty')?.textContent).toContain(
        'Create the first space'
      );
    });
  });

  describe('actions', () => {
    it('shows create, edit and delete to space managers', () => {
      create(SCHOOL_ADMIN);
      expect(element().querySelector('#space-create-button')).not.toBeNull();
      expect(element().querySelectorAll('.space-edit-action').length).toBe(2);
      expect(element().querySelectorAll('.space-delete-action').length).toBe(2);
    });

    it('hides them from users who may only read spaces', () => {
      create(READER);
      expect(element().querySelector('#space-create-button')).toBeNull();
      expect(element().querySelector('.space-edit-action')).toBeNull();
      expect(element().querySelector('.space-delete-action')).toBeNull();
    });

    it('deletes after confirmation and reloads the list', () => {
      create(SCHOOL_ADMIN);
      component.openDeleteModal(space('s1'));
      fixture.detectChanges();
      expect(element().textContent).toContain('Space: Space s1');
      expect(spaceService.deleteSpace).not.toHaveBeenCalled();

      const calls = spaceService.getSpaces.mock.calls.length;
      component.confirmDelete();
      expect(spaceService.deleteSpace).toHaveBeenCalledWith('s1');
      expect(toast.success).toHaveBeenCalled();
      expect(component.deleteTarget()).toBeNull();
      expect(spaceService.getSpaces.mock.calls.length).toBe(calls + 1);
    });

    it('cancelling deletes nothing', () => {
      create(SCHOOL_ADMIN);
      component.openDeleteModal(space('s1'));
      component.closeDeleteModal();
      expect(component.deleteTarget()).toBeNull();
      expect(spaceService.deleteSpace).not.toHaveBeenCalled();
    });

    it('goes back a page after deleting the last space of a page', () => {
      spaceService.getSpaces.mockReturnValue(of(page([space('s11')], 11, 2, 10)));
      create(SCHOOL_ADMIN);
      component.openDeleteModal(space('s11'));
      component.confirmDelete();
      expect(lastQuery()).toMatchObject({ page: 1 });
    });

    it('treats a space deleted meanwhile (404) as deleted', () => {
      create(SCHOOL_ADMIN);
      spaceService.deleteSpace.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 404 }))
      );
      component.openDeleteModal(space('s1'));
      component.confirmDelete();
      expect(toast.info).toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(component.deleteTarget()).toBeNull();
    });

    it('reports any other delete failure', () => {
      create(SCHOOL_ADMIN);
      spaceService.deleteSpace.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403 }))
      );
      component.openDeleteModal(space('s1'));
      component.confirmDelete();
      expect(toast.error).toHaveBeenCalledWith('Could not delete the space', {
        description: 'Something went wrong.'
      });
      expect(component.isDeleting()).toBe(false);
    });
  });

  describe('review fixes', () => {
    it('a page change while typing sends the typed search once, from the first page', () => {
      spaceService.getSpaces.mockReturnValue(of(page([space('s1')], 30, 1, 10)));
      create(SCHOOL_ADMIN);
      vi.useFakeTimers();
      const before = spaceService.getSpaces.mock.calls.length;

      component.onSearchChange('math');
      component.goToPage(2);
      expect(spaceService.getSpaces.mock.calls.length).toBe(before + 1);
      expect(lastQuery()).toMatchObject({ page: 1, search: 'math' });

      vi.advanceTimersByTime(1000);
      expect(spaceService.getSpaces.mock.calls.length).toBe(before + 1);
    });

    it('a page change with an unchanged search keeps the page', () => {
      spaceService.getSpaces.mockReturnValue(of(page([space('s1')], 30, 1, 10)));
      create(SCHOOL_ADMIN);
      component.goToPage(2);
      expect(lastQuery()).toMatchObject({ page: 2, search: '' });
    });

    it('shows the last page when the page asked for no longer exists', () => {
      spaceService.getSpaces
        .mockReturnValueOnce(of({ data: [], total: 10, page: 2, limit: 10, totalPages: 1 }))
        .mockReturnValue(of(page([space('s1')], 10, 1, 10)));
      create(SCHOOL_ADMIN);
      expect(lastQuery()).toMatchObject({ page: 1 });
      expect(component.currentPage()).toBe(1);
      expect(component.spaces().map((s) => s.id)).toEqual(['s1']);
    });

    it('offers only the actions the API accepts', () => {
      const updateOnly = user({
        permissions: ['spaces:read', 'spaces:update'],
        schoolIds: ['school-a'],
        assignments: [assignment('school-a', 'School A', ['spaces:read', 'spaces:update'])]
      });
      create(updateOnly);
      expect(component.canCreate()).toBe(false);
      expect(component.canEdit()).toBe(true);
      expect(component.canDelete()).toBe(false);
      expect(element().querySelector('#space-create-button')).toBeNull();
    });

    it('says so when the school names cannot be loaded', () => {
      spaceService.getAllSchools.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      create(PLATFORM_ADMIN);
      expect(toast.warning).toHaveBeenCalledWith('School names could not be loaded', {
        description: 'Something went wrong.'
      });
    });

    it('clears deleteTarget and scopes actions per active school when switching schools', () => {
      const mixedUser = user({
        permissions: ['spaces:read', 'spaces:update', 'spaces:create', 'spaces:delete'],
        schoolIds: ['school-a', 'school-b'],
        assignments: [
          assignment('school-a', 'School A', ['spaces:read', 'spaces:update']),
          assignment('school-b', 'School B', ['spaces:read', 'spaces:create', 'spaces:delete'])
        ]
      });
      spaceService.getSpaces.mockReturnValue(of(page([space('s1', { schoolId: 'school-a' })])));
      session.selectSchool('school-a');
      create(mixedUser);

      expect(component.canCreate()).toBe(false);
      expect(component.canEdit()).toBe(true);
      expect(component.canDelete()).toBe(false);
      expect(element().querySelector('#space-create-button')).toBeNull();
      expect(element().querySelectorAll('.space-edit-action').length).toBe(1);
      expect(element().querySelector('.space-delete-action')).toBeNull();

      component.openDeleteModal(space('s1', { schoolId: 'school-a' }));
      expect(component.deleteTarget()).not.toBeNull();

      spaceService.getSpaces.mockReturnValue(of(page([space('s2', { schoolId: 'school-b' })])));
      session.selectSchool('school-b');
      fixture.detectChanges();

      expect(component.deleteTarget()).toBeNull();
      expect(component.canCreate()).toBe(true);
      expect(component.canEdit()).toBe(false);
      expect(component.canDelete()).toBe(true);
      expect(element().querySelector('#space-create-button')).not.toBeNull();
      expect(element().querySelector('.space-edit-action')).toBeNull();
      expect(element().querySelectorAll('.space-delete-action').length).toBe(1);
    });

    it('links a space name to documents only when the user can read or manage documents in that school', () => {
      const spaceOnlyUser = user({
        permissions: ['spaces:read'],
        schoolIds: ['school-a'],
        assignments: [assignment('school-a', 'School A', ['spaces:read'])]
      });
      spaceService.getSpaces.mockReturnValue(of(page([space('s1', { schoolId: 'school-a' })])));
      create(spaceOnlyUser);
      expect(element().querySelector('a.space-documents-link')).toBeNull();
      expect(element().querySelector('.name-cell')?.textContent).toContain('Space s1');

      const docReaderUser = user({
        permissions: ['spaces:read', 'documents:read'],
        schoolIds: ['school-a'],
        assignments: [assignment('school-a', 'School A', ['spaces:read', 'documents:read'])]
      });
      create(docReaderUser);
      expect(element().querySelectorAll('a.space-documents-link').length).toBe(1);
    });
  });
});
