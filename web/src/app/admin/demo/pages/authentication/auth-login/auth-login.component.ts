import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import {
  PortalSessionService,
  PortalSessionUser
} from 'src/app/admin/identity/services/portal-session.service';
import { environment } from 'src/environments/environment';

/** Response of POST /auth/admin/login and POST /auth/google (TokenPairEntity in the API). */
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
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly toast = inject(GoeyToastService);
  private readonly session = inject(PortalSessionService);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly showPassword = signal(false);

  // public method
  SignInOptions = [
    {
      image: 'assets/images/authentication/google.svg',
      name: 'Google'
    }
  ];

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  /**
   * Signs in through the backend, loads the user's roles, permissions and schools into
   * the session store, and redirects to the role-appropriate default landing page (#92).
   */
  signIn(email: string, password: string): void {
    if (this.loading()) return;

    this.loading.set(true);
    this.error.set('');

    this.http.post<TokenPair>(`${environment.apiUrl}/auth/admin/login`, { email, password }).subscribe({
      next: ({ accessToken, refreshToken }) => {
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);

        this.http
          .get<PortalSessionUser>(`${environment.apiUrl}/auth/me`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          })
          .subscribe({
            next: (me) => {
              this.session.setUser(me);
              this.loading.set(false);
              this.toast.success('Signed In', { description: 'Welcome to the WAMDP Admin Console.' });
              void this.router.navigateByUrl(this.session.defaultLandingUrl());
            },
            error: () => {
              this.loading.set(false);
              this.toast.success('Signed In', { description: 'Welcome to the WAMDP Admin Console.' });
              void this.router.navigateByUrl('/admin/dashboard/default');
            }
          });
      },
      error: (response: HttpErrorResponse) => {
        this.loading.set(false);
        const errorMsg = readErrorMessage(response);
        this.error.set(errorMsg);
        this.toast.error('Authentication Failed', { description: errorMsg });
      }
    });
  }

  /**
   * Signs in with Google (for staff with document-management rights) and redirects to `/admin/spaces` (#91, #92).
   */
  signInWithGoogle(idToken?: string): void {
    if (this.loading()) return;

    const devEmail = this.route?.snapshot?.queryParamMap?.get('google_email')?.trim();
    if (!idToken && !devEmail) return;

    this.loading.set(true);
    this.error.set('');

    const authRequest$ =
      !environment.production && devEmail && !idToken
        ? this.http.post<TokenPair>(`${environment.apiUrl}/auth/dev/token`, { email: devEmail })
        : this.http.post<TokenPair>(`${environment.apiUrl}/auth/google`, { idToken });

    authRequest$.subscribe({
        next: ({ accessToken, refreshToken }) => {
          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', refreshToken);

          this.http
            .get<PortalSessionUser>(`${environment.apiUrl}/auth/me`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            })
            .subscribe({
              next: (me) => {
                this.session.setUser(me);
                if (!this.session.hasPortalAccess()) {
                  this.session.clearSession();
                  this.loading.set(false);
                  const msg =
                    'Access denied: the web portal is reserved for administrators and staff with document-management rights. Please use the mobile app.';
                  this.error.set(msg);
                  this.toast.error('Portal Access Refused', { description: msg });
                  return;
                }
                this.loading.set(false);
                this.toast.success('Signed In', {
                  description: `Welcome, ${me.fullName || me.email}.`
                });
                void this.router.navigateByUrl(this.session.defaultLandingUrl());
              },
              error: (err: HttpErrorResponse) => {
                this.session.clearSession();
                this.loading.set(false);
                const msg = readErrorMessage(err);
                this.error.set(msg);
                this.toast.error('Authentication Failed', { description: msg });
              }
            });
        },
        error: (response: HttpErrorResponse) => {
          this.loading.set(false);
          const errorMsg = readErrorMessage(response);
          this.error.set(errorMsg);
          this.toast.error('Authentication Failed', { description: errorMsg });
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
