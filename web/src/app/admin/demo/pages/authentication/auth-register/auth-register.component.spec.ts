import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { AuthRegisterComponent } from './auth-register.component';

describe('AuthRegisterComponent', () => {
  let component: AuthRegisterComponent;
  let fixture: ComponentFixture<AuthRegisterComponent>;
  let mockToast: any;

  beforeEach(async () => {
    mockToast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AuthRegisterComponent],
      providers: [provideRouter([]), { provide: GoeyToastService, useValue: mockToast }],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthRegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create with initial invalid form state', () => {
    expect(component).toBeTruthy();
    expect(component.registerForm.invalid).toBe(true);
    expect(component.SignUpOptions.length).toBe(1);
    expect(component.SignUpOptions[0].name).toBe('Google');
  });

  it('should validate form fields correctly', () => {
    component.registerForm.patchValue({
      fullName: 'A',
      email: 'invalid-email',
      password: 'short',
      confirmPassword: 'mismatch',
    });
    expect(component.registerForm.get('fullName')?.hasError('minlength')).toBe(true);
    expect(component.registerForm.get('email')?.hasError('email')).toBe(true);
    expect(component.registerForm.get('password')?.hasError('minlength')).toBe(true);
    expect(component.registerForm.hasError('mismatch')).toBe(true);

    component.registerForm.patchValue({
      fullName: 'School Admin',
      email: 'admin@school.edu',
      password: 'StrongPassword123!',
      confirmPassword: 'StrongPassword123!',
      agreeTerms: true,
    });
    expect(component.registerForm.valid).toBe(true);
  });

  it('should toggle password visibility flags', () => {
    expect(component.showPassword()).toBe(false);
    component.togglePasswordVisibility();
    expect(component.showPassword()).toBe(true);

    expect(component.showConfirmPassword()).toBe(false);
    component.toggleConfirmPasswordVisibility();
    expect(component.showConfirmPassword()).toBe(true);
  });

  it('should mark fields as touched when submitting invalid form', () => {
    component.onSubmit();
    expect(component.registerForm.get('fullName')?.touched).toBe(true);
    expect(component.registerForm.get('email')?.touched).toBe(true);
  });
});
