// project import
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { environment } from 'src/environments/environment';

/** Response of POST /auth/admin/login (TokenPairEntity in the API). */
interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  sessionId: string;
  refreshExpiresAt: string;
}

@Component({
  selector: 'app-auth-login',
  imports: [RouterModule],
  templateUrl: './auth-login.component.html',
  styleUrl: './auth-login.component.scss'
})
export class AuthLoginComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly error = signal('');

  // public method
  SignInOptions = [
    {
      image: 'assets/images/authentication/google.svg',
      name: 'Google'
    }
  ];

  /** Signs in through the backend and, on success, redirects to the admin dashboard. */
  signIn(email: string, password: string): void {
    if (this.loading()) return;

    this.loading.set(true);
    this.error.set('');

    this.http.post<TokenPair>(`${environment.apiUrl}/auth/admin/login`, { email, password }).subscribe({
      next: ({ accessToken, refreshToken }) => {
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
        this.loading.set(false);
        void this.router.navigateByUrl('/admin/dashboard/default');
      },
      error: (response: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(readErrorMessage(response));
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
  return 'Login failed. Please check your email and password.';
}
