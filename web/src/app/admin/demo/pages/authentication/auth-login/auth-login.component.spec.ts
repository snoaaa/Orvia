import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { environment } from 'src/environments/environment';
import { AuthLoginComponent } from './auth-login.component';

describe('AuthLoginComponent', () => {
  let component: AuthLoginComponent;
  let fixture: ComponentFixture<AuthLoginComponent>;
  let httpMock: HttpTestingController;
  let mockToast: any;

  beforeEach(async () => {
    mockToast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AuthLoginComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'admin/dashboard/default', component: class DummyComponent {} }]),
        { provide: GoeyToastService, useValue: mockToast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthLoginComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create and have Google sign-in option', () => {
    expect(component).toBeTruthy();
    expect(component.SignInOptions.length).toBe(1);
    expect(component.SignInOptions[0].name).toBe('Google');
  });

  it('should sign in successfully and store tokens', () => {
    component.signIn('admin@wamdp.platform', 'wamdp_admin_2026!');
    expect(component.loading()).toBe(true);

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/admin/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      email: 'admin@wamdp.platform',
      password: 'wamdp_admin_2026!',
    });

    req.flush({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      sessionId: 'session-1',
      refreshExpiresAt: '2026-12-16T00:00:00.000Z',
    });

    expect(component.loading()).toBe(false);
    expect(localStorage.getItem('accessToken')).toBe('mock-access-token');
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('should handle authentication errors and show error alert', () => {
    component.signIn('wrong@email.com', 'badpass');

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/admin/login`);
    req.flush(
      { message: 'Invalid email or password', statusCode: 401 },
      { status: 401, statusText: 'Unauthorized' },
    );

    expect(component.loading()).toBe(false);
    expect(component.error()).toBe('Invalid email or password');
    expect(mockToast.error).toHaveBeenCalled();
  });
});
