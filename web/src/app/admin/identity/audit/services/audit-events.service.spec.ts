import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from 'src/environments/environment';
import { AuditEventsService } from './audit-events.service';

describe('AuditEventsService', () => {
  let service: AuditEventsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AuditEventsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('requests page 1 / limit 10 by default and omits empty filters', () => {
    service.getEvents({ action: '', actorId: '  ' }).subscribe();
    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/audit/events`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.has('action')).toBe(false);
    expect(req.request.params.has('actorId')).toBe(false);
    req.flush({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
  });

  it('sends every filter it is given', () => {
    service
      .getEvents({
        page: 2,
        limit: 25,
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-30T23:59:59.999Z',
        actorId: 'u1',
        action: 'role_assigned',
        schoolId: 's1'
      })
      .subscribe();
    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/audit/events`);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('25');
    expect(req.request.params.get('from')).toBe('2026-11-01T00:00:00.000Z');
    expect(req.request.params.get('to')).toBe('2026-11-30T23:59:59.999Z');
    expect(req.request.params.get('actorId')).toBe('u1');
    expect(req.request.params.get('action')).toBe('role_assigned');
    expect(req.request.params.get('schoolId')).toBe('s1');
    req.flush({ data: [], total: 0, page: 2, limit: 25, totalPages: 0 });
  });

  it('exposes no write call', () => {
    const api = service as unknown as Record<string, unknown>;
    for (const name of ['create', 'update', 'delete', 'remove', 'post', 'patch', 'put']) {
      expect(api[name]).toBeUndefined();
    }
  });
});
