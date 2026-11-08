import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from 'src/environments/environment';
import { ActiveSession, PaginatedUsers, UserEntity } from '../models/user.model';
import { UserManagementService } from './user-management.service';

describe('UserManagementService', () => {
  let service: UserManagementService;
  let httpMock: HttpTestingController;

  const mockUser: UserEntity = {
    id: 'user-uuid-1',
    email: 'admin.a@demo.test',
    fullName: 'Admin A',
    authProvider: 'local',
    status: 'ACTIVE',
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z'
  };

  const mockSession: ActiveSession = {
    id: 'session-uuid-1',
    current: true,
    device: { id: 'device-1', platform: 'android', lastSyncAt: '2026-10-20T10:00:00.000Z' },
    ip: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    createdAt: '2026-10-20T10:00:00.000Z',
    lastUsedAt: '2026-10-20T10:30:00.000Z',
    expiresAt: '2026-11-20T10:00:00.000Z'
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UserManagementService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(UserManagementService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should fetch paginated users with query params', () => {
    const mockResponse: PaginatedUsers = {
      data: [mockUser],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1
    };

    service.getUsers({ page: 1, limit: 10, status: 'ACTIVE', search: 'admin' }).subscribe((res) => {
      expect(res.data.length).toBe(1);
      expect(res.data[0].email).toBe('admin.a@demo.test');
      expect(res.total).toBe(1);
    });

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/identity/users`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.get('status')).toBe('ACTIVE');
    expect(req.request.params.get('search')).toBe('admin');
    req.flush(mockResponse);
  });

  it('should fetch user by ID', () => {
    service.getUserById('user-uuid-1').subscribe((user) => {
      expect(user.id).toBe('user-uuid-1');
      expect(user.fullName).toBe('Admin A');
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/users/user-uuid-1`);
    expect(req.request.method).toBe('GET');
    req.flush(mockUser);
  });

  it('should patch user profile', () => {
    const updated = { ...mockUser, fullName: 'Admin Updated' };

    service.updateUser('user-uuid-1', { fullName: 'Admin Updated' }).subscribe((user) => {
      expect(user.fullName).toBe('Admin Updated');
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/users/user-uuid-1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ fullName: 'Admin Updated' });
    req.flush(updated);
  });

  it('should suspend user account and return updated user with status SUSPENDED', () => {
    const suspended = { ...mockUser, status: 'SUSPENDED' as const };

    service.suspendUser('user-uuid-1').subscribe((user) => {
      expect(user.status).toBe('SUSPENDED');
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/users/user-uuid-1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'SUSPENDED' });
    req.flush(suspended);
  });

  it('should reactivate user account and return updated user with status ACTIVE', () => {
    const reactivated = { ...mockUser, status: 'ACTIVE' as const };

    service.reactivateUser('user-uuid-1').subscribe((user) => {
      expect(user.status).toBe('ACTIVE');
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/users/user-uuid-1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'ACTIVE' });
    req.flush(reactivated);
  });

  it('should fetch user sessions', () => {
    service.getUserSessions('user-uuid-1').subscribe((sessions) => {
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('session-uuid-1');
      expect(sessions[0].device?.platform).toBe('android');
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/users/user-uuid-1/sessions`);
    expect(req.request.method).toBe('GET');
    req.flush([mockSession]);
  });

  it('should revoke a single user session', () => {
    service.revokeSession('user-uuid-1', 'session-uuid-1').subscribe(() => {
      expect(true).toBe(true);
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/users/user-uuid-1/sessions/session-uuid-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('should revoke all user sessions', () => {
    service.revokeAllSessions('user-uuid-1').subscribe((res) => {
      expect(res.revoked).toBe(3);
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/identity/users/user-uuid-1/sessions`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ revoked: 3 });
  });
});

