import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from 'src/environments/environment';
import { SpaceManagementService } from './space-management.service';

describe('SpaceManagementService', () => {
  let service: SpaceManagementService;
  let http: HttpTestingController;
  const url = `${environment.apiUrl}/documents/spaces`;

  const httpError = (status: number, message?: string | string[]) =>
    new HttpErrorResponse({
      status,
      error: message === undefined ? null : { statusCode: status, message }
    });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SpaceManagementService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(SpaceManagementService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('requests', () => {
    it('lists a page with the trimmed search and the school', () => {
      service
        .getSpaces({ page: 2, limit: 25, search: '  maths ', schoolId: 'school-a' })
        .subscribe();
      const req = http.expectOne((r) => r.url === url);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('limit')).toBe('25');
      expect(req.request.params.get('search')).toBe('maths');
      expect(req.request.params.get('schoolId')).toBe('school-a');
      req.flush({ data: [], total: 0, page: 2, limit: 25 });
    });

    it('leaves out an empty search and no school', () => {
      service.getSpaces({ page: 1, limit: 10, search: '   ' }).subscribe();
      const req = http.expectOne((r) => r.url === url);
      expect(req.request.params.has('search')).toBe(false);
      expect(req.request.params.has('schoolId')).toBe(false);
      req.flush({ data: [], total: 0, page: 1, limit: 10 });
    });

    it('gets, creates, updates and deletes a space', () => {
      service.getSpace('s1').subscribe();
      http.expectOne({ method: 'GET', url: `${url}/s1` }).flush({});

      const create = {
        schoolId: 'school-a',
        name: 'Maths',
        language: 'en' as const,
        privacy: 'public' as const
      };
      service.createSpace(create).subscribe();
      const post = http.expectOne({ method: 'POST', url });
      expect(post.request.body).toEqual(create);
      post.flush({});

      service.updateSpace('s1', { description: null }).subscribe();
      const patch = http.expectOne({ method: 'PATCH', url: `${url}/s1` });
      expect(patch.request.body).toEqual({ description: null });
      patch.flush({});

      let deleted = false;
      service.deleteSpace('s1').subscribe(() => (deleted = true));
      http
        .expectOne({ method: 'DELETE', url: `${url}/s1` })
        .flush(null, { status: 204, statusText: 'No Content' });
      expect(deleted).toBe(true);
    });
  });

  describe('getAllSchools', () => {
    const schoolsUrl = `${environment.apiUrl}/schools`;
    const schools = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `s${from + i}`, name: `School ${from + i}` }));

    it('reads every page of schools, 100 at a time', () => {
      let result: { id: string }[] = [];
      service.getAllSchools().subscribe((s) => (result = s));

      const first = http.expectOne((r) => r.url === schoolsUrl && r.params.get('page') === '1');
      expect(first.request.params.get('limit')).toBe('100');
      first.flush({ data: schools(1, 100), total: 230, page: 1, limit: 100, totalPages: 3 });
      http
        .expectOne((r) => r.url === schoolsUrl && r.params.get('page') === '2')
        .flush({ data: schools(101, 100), total: 230, page: 2, limit: 100, totalPages: 3 });
      http
        .expectOne((r) => r.url === schoolsUrl && r.params.get('page') === '3')
        .flush({ data: schools(201, 30), total: 230, page: 3, limit: 100, totalPages: 3 });

      expect(result.length).toBe(230);
      expect(result.at(-1)?.id).toBe('s230');
    });

    it('stops after the first page when it holds every school', () => {
      let result: { id: string }[] = [];
      service.getAllSchools().subscribe((s) => (result = s));
      http
        .expectOne((r) => r.url === schoolsUrl)
        .flush({ data: schools(1, 2), total: 2, page: 1, limit: 100, totalPages: 1 });
      expect(result.length).toBe(2);
    });
  });

  describe('formErrors', () => {
    it('puts a duplicate name (409) on the name field', () => {
      const errors = service.formErrors(
        httpError(409, "A space named 'Maths' already exists in this school")
      );
      expect(errors).toEqual({
        fields: { name: "A space named 'Maths' already exists in this school" },
        general: null
      });
    });

    it('puts each validation message (400) on its field, and the others on the form', () => {
      const errors = service.formErrors(
        httpError(400, [
          'name must be shorter than or equal to 100 characters',
          'name should not be empty',
          'language must be one of the following values: en, fr',
          'property schoolId should not exist'
        ])
      );
      expect(errors.fields).toEqual({
        name: 'Name must be shorter than or equal to 100 characters',
        language: 'Language must be one of the following values: en, fr'
      });
      expect(errors.general).toBe('Property schoolId should not exist');
    });

    it('gives a form message for scope and missing-space errors', () => {
      expect(service.formErrors(httpError(403, 'Forbidden')).general).toBe(
        'You can only manage the spaces of your own school(s).'
      );
      expect(service.formErrors(httpError(404)).general).toContain('no longer exists');
      expect(service.formErrors(httpError(0)).general).toContain('Unable to reach the API server');
    });
  });

  describe('errorMessage', () => {
    it('uses the API message, or the fallback', () => {
      expect(service.errorMessage(httpError(500, 'database down'), 'Failed.')).toBe(
        'Database down'
      );
      expect(service.errorMessage(httpError(500), 'Failed.')).toBe('Failed.');
      expect(service.errorMessage(new Error('boom'), 'Failed.')).toBe('Failed.');
    });
  });
});
