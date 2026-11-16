import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { environment } from 'src/environments/environment';

export interface PasswordRuleStatus {
  minLength: boolean;
  hasLower: boolean;
  hasUpper: boolean;
  hasNumberOrSymbol: boolean;
  matchesConfirm: boolean;
}

@Component({
  selector: 'app-auth-password-setup',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './auth-password-setup.component.html',
  styleUrl: './auth-password-setup.component.scss',
})
export class AuthPasswordSetupComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(GoeyToastService);

  readonly token = signal<string>('');
  readonly loading = signal<boolean>(false);
  readonly isSuccess = signal<boolean>(false);
  readonly errorMessage = signal<string>('');
  readonly showPassword = signal<boolean>(false);
  readonly showConfirmPassword = signal<boolean>(false);

  passwordForm: FormGroup = this.fb.group(
    {
      tokenInput: ['', [Validators.required]],
      newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
      confirmPassword: ['', [Validators.required]],
    },
    {
      validators: (group: FormGroup) => {
        const pass = group.get('newPassword')?.value;
        const confirm = group.get('confirmPassword')?.value;
        return pass && confirm && pass !== confirm ? { mismatch: true } : null;
      },
    },
  );

  ngOnInit(): void {
    // Extract token from query parameter or path parameter
    const queryToken = this.route.snapshot.queryParamMap.get('token');
    const pathToken = this.route.snapshot.paramMap.get('token');
    const resolvedToken = (queryToken || pathToken || '').trim();

    if (resolvedToken) {
      this.token.set(resolvedToken);
      this.passwordForm.patchValue({ tokenInput: resolvedToken });
    }
  }

  get rules(): PasswordRuleStatus {
    const password = this.passwordForm.get('newPassword')?.value || '';
    const confirm = this.passwordForm.get('confirmPassword')?.value || '';

    return {
      minLength: password.length >= 8,
      hasLower: /[a-z]/.test(password),
      hasUpper: /[A-Z]/.test(password),
      hasNumberOrSymbol: /[\d\W_]/.test(password),
      matchesConfirm: Boolean(password && confirm && password === confirm),
    };
  }

  get strengthScore(): number {
    const r = this.rules;
    let score = 0;
    if (r.minLength) score += 1;
    if (r.hasLower && r.hasUpper) score += 1;
    if (r.hasNumberOrSymbol) score += 1;
    if (r.matchesConfirm) score += 1;
    return score;
  }

  get strengthLabel(): string {
    switch (this.strengthScore) {
      case 1:
        return 'Weak';
      case 2:
        return 'Fair';
      case 3:
        return 'Good';
      case 4:
        return 'Strong';
      default:
        return 'Too short';
    }
  }

  get strengthColorClass(): string {
    switch (this.strengthScore) {
      case 1:
        return 'bg-danger';
      case 2:
        return 'bg-warning';
      case 3:
        return 'bg-info';
      case 4:
        return 'bg-success';
      default:
        return 'bg-secondary';
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((val) => !val);
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((val) => !val);
  }

  onSubmit(): void {
    if (this.passwordForm.invalid || this.loading()) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    const tokenValue = this.passwordForm.get('tokenInput')?.value?.trim();
    const newPasswordValue = this.passwordForm.get('newPassword')?.value;

    if (!tokenValue) {
      this.errorMessage.set('Setup token is required. Please use the complete invitation link.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set('');

    const payload = {
      token: tokenValue,
      newPassword: newPasswordValue,
    };

    this.http
      .post<{ message: string }>(`${environment.apiUrl}/auth/password/setup`, payload)
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          this.isSuccess.set(true);
          const successMsg =
            res?.message || 'Password set up successfully! Your account is now active.';
          this.toast.success('Account Activated', {
            description: successMsg,
          });
        },
        error: (error: HttpErrorResponse) => {
          this.loading.set(false);
          const msg = this.extractErrorMessage(error);
          this.errorMessage.set(msg);
          this.toast.error('Setup Failed', {
            description: msg,
          });
        },
      });
  }

  goToLogin(): void {
    void this.router.navigate(['/admin/login']);
  }

  private extractErrorMessage(error: HttpErrorResponse): string {
    if (error.error && typeof error.error === 'object') {
      const body = error.error as { message?: string | string[]; error?: string };
      if (Array.isArray(body.message)) {
        return body.message.join('. ');
      }
      if (typeof body.message === 'string') {
        return body.message;
      }
      if (typeof body.error === 'string') {
        return body.error;
      }
    }
    if (error.status === 400) {
      return 'Invalid, expired, or already used setup token. Please request a new invitation link.';
    }
    if (error.status === 403) {
      return 'This account is suspended. Please contact your platform administrator.';
    }
    if (error.status === 404) {
      return 'Account or setup token not found.';
    }
    return 'Failed to set up password. Please verify the invitation link and try again.';
  }
}
