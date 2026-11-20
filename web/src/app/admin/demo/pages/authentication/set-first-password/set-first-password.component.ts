import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators
} from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { environment } from 'src/environments/environment';

function passwordStrengthValidator(control: AbstractControl): ValidationErrors | null {
  const value = (control.value as string) || '';
  if (!value) return null;

  const hasLower = /[a-z]/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasNumberOrSymbol = /[0-9\W_]/.test(value);

  if (!hasLower || !hasUpper || !hasNumberOrSymbol) {
    return { weakPassword: true };
  }
  return null;
}

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value as string | undefined;
  const confirmPassword = group.get('confirmPassword')?.value as string | undefined;
  if (!password || !confirmPassword) return null;
  return password === confirmPassword ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-set-first-password',
  imports: [ReactiveFormsModule, RouterModule],
  templateUrl: './set-first-password.component.html',
  styleUrl: './set-first-password.component.scss'
})
export class SetFirstPasswordComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly toast = inject(GoeyToastService);

  readonly token = signal('');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);

  readonly form = this.fb.group(
    {
      password: [
        '',
        [Validators.required, Validators.minLength(8), Validators.maxLength(128), passwordStrengthValidator]
      ],
      confirmPassword: ['', [Validators.required]]
    },
    { validators: passwordMatchValidator }
  );

  get rules() {
    const password = this.form.controls.password.value;
    const confirm = this.form.controls.confirmPassword.value;
    return {
      minLength: password.length >= 8 && password.length <= 128,
      mixedCase: /[a-z]/.test(password) && /[A-Z]/.test(password),
      numberOrSymbol: /[0-9\W_]/.test(password),
      match: password.length > 0 && password === confirm
    };
  }

  ngOnInit(): void {
    const queryToken = this.route.snapshot.queryParamMap.get('token');
    const pathToken = this.route.snapshot.paramMap.get('token');
    const resolved = (queryToken || pathToken || '').trim();
    this.token.set(resolved);

    if (!resolved) {
      const msg = 'Missing invitation token. Please open the setup link from your invitation.';
      this.error.set(msg);
      this.toast.error('Invalid Invitation Link', { description: msg });
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((v) => !v);
  }

  submit(): void {
    if (this.loading()) return;

    if (!this.token()) {
      const msg = 'Missing invitation token. Please open the setup link from your invitation.';
      this.error.set(msg);
      this.toast.error('Invalid Invitation Link', { description: msg });
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      const msg = this.form.hasError('passwordMismatch')
        ? 'Passwords do not match.'
        : 'Please satisfy all password requirements before continuing.';
      this.error.set(msg);
      this.toast.error('Invalid Password', { description: msg });
      return;
    }

    this.loading.set(true);
    this.error.set('');

    const newPassword = this.form.controls.password.value;

    this.http
      .post<{ message: string }>(`${environment.apiUrl}/auth/password/setup`, {
        token: this.token(),
        newPassword
      })
      .subscribe({
        next: () => {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          this.loading.set(false);
          this.toast.success('Password Set', {
            description: 'Your account is now active. Please sign in with your new password.'
          });
          void this.router.navigateByUrl('/admin/login');
        },
        error: (response: HttpErrorResponse) => {
          this.loading.set(false);
          const errorMsg = readErrorMessage(response);
          this.error.set(errorMsg);
          this.toast.error('Password Setup Failed', { description: errorMsg });
        }
      });
  }
}

/** Nest returns `message` as a string or, for DTO validation, as an array of strings. */
function readErrorMessage(response: HttpErrorResponse): string {
  const body: unknown = response.error;
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join('. ');
    if (typeof message === 'string') return message;
  }
  if (response.status === 0) {
    return 'Unable to reach API server. Please verify the backend is running.';
  }
  return 'Could not set password. The invitation link may be invalid or expired.';
}
