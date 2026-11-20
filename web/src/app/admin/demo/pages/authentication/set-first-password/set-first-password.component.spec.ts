import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { environment } from 'src/environments/environment';
import { SetFirstPasswordComponent } from './set-first-password.component';

describe('SetFirstPasswordComponent', () => {
  let component: SetFirstPasswordComponent;
  let fixture: ComponentFixture<SetFirstPasswordComponent>;
  let httpMock: HttpTestingController;
  let router: Router;
  let toastMock: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  async function setup(queryToken?: string, pathToken?: string) {
    toastMock = {
      success: vi.fn(),
      error: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [SetFirstPasswordComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: GoeyToastService, useValue: toastMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(queryToken ? { token: queryToken } : {}),
              paramMap: convertToParamMap(pathToken ? { token: pathToken } : {})
            }
          }
        }
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture = TestBed.createComponent(SetFirstPasswordComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    httpMock.verify();
  });

  it('reads the invitation token from query parameters', async () => {
    await setup('invite-token-123');
    expect(component.token()).toBe('invite-token-123');
    expect(component.error()).toBe('');
  });

  it('shows a toast error when the invitation token is missing from the URL', async () => {
    await setup();
    expect(component.token()).toBe('');
    expect(component.error()).toContain('Missing invitation token');
    expect(toastMock.error).toHaveBeenCalledWith(
      'Invalid Invitation Link',
      expect.objectContaining({
        description: expect.stringContaining('Missing invitation token')
      })
    );
  });

  it('toggles password and confirm password visibility', async () => {
    await setup('invite-token-123');

    expect(component.showPassword()).toBe(false);
    component.togglePasswordVisibility();
    expect(component.showPassword()).toBe(true);

    expect(component.showConfirmPassword()).toBe(false);
    component.toggleConfirmPasswordVisibility();
    expect(component.showConfirmPassword()).toBe(true);
  });

  it('enforces password strength and confirmation rules on the client', async () => {
    await setup('invite-token-123');

    component.form.patchValue({ password: 'short', confirmPassword: 'short' });
    expect(component.rules.minLength).toBe(false);
    expect(component.form.invalid).toBe(true);

    component.form.patchValue({ password: 'alllowercase123', confirmPassword: 'alllowercase123' });
    expect(component.rules.minLength).toBe(true);
    expect(component.rules.mixedCase).toBe(false);
    expect(component.form.invalid).toBe(true);

    component.form.patchValue({ password: 'ValidPassword123!', confirmPassword: 'DifferentPassword123!' });
    expect(component.rules.minLength).toBe(true);
    expect(component.rules.mixedCase).toBe(true);
    expect(component.rules.numberOrSymbol).toBe(true);
    expect(component.rules.match).toBe(false);
    expect(component.form.hasError('passwordMismatch')).toBe(true);
    expect(component.form.invalid).toBe(true);

    component.form.patchValue({ password: 'ValidPassword123!', confirmPassword: 'ValidPassword123!' });
    expect(component.rules.match).toBe(true);
    expect(component.form.valid).toBe(true);
  });

  it('calls POST /auth/password/setup and redirects to /admin/login on success', async () => {
    await setup('valid-setup-token');

    component.form.patchValue({
      password: 'ValidPassword123!',
      confirmPassword: 'ValidPassword123!'
    });

    component.submit();

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/password/setup`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      token: 'valid-setup-token',
      newPassword: 'ValidPassword123!'
    });

    req.flush({ message: 'Password set up successfully. Account is now active and ready for login.' });

    expect(component.loading()).toBe(false);
    expect(toastMock.success).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/login');
  });

  it('displays a clear toast error message when the token is expired, used or invalid', async () => {
    await setup('expired-token');

    component.form.patchValue({
      password: 'ValidPassword123!',
      confirmPassword: 'ValidPassword123!'
    });

    component.submit();

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/password/setup`);
    req.flush(
      { message: 'Setup token has expired' },
      { status: 400, statusText: 'Bad Request' }
    );

    expect(component.loading()).toBe(false);
    expect(component.error()).toBe('Setup token has expired');
    expect(toastMock.error).toHaveBeenCalledWith(
      'Password Setup Failed',
      expect.objectContaining({ description: 'Setup token has expired' })
    );
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('has labelled form fields and visibility toggles for keyboard accessibility', async () => {
    await setup('valid-setup-token');
    const el: HTMLElement = fixture.nativeElement;

    const passwordLabel = el.querySelector('label[for="password"]');
    const passwordInput = el.querySelector('input#password');
    const confirmLabel = el.querySelector('label[for="confirmPassword"]');
    const confirmInput = el.querySelector('input#confirmPassword');
    const toggles = el.querySelectorAll('button.password-toggle');

    expect(passwordLabel?.textContent).toContain('New Password');
    expect(passwordInput).not.toBeNull();
    expect(confirmLabel?.textContent).toContain('Confirm Password');
    expect(confirmInput).not.toBeNull();
    expect(toggles.length).toBe(2);
  });
});
