import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import {
  PortalSessionService,
  PortalSessionUser
} from 'src/app/admin/identity/services/portal-session.service';
import { environment } from 'src/environments/environment';

/** Response of POST /auth/admin/login and POST /auth/google (TokenPairEntity in the API). */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  sessionId: string;
  refreshExpiresAt: string;
}

/** Subset of GET /auth/me used to verify portal access rights (#91, #92). */
export type AuthenticatedPortalUser = PortalSessionUser;

const PORTAL_ALLOWED_PERMISSIONS = new Set([
  '*',
  'users:assign_role',
  'users:invite',
  'users:create',
  'users:update',
  'users:suspend',
  'schools:update',
  'documents:manage',
  'documents.manage',
  'documents:create',
  'documents:update',
  'documents:delete',
  'documents:publish',
  'documents:manage_access',
  'documents:process',
  'documents:access.manage',
  'documents.access.manage',
  'spaces:create',
  'spaces:update',
  'spaces:delete',
  'spaces:manage'
]);

const MOBILE_ONLY_MESSAGE =
  'Access denied: the web portal is reserved for administrators and staff with document-management rights. Please use the Orvia mobile app.';

const GOOGLE_POPUP_MESSAGE_TYPE = 'ORVIA_GOOGLE_OAUTH_CALLBACK';
const GOOGLE_NONCE_STORAGE_KEY = 'orvia_google_oauth_nonce';

