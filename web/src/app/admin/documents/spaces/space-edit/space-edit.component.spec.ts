import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { of, throwError } from 'rxjs';
import {
  PortalSessionService,
  PortalSessionUser
} from '../../../identity/services/portal-session.service';
import { SpaceEntity, SpaceFormErrors } from '../models/space.model';
import { SpaceManagementService } from '../services/space-management.service';
import { SpaceEditComponent } from './space-edit.component';

const MANAGE = ['documents:manage', 'spaces:create', 'spaces:update', 'spaces:delete'];

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
  role: 'STAFF',
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
/** Manages documents in schools A and C, only reads in school B. */
const MULTI_SCHOOL_STAFF = user({
  permissions: MANAGE,
  schoolIds: ['school-a', 'school-b', 'school-c'],
  assignments: [
    assignment('school-a', 'School A', MANAGE),
    assignment('school-b', 'School B', ['documents:read']),
    assignment('school-c', 'School C', MANAGE)
  ]
});

const STORED: SpaceEntity = {
  id: 'space-1',
  schoolId: 'school-a',
  name: 'Maths',
  description: 'Algebra notes',
  language: 'en',
  privacy: 'public',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z'
};

describe('SpaceEditComponent', () => {
  let fixture: ComponentFixture<SpaceEditComponent>;
  let component: SpaceEditComponent;
  let session: PortalSessionService;
  let router: Router;
  let spaceService: {
    getSpace: ReturnType<typeof vi.fn>;
    createSpace: ReturnType<typeof vi.fn>;
    updateSpace: ReturnType<typeof vi.fn>;
    formErrors: ReturnType<typeof vi.fn>;
    errorMessage: ReturnType<typeof vi.fn>;
    getAllSchools: ReturnType<typeof vi.fn>;
  };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let routeId: string | null;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  function create(signedIn: PortalSessionUser, id: string | null = null): void {
    routeId = id;
    session.setUser(signedIn);
    fixture = TestBed.createComponent(SpaceEditComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function fill(values: Parameters<SpaceEditComponent['form']['patchValue']>[0]): void {
    component.form.patchValue(values);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    routeId = null;
    spaceService = {
      getSpace: vi.fn().mockReturnValue(of(STORED)),
      createSpace: vi
        .fn()
        .mockImplementation((payload) => of({ ...STORED, ...payload, id: 'new' })),
      updateSpace: vi.fn().mockReturnValue(of(STORED)),
      formErrors: vi.fn(),
      errorMessage: vi.fn().mockReturnValue('Something went wrong.'),
      getAllSchools: vi.fn()
    };
    spaceService.getAllSchools = vi.fn().mockReturnValue(
      of([
        { id: 'school-a', name: 'School A' },
        { id: 'school-b', name: 'School B' }
      ])
    );
    toast = { success: vi.fn(), error: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SpaceEditComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SpaceManagementService, useValue: spaceService },
        { provide: GoeyToastService, useValue: toast },
        {
          provide: ActivatedRoute,
          useFactory: () => ({
            snapshot: { paramMap: convertToParamMap(routeId ? { id: routeId } : {}) }
          })
        }
      ]
    }).compileComponents();
    session = TestBed.inject(PortalSessionService);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => localStorage.clear());

  describe('school field', () => {
    it('platform admin picks among every school, and must pick one', () => {
      create(PLATFORM_ADMIN);
      const options = [...element().querySelectorAll('#space-school option')].map((o) =>
        o.textContent?.trim()
      );
      expect(options).toEqual(['Select a school', 'School A', 'School B']);

      fill({ name: 'Maths' });
      component.onSubmit();
      fixture.detectChanges();
      expect(spaceService.createSpace).not.toHaveBeenCalled();
      expect(element().textContent).toContain('School is required.');
    });

    it('is hidden for a user managing a single school, which is used automatically', () => {
      create(SCHOOL_ADMIN);
      expect(element().querySelector('#space-school')).toBeNull();
      expect(component.form.controls.schoolId.value).toBe('school-a');
      expect(spaceService.getAllSchools).not.toHaveBeenCalled();
    });

    it('offers only the schools where the staff member manages documents, starting on the active one', () => {
      session.selectSchool('school-c');
      create(MULTI_SCHOOL_STAFF);
      expect(component.schoolOptions().map((s) => s.id)).toEqual(['school-a', 'school-c']);
      expect(component.form.controls.schoolId.value).toBe('school-c');
      expect(element().querySelector('#space-school')).not.toBeNull();
    });
  });

  describe('create', () => {
    it('sends the trimmed values and the defaults, then goes back to the list', () => {
      create(SCHOOL_ADMIN);
      fill({ name: '  Maths  ', description: '   ' });
      component.onSubmit();

      expect(spaceService.createSpace).toHaveBeenCalledWith({
        schoolId: 'school-a',
        name: 'Maths',
        language: 'en',
        privacy: 'public'
      });
      expect(toast.success).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/spaces']);
    });

    it('checks the fields before calling the API', () => {
      create(SCHOOL_ADMIN);
      fill({ name: '   ', description: 'x'.repeat(2001) });
      component.onSubmit();
      fixture.detectChanges();

      expect(spaceService.createSpace).not.toHaveBeenCalled();
      expect(component.fieldError('name')).toBe('Name is required.');
      expect(component.fieldError('description')).toBe(
        'Description cannot exceed 2000 characters.'
      );
      expect(element().querySelector('#space-description-count')?.textContent).toContain(
        '2001 / 2000'
      );

      fill({ name: 'x'.repeat(101), description: '' });
      expect(component.fieldError('name')).toBe('Name cannot exceed 100 characters.');
    });

    it('shows API errors on their fields, and the others above the form', () => {
      const errors: SpaceFormErrors = {
        fields: { name: "A space named 'Maths' already exists in this school" },
        general: 'Property foo should not exist'
      };
      spaceService.formErrors.mockReturnValue(errors);
      spaceService.createSpace.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 409 }))
      );
      create(SCHOOL_ADMIN);
      fill({ name: 'Maths' });
      component.onSubmit();
      fixture.detectChanges();

      expect(component.fieldError('name')).toBe(
        "A space named 'Maths' already exists in this school"
      );
      expect(element().querySelector('#space-name')?.classList).toContain('is-invalid');
      expect(element().querySelector('#space-form-error')?.textContent).toContain(
        'Property foo should not exist'
      );
      expect(router.navigate).not.toHaveBeenCalled();
      expect(component.isSaving()).toBe(false);

      // Editing the name clears the API error.
      fill({ name: 'Maths 2' });
      expect(component.fieldError('name')).toBeNull();
    });

    it('explains why a user without any manageable school cannot create', () => {
      create(
        user({
          permissions: ['documents:read'],
          schoolIds: ['school-a'],
          assignments: [assignment('school-a', 'School A', ['documents:read'])]
        })
      );
      fill({ name: 'Maths' });
      component.onSubmit();
      expect(spaceService.createSpace).not.toHaveBeenCalled();
      expect(component.generalError()).toContain('may not create spaces in any of your schools');
    });
  });

  describe('edit', () => {
    it('loads the space; the school is shown but cannot change', () => {
      create(PLATFORM_ADMIN, 'space-1');
      expect(spaceService.getSpace).toHaveBeenCalledWith('space-1');
      expect(component.form.getRawValue()).toEqual({
        schoolId: 'school-a',
        name: 'Maths',
        description: 'Algebra notes',
        language: 'en',
        privacy: 'public'
      });
      const school = element().querySelector('#space-school') as HTMLInputElement;
      expect(school.readOnly).toBe(true);
      expect(school.value).toBe('School A');
    });

    it('sends only the changed fields; clearing the description sends null', () => {
      create(SCHOOL_ADMIN, 'space-1');
      expect((element().querySelector('#space-save-button') as HTMLButtonElement).disabled).toBe(
        true
      );

      fill({ description: '  ', privacy: 'private' });
      expect((element().querySelector('#space-save-button') as HTMLButtonElement).disabled).toBe(
        false
      );
      component.onSubmit();
      expect(spaceService.updateSpace).toHaveBeenCalledWith('space-1', {
        description: null,
        privacy: 'private'
      });
      expect(router.navigate).toHaveBeenCalledWith(['/admin/spaces']);
    });

    it('does not call the API when nothing changed', () => {
      create(SCHOOL_ADMIN, 'space-1');
      fill({ name: ' Maths ' });
      component.onSubmit();
      expect(spaceService.updateSpace).not.toHaveBeenCalled();
    });

    it('goes back to the list when the space does not exist', () => {
      spaceService.getSpace.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 404 }))
      );
      create(SCHOOL_ADMIN, 'space-1');
      expect(toast.error).toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/spaces']);
    });

    it('shows the error instead of the form when the space cannot be loaded', () => {
      spaceService.getSpace.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      create(SCHOOL_ADMIN, 'space-1');
      expect(element().querySelector('form')).toBeNull();
      expect(element().querySelector('#space-form-error')?.textContent).toContain(
        'Something went wrong.'
      );
    });
  });

  describe('review fixes', () => {
    it('offers only the schools where the user may create spaces', () => {
      session.selectSchool('school-a');
      create(
        user({
          permissions: ['spaces:update', 'spaces:create'],
          schoolIds: ['school-a', 'school-b'],
          assignments: [
            assignment('school-a', 'School A', ['spaces:update']),
            assignment('school-b', 'School B', ['spaces:create'])
          ]
        })
      );
      expect(component.schoolOptions().map((s) => s.id)).toEqual(['school-b']);
      expect(component.form.controls.schoolId.value).toBe('school-b');
    });

    it('a duplicate name in one school does not block saving in another', () => {
      spaceService.formErrors.mockReturnValue({
        fields: { name: "A space named 'Maths' already exists in this school" },
        general: null
      });
      spaceService.createSpace.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 409 }))
      );
      create(PLATFORM_ADMIN);
      fill({ schoolId: 'school-a', name: 'Maths' });
      component.onSubmit();
      expect(component.fieldError('name')).toContain('already exists');

      fill({ schoolId: 'school-b' });
      expect(component.fieldError('name')).toBeNull();
      component.onSubmit();
      expect(spaceService.createSpace).toHaveBeenCalledTimes(2);
      expect(spaceService.createSpace.mock.calls[1][0]).toMatchObject({
        schoolId: 'school-b',
        name: 'Maths'
      });
    });

    it('an API error never blocks the next try with the same values', () => {
      spaceService.formErrors.mockReturnValue({ fields: { name: 'Name is taken' }, general: null });
      spaceService.createSpace.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 409 }))
      );
      create(SCHOOL_ADMIN);
      fill({ name: 'Maths' });
      component.onSubmit();
      component.onSubmit();
      expect(spaceService.createSpace).toHaveBeenCalledTimes(2);
    });

    it('keeps the school-load error visible across submit attempts and recovers on Retry', () => {
      spaceService.getAllSchools
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })))
        .mockReturnValueOnce(of([{ id: 'school-a', name: 'School A' }]));

      create(PLATFORM_ADMIN);
      expect(element().querySelector('#space-schools-error')?.textContent).toContain(
        'list of schools could not be loaded'
      );
      expect((element().querySelector('#space-save-button') as HTMLButtonElement).disabled).toBe(
        true
      );

      component.onSubmit();
      fixture.detectChanges();
      expect(spaceService.createSpace).not.toHaveBeenCalled();
      expect(element().querySelector('#space-schools-error')).not.toBeNull();

      (element().querySelector('#space-schools-retry') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(element().querySelector('#space-schools-error')).toBeNull();
      expect((element().querySelector('#space-save-button') as HTMLButtonElement).disabled).toBe(
        false
      );
    });
  });
});
