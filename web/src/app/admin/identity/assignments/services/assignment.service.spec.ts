import { provideHttpClient } from '@angular/common/http';
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

  it('loads the groups of one school', () => {
    let result: unknown;
    service.getGroups('s1').subscribe((g) => (result = g));
    const req = httpMock.expectOne((r) => r.url === `${api}/groups`);
    expect(req.request.params.get('schoolId')).toBe('s1');
    req.flush({ data: [{ id: 'g1', schoolId: 's1', name: 'G1', type: 'class' }] });
    expect(result).toEqual([{ id: 'g1', schoolId: 's1', name: 'G1', type: 'class' }]);
  });

  it('paginates through all pages when loading groups beyond limit 100', () => {
    let result: unknown;
    service.getGroups('s1').subscribe((g) => (result = g));

    const p1 = httpMock.expectOne((r) => r.url === `${api}/groups` && r.params.get('page') === '1');
    p1.flush({ data: [{ id: 'g1', schoolId: 's1', name: 'G1', type: 'class' }], page: 1, totalPages: 2 });

    const p2 = httpMock.expectOne((r) => r.url === `${api}/groups` && r.params.get('page') === '2');
    p2.flush({ data: [{ id: 'g2', schoolId: 's1', name: 'G2', type: 'team' }], page: 2, totalPages: 2 });

    expect(result).toEqual([
      { id: 'g1', schoolId: 's1', name: 'G1', type: 'class' },
      { id: 'g2', schoolId: 's1', name: 'G2', type: 'team' }
    ]);
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
});
