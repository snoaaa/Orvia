import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { environment } from 'src/environments/environment';
import { AuthPasswordSetupComponent } from './auth-password-setup.component';

describe('AuthPasswordSetupComponent', () => {
  let component: AuthPasswordSetupComponent;
  let fixture: ComponentFixture<AuthPasswordSetupComponent>;
  let httpMock: HttpTestingController;
  let mockToast: any;

  beforeEach(async () => {
    mockToast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AuthPasswordSetupComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: GoeyToastService, useValue: mockToast },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({ token: 'test-valid-token-123' }),
              paramMap: convertToParamMap({}),
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthPasswordSetupComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create and resolve token from route query parameter', () => {
    expect(component).toBeTruthy();
    expect(component.token()).toBe('test-valid-token-123');
    expect(component.passwordForm.get('tokenInput')?.value).toBe('test-valid-token-123');
  });

  it('should validate password length and confirm mismatch correctly', () => {
    component.passwordForm.patchValue({
      newPassword: 'short',
      confirmPassword: 'short',
    });
    expect(component.passwordForm.get('newPassword')?.hasError('minlength')).toBe(true);

    component.passwordForm.patchValue({
      newPassword: 'StrongPassword123!',
      confirmPassword: 'DifferentPassword123!',
    });
    expect(component.passwordForm.hasError('mismatch')).toBe(true);

    component.passwordForm.patchValue({
      newPassword: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
    });
    expect(component.passwordForm.valid).toBe(true);
    expect(component.rules.matchesConfirm).toBe(true);
  });

  it('should calculate strength score and label based on rules', () => {
    component.passwordForm.patchValue({
      newPassword: 'password',
      confirmPassword: 'password',
    });
    expect(component.strengthScore).toBeGreaterThanOrEqual(1);

    component.passwordForm.patchValue({
      newPassword: 'SuperSecurePassword2026!',
      confirmPassword: 'SuperSecurePassword2026!',
    });
    expect(component.strengthScore).toBe(4);
    expect(component.strengthLabel).toBe('Strong');
    expect(component.strengthColorClass).toBe('bg-success');
  });

  it('should toggle password visibility states', () => {
    expect(component.showPassword()).toBe(false);
    component.togglePasswordVisibility();
    expect(component.showPassword()).toBe(true);

    expect(component.showConfirmPassword()).toBe(false);
    component.toggleConfirmPasswordVisibility();
    expect(component.showConfirmPassword()).toBe(true);
  });

  it('should submit successfully and switch to success view', () => {
    component.passwordForm.patchValue({
      tokenInput: 'test-valid-token-123',
      newPassword: 'StrongPassword2026!',
      confirmPassword: 'StrongPassword2026!',
    });

    component.onSubmit();
    expect(component.loading()).toBe(true);

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/password/setup`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      token: 'test-valid-token-123',
      newPassword: 'StrongPassword2026!',
    });

    req.flush({ message: 'Password set up successfully' });

    expect(component.loading()).toBe(false);
    expect(component.isSuccess()).toBe(true);
    expect(mockToast.success).toHaveBeenCalledWith(
      'Account Activated',
      expect.objectContaining({ description: expect.stringContaining('successfully') }),
    );
  });

  it('should handle expired or invalid token errors with clear message', () => {
    component.passwordForm.patchValue({
      tokenInput: 'test-valid-token-123',
      newPassword: 'StrongPassword2026!',
      confirmPassword: 'StrongPassword2026!',
    });

    component.onSubmit();

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/password/setup`);
    req.flush(
      { message: 'Setup token has already been used', error: 'Bad Request', statusCode: 400 },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(component.loading()).toBe(false);
    expect(component.isSuccess()).toBe(false);
    expect(component.errorMessage()).toContain('already been used');
    expect(mockToast.error).toHaveBeenCalled();
  });

  it('should handle suspended account error', () => {
    component.passwordForm.patchValue({
      tokenInput: 'test-valid-token-123',
      newPassword: 'StrongPassword2026!',
      confirmPassword: 'StrongPassword2026!',
    });

    component.onSubmit();

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/password/setup`);
    req.flush(
      { message: 'Account is suspended', error: 'Forbidden', statusCode: 403 },
      { status: 403, statusText: 'Forbidden' },
    );

    expect(component.errorMessage()).toContain('Account is suspended');
    expect(mockToast.error).toHaveBeenCalled();
  });
});
