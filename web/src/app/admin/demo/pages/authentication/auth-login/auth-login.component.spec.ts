import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { environment } from 'src/environments/environment';
import { AuthLoginComponent } from './auth-login.component';

describe('AuthLoginComponent (Issue #91 — Google Sign-In for Staff with Document Rights)', () => {
  let component: AuthLoginComponent;
  let fixture: ComponentFixture<AuthLoginComponent>;
  let httpMock: HttpTestingController;
  let router: Router;
  let toastMock: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  async function setup(queryParams: Record<string, string> = {}) {
    localStorage.clear();
    toastMock = {
      success: vi.fn(),
      error: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [AuthLoginComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: GoeyToastService, useValue: toastMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(queryParams)
            }
          }
        }
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture = TestBed.createComponent(AuthLoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Flush the initial GET /auth/google/config request
    const cfgReq = httpMock.match(`${environment.apiUrl}/auth/google/config`);
    for (const r of cfgReq) {
      r.flush({ clientId: 'test-google-client-id.apps.googleusercontent.com' });
    }
  }

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('renders the "Se connecter avec Google" button on the login page', async () => {
    await setup();
    const btn = fixture.nativeElement.querySelector('#google-signin-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain('Se connecter avec Google');
  });

  it('signs in a staff member with document-management rights, stores session, and redirects to portal', async () => {
    await setup();

    component.signInWithGoogle('valid-google-id-token');

    const loginReq = httpMock.expectOne(`${environment.apiUrl}/auth/google`);
    expect(loginReq.request.method).toBe('POST');
    expect(loginReq.request.body).toEqual({
      idToken: 'valid-google-id-token',
      client: 'portal'
    });

    loginReq.flush({
      accessToken: 'staff-access-jwt',
      refreshToken: 'staff-refresh-token',
      tokenType: 'Bearer',
      expiresIn: 900,
      sessionId: 'sess-123',
      refreshExpiresAt: '2026-12-20T00:00:00.000Z'
    });

    const meReq = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    expect(meReq.request.headers.get('Authorization')).toBe('Bearer staff-access-jwt');
    meReq.flush({
      id: 'user-staff-docmgr',
      email: 'docmgr@school.edu',
      fullName: 'Staff Doc Manager',
      status: 'ACTIVE',
      role: 'STAFF',
      roles: ['STAFF'],
      permissions: ['spaces:read', 'documents:read', 'documents:manage'],
      schoolIds: ['school-1'],
      isPlatformAdmin: false
    });

    expect(localStorage.getItem('accessToken')).toBe('staff-access-jwt');
    expect(localStorage.getItem('refreshToken')).toBe('staff-refresh-token');
    expect(toastMock.success).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/spaces');
  });

  it('refuses a staff member without document-management rights or a student with a clear mobile app message', async () => {
    await setup();

    component.signInWithGoogle('student-google-id-token');

    const loginReq = httpMock.expectOne(`${environment.apiUrl}/auth/google`);
    loginReq.flush(
      {
        message:
          'Access denied: the web portal is reserved for administrators and staff with document-management rights. Please use the Orvia mobile app.'
      },
      { status: 403, statusText: 'Forbidden' }
    );

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(component.error()).toContain('Please use the Orvia mobile app');
    expect(toastMock.error).toHaveBeenCalledWith(
      'Google Sign-In Refused',
      expect.objectContaining({
        description: expect.stringContaining('Please use the Orvia mobile app')
      })
    );
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('refuses a user on client side if /auth/me lacks portal permissions', async () => {
    await setup();

    component.signInWithGoogle('regular-staff-token');

    const loginReq = httpMock.expectOne(`${environment.apiUrl}/auth/google`);
    loginReq.flush({
      accessToken: 'mobile-only-jwt',
      refreshToken: 'mobile-only-refresh',
      tokenType: 'Bearer',
      expiresIn: 900,
      sessionId: 'sess-mobile',
      refreshExpiresAt: '2026-12-20T00:00:00.000Z'
    });

    const meReq = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    meReq.flush({
      id: 'user-regular-staff',
      email: 'staff@school.edu',
      fullName: 'Regular Staff',
      status: 'ACTIVE',
      role: 'STAFF',
      roles: ['STAFF'],
      permissions: ['spaces:read', 'documents:read'],
      schoolIds: ['school-1'],
      isPlatformAdmin: false
    });

    const logoutReq = httpMock.expectOne(`${environment.apiUrl}/auth/logout`);
    expect(logoutReq.request.method).toBe('POST');
    logoutReq.flush(null, { status: 204, statusText: 'No Content' });

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(toastMock.error).toHaveBeenCalledWith(
      'Portal Access Refused',
      expect.objectContaining({
        description: expect.stringContaining('Please use the Orvia mobile app')
      })
    );
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('shows clear errors for unknown account, suspended account, and domain not allowed', async () => {
    await setup();

    // 1. Unknown Google account
    component.signInWithGoogle('unknown-google-token');
    httpMock.expectOne(`${environment.apiUrl}/auth/google`).flush(
      {
        message: 'No Orvia account was found for this Google email. Please contact your school administrator.'
      },
      { status: 401, statusText: 'Unauthorized' }
    );
    expect(component.error()).toContain('No Orvia account was found');

    // 2. Suspended account
    component.signInWithGoogle('suspended-google-token');
    httpMock.expectOne(`${environment.apiUrl}/auth/google`).flush(
      {
        message: 'Your account has been suspended. Please contact your school administrator.'
      },
      { status: 403, statusText: 'Forbidden' }
    );
    expect(component.error()).toContain('suspended');

    // 3. Domain not allowed
    component.signInWithGoogle('disallowed-domain-token');
    httpMock.expectOne(`${environment.apiUrl}/auth/google`).flush(
      {
        message: 'Your Google email domain is not allowed for your school.'
      },
      { status: 403, statusText: 'Forbidden' }
    );
    expect(component.error()).toContain('domain is not allowed');
  });
});
