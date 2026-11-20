import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from 'src/environments/environment';
import { AssignmentService } from './assignment.service';

describe('AssignmentService', () => {
  let service: AssignmentService;
  let httpMock: HttpTestingController;
  const api = environment.apiUrl;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AssignmentService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AssignmentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads the current admin from /auth/me', () => {
    let permissions: string[] = [];
    service.getCurrentAdmin().subscribe((me) => (permissions = me.permissions));
    const req = httpMock.expectOne(`${api}/auth/me`);
    expect(req.request.method).toBe('GET');
    req.flush({ id: 'a', permissions: ['users:assign_role'], isPlatformAdmin: false });
    expect(permissions).toContain('users:assign_role');
  });

  it('loads assignable roles for a school', () => {
    service.getAssignableRoles('school-1').subscribe();
    const req = httpMock.expectOne((r) => r.url === `${api}/assignments/assignable-roles`);
    expect(req.request.params.get('schoolId')).toBe('school-1');
    req.flush([]);
  });

  it('loads assignable roles without a school filter', () => {
    service.getAssignableRoles().subscribe();
    const req = httpMock.expectOne((r) => r.url === `${api}/assignments/assignable-roles`);
    expect(req.request.params.has('schoolId')).toBe(false);
    req.flush([]);
  });

  it('loads schools and unwraps the page', () => {
    let result: unknown;
    service.getSchools().subscribe((s) => (result = s));
    const req = httpMock.expectOne((r) => r.url === `${api}/schools`);
    expect(req.request.params.get('limit')).toBe('100');
    req.flush({ data: [{ id: 's1', name: 'School 1' }], total: 1, page: 1, limit: 100, totalPages: 1 });
    expect(result).toEqual([{ id: 's1', name: 'School 1' }]);
  });

  it('loads the groups of one school', () => {
    let result: unknown;
    service.getGroups('s1').subscribe((g) => (result = g));
    const req = httpMock.expectOne((r) => r.url === `${api}/groups`);
    expect(req.request.params.get('schoolId')).toBe('s1');
    req.flush({ data: [{ id: 'g1', schoolId: 's1', name: 'G1', type: 'class' }] });
    expect(result).toEqual([{ id: 'g1', schoolId: 's1', name: 'G1', type: 'class' }]);
  });

  it('creates, updates and removes an assignment', () => {
    service.createAssignment({ userId: 'u', schoolId: 's', role: 'STAFF' }).subscribe();
    const post = httpMock.expectOne(`${api}/assignments`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ userId: 'u', schoolId: 's', role: 'STAFF' });
    post.flush({});

    service.updateAssignment('a1', { groupId: null }).subscribe();
    const patch = httpMock.expectOne(`${api}/assignments/a1`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ groupId: null });
    patch.flush({});

    service.removeAssignment('a1').subscribe();
    const del = httpMock.expectOne(`${api}/assignments/a1`);
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
  });

  describe('extractErrorMessage', () => {
    it('keeps the API message', () => {
      const err = new HttpErrorResponse({ status: 409, error: { message: 'The last school administrator cannot be removed' } });
      expect(service.extractErrorMessage(err)).toBe('The last school administrator cannot be removed');
    });

    it('joins validation messages', () => {
      const err = new HttpErrorResponse({ status: 400, error: { message: ['a', 'b'] } });
      expect(service.extractErrorMessage(err)).toBe('a. b');
    });

    it('falls back when there is no message', () => {
      expect(service.extractErrorMessage(new HttpErrorResponse({ status: 500 }), 'Oops')).toBe('Oops');
      expect(service.extractErrorMessage(new Error('x'), 'Oops')).toBe('Oops');
    });

    it('explains an unreachable server', () => {
      expect(service.extractErrorMessage(new HttpErrorResponse({ status: 0 }))).toContain('Unable to reach API');
    });
  });
});
