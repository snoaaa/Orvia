import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';

@Component({
  selector: 'app-auth-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './auth-register.component.html',
  styleUrl: './auth-register.component.scss',
})
export class AuthRegisterComponent {
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(GoeyToastService);

  readonly loading = signal(false);
  readonly infoMessage = signal('');
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);

  // Exact same single Google IdP option as Login
  readonly SignUpOptions = [
    {
      image: 'assets/images/authentication/google.svg',
      name: 'Google',
    },
  ];

  registerForm: FormGroup = this.fb.group(
    {
      fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(150)]],
      password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
      confirmPassword: ['', [Validators.required]],
      agreeTerms: [true, [Validators.requiredTrue]],
    },
    {
      validators: (group: FormGroup) => {
        const pass = group.get('password')?.value;
        const confirm = group.get('confirmPassword')?.value;
        return pass && confirm && pass !== confirm ? { mismatch: true } : null;
      },
    },
  );

  togglePasswordVisibility(): void {
    this.showPassword.update((val) => !val);
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((val) => !val);
  }

  onSubmit(): void {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    setTimeout(() => {
      this.loading.set(false);
      this.infoMessage.set(
        'Orvia administrator accounts are provisioned via institutional invitation. If you have an invitation token, please use the Set Password link.',
      );
      this.toast.info('Institutional Access', {
        description:
          'Administrator accounts require an invitation. Please check your email or contact your administrator.',
      });
    }, 400);
  }

  goToPasswordSetup(): void {
    void this.router.navigate(['/admin/password/setup']);
  }

  goToLogin(): void {
    void this.router.navigate(['/admin/login']);
  }
}