@Component({
  selector: 'app-auth-login',
  imports: [RouterModule],
  templateUrl: './auth-login.component.html',
  styleUrl: './auth-login.component.scss'
})
export class AuthLoginComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly toast = inject(GoeyToastService);
  private readonly session = inject(PortalSessionService);

  readonly loading = signal(false);
  readonly googleLoading = signal(false);
  readonly error = signal('');
  readonly showPassword = signal(false);
  readonly googleClientId = signal<string>(environment.googleClientId || '');

  private popupWindow: Window | null = null;
  private popupMonitorTimer?: ReturnType<typeof setInterval>;

  private readonly messageListener = (event: MessageEvent): void => {
    if (typeof window === 'undefined' || event.origin !== window.location.origin) return;
    const data = event.data as { type?: string; idToken?: string; error?: string } | null;
    if (!data || data.type !== GOOGLE_POPUP_MESSAGE_TYPE) return;

    this.clearPopupMonitor();
    if (data.idToken) {
      if (!this.verifyAndConsumeNonce(data.idToken)) {
        const msg = 'Google authentication session expired or invalid nonce. Please try again.';
        this.googleLoading.set(false);
        this.error.set(msg);
        this.toast.error('Google Sign-In Failed', { description: msg });
        return;
      }
      this.exchangeGoogleIdToken(data.idToken);
    } else if (data.error) {
      this.googleLoading.set(false);
      this.error.set(data.error);
      this.toast.error('Google Sign-In Cancelled', { description: data.error });
    }
  };

  SignInOptions = [
    {
      image: 'assets/images/authentication/google.svg',
      name: 'Se connecter avec Google'
    }
  ];

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.messageListener);

      // Handle callback from Google OAuth 2.0 / OpenID Connect (#id_token=... or #error=...)
      if (window.location.hash.includes('id_token=') || window.location.hash.includes('error=')) {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const hashIdToken = hashParams.get('id_token');
        const hashError = hashParams.get('error_description') || hashParams.get('error');

        window.history.replaceState(null, '', window.location.pathname + window.location.search);

        // If running inside the OAuth popup window, send the token back to the main window and close
        if (window.opener && window.opener !== window) {
          window.opener.postMessage(
            {
              type: GOOGLE_POPUP_MESSAGE_TYPE,
              idToken: hashIdToken || undefined,
              error: hashError || undefined
            },
            window.location.origin
          );
          window.close();
          return;
        }

        if (hashIdToken) {
          if (!this.verifyAndConsumeNonce(hashIdToken)) {
            const msg = 'Google authentication session expired or invalid nonce. Please try again.';
            this.error.set(msg);
            this.toast.error('Google Sign-In Failed', { description: msg });
            return;
          }
          this.exchangeGoogleIdToken(hashIdToken);
          return;
        }
        if (hashError) {
          this.error.set(hashError);
          this.toast.error('Google Sign-In Failed', { description: hashError });
          return;
        }
      }
    }

    // Load Google OAuth client ID from backend config if not already configured
    if (!this.googleClientId()) {
      this.http.get<{ clientId: string | null }>(`${environment.apiUrl}/auth/google/config`).subscribe({
        next: (cfg) => {
          if (cfg?.clientId) {
            this.googleClientId.set(cfg.clientId);
          }
        },
        error: () => {}
      });
    }
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.messageListener);
    }
    this.clearPopupMonitor();
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  /**
   * Signs in through email + password, populates the session store with roles, permissions,
   * and schools, and redirects to the role-appropriate default landing page (#92).
   */
  signIn(email: string, password: string): void {
    if (this.loading() || this.googleLoading()) return;

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
        const errorMsg = readErrorMessage(response, 'Login failed. Please check your email and password.');
        this.error.set(errorMsg);
        this.toast.error('Authentication Failed', { description: errorMsg });
      }
    });
  }

  /**
   * Initiates Google OAuth 2.0 / OpenID Connect sign-in for staff with document-management rights (#91, #92).
   * Accepts an explicit `idToken` when provided (e.g. from callback or tests), or opens the
   * Google OpenID Connect authentication flow in the browser.
   */
  signInWithGoogle(idToken?: string): void {
    if (this.loading() || this.googleLoading()) return;

    if (idToken) {
      this.exchangeGoogleIdToken(idToken);
      return;
    }

    // Support dev testing via ?google_email=... query parameter when AUTH_DEV_TOOLS=true
    const devGoogleEmail = this.route?.snapshot?.queryParamMap?.get('google_email')?.trim();
    if (!environment.production && devGoogleEmail) {
      this.exchangeGoogleIdToken(`dev-google:${devGoogleEmail}`);
      return;
    }

    const clientId = this.googleClientId();
    if (!clientId) {
      const msg =
        'Google OAuth Client ID is not configured. Set GOOGLE_CLIENT_IDS in api/.env or googleClientId in environment.ts.';
      this.error.set(msg);
      this.toast.error('Google Sign-In Unavailable', { description: msg });
      return;
    }

    this.openGoogleOAuthPopup(clientId);
  }

  /**
   * Sends the Google ID token to `POST /auth/google` (`client: 'portal'`), verifies that the
   * authenticated user holds portal access (`admin` or `documents:manage`), stores the session,
   * and redirects to the role-appropriate portal landing page (#91, #92).
   */
  exchangeGoogleIdToken(idToken: string): void {
    if (this.loading()) return;

    this.googleLoading.set(true);
    this.error.set('');

    this.http
      .post<TokenPair>(`${environment.apiUrl}/auth/google`, {
        idToken,
        client: 'portal'
      })
      .subscribe({
        next: ({ accessToken, refreshToken }) => {
          // Verify portal permissions against GET /auth/me before completing login
          this.http
            .get<PortalSessionUser>(`${environment.apiUrl}/auth/me`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            })
            .subscribe({
              next: (me) => {
                if (!userHasPortalAccess(me)) {
                  this.session.clearSession();
                  // Revoke the server session immediately as defense-in-depth
                  this.http
                    .post(`${environment.apiUrl}/auth/logout`, {}, { headers: { Authorization: `Bearer ${accessToken}` } })
                    .subscribe({ error: () => {} });
                  this.googleLoading.set(false);
                  this.error.set(MOBILE_ONLY_MESSAGE);
                  this.toast.error('Portal Access Refused', { description: MOBILE_ONLY_MESSAGE });
                  return;
                }

                localStorage.setItem('accessToken', accessToken);
                localStorage.setItem('refreshToken', refreshToken);
                this.session.setUser(me);
                this.googleLoading.set(false);
                this.toast.success('Signed In', {
                  description: `Welcome, ${me.fullName || me.email}.`
                });
                void this.router.navigateByUrl(this.session.defaultLandingUrl());
              },
              error: (meErr: HttpErrorResponse) => {
                this.session.clearSession();
                this.googleLoading.set(false);
                const errorMsg = readErrorMessage(meErr, 'Could not verify portal permissions.');
                this.error.set(errorMsg);
                this.toast.error('Authentication Failed', { description: errorMsg });
              }
            });
        },
        error: (response: HttpErrorResponse) => {
          this.session.clearSession();
          this.googleLoading.set(false);
          const errorMsg = readErrorMessage(
            response,
            'Google sign-in failed. Please verify your institutional account.'
          );
          this.error.set(errorMsg);
          this.toast.error('Google Sign-In Refused', { description: errorMsg });
        }
      });
  }

  private openGoogleOAuthPopup(clientId: string): void {
    if (typeof window === 'undefined') return;

    const redirectUri = `${window.location.origin}/admin/login`;
    const nonce = generateCryptographicNonce();
    try {
      sessionStorage.setItem(GOOGLE_NONCE_STORAGE_KEY, nonce);
    } catch {
      // sessionStorage may be unavailable in restricted contexts
    }

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=id_token` +
      `&scope=${encodeURIComponent('openid email profile')}` +
      `&nonce=${encodeURIComponent(nonce)}` +
      `&prompt=select_account`;

    const width = 520;
    const height = 640;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

    this.popupWindow = window.open(
      authUrl,
      'orvia_google_oauth',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
    );

    if (!this.popupWindow) {
      // Fallback to full-page redirect if popup blocker prevented window.open
      window.location.assign(authUrl);
      return;
    }

    this.googleLoading.set(true);
    this.clearPopupMonitor();
    this.popupMonitorTimer = setInterval(() => {
      if (this.popupWindow && this.popupWindow.closed) {
        this.clearPopupMonitor();
        this.googleLoading.set(false);
      }
    }, 400);
  }

  private verifyAndConsumeNonce(idToken: string): boolean {
    let expectedNonce: string | null = null;
    try {
      expectedNonce = sessionStorage.getItem(GOOGLE_NONCE_STORAGE_KEY);
      sessionStorage.removeItem(GOOGLE_NONCE_STORAGE_KEY);
    } catch {
      return true;
    }
    if (!expectedNonce) return true;

    try {
      const parts = idToken.split('.');
      if (parts.length !== 3) return true;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64)) as { nonce?: string };
      if (payload.nonce && payload.nonce !== expectedNonce) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  private clearPopupMonitor(): void {
    if (this.popupMonitorTimer) {
      clearInterval(this.popupMonitorTimer);
      this.popupMonitorTimer = undefined;
    }
    this.popupWindow = null;
  }
}

function generateCryptographicNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function userHasPortalAccess(user: Partial<PortalSessionUser> | null | undefined): boolean {
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  return (user.permissions ?? []).some((p) => PORTAL_ALLOWED_PERMISSIONS.has(p));
}

/** Nest returns `message` as a string or, for DTO validation, as an array of strings. */
function readErrorMessage(response: HttpErrorResponse, fallback: string): string {
  const body: unknown = response.error;
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join('. ');
    if (typeof message === 'string') return message;
  }
  return fallback;
}
