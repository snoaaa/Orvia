import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, shareReplay, switchMap, tap, throwError } from 'rxjs';
import { environment } from 'src/environments/environment';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

let inFlightAuth: Observable<LoginResponse> | null = null;

function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return false;
    // Consider expired if it expires within the next 30 seconds
    return payload.exp * 1000 <= Date.now() + 30000;
  } catch {
    return true;
  }
}

function autoLogin(http: HttpClient): Observable<LoginResponse> {
  if (!inFlightAuth) {
    inFlightAuth = http
      .post<LoginResponse>(`${environment.apiUrl}/auth/admin/login`, {
        email: 'admin@wamdp.platform',
        password: 'wamdp_admin_2026!'
      })
      .pipe(
        tap((loginRes) => {
          localStorage.setItem('accessToken', loginRes.accessToken);
          localStorage.setItem('refreshToken', loginRes.refreshToken);
          inFlightAuth = null;
        }),
        catchError((err) => {
          inFlightAuth = null;
          return throwError(() => err);
        }),
        shareReplay(1)
      );
  }
  return inFlightAuth;
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const http = inject(HttpClient);

  // Skip login requests to prevent recursion
  if (!req.url.startsWith(environment.apiUrl) || req.url.includes('/auth/admin/login')) {
    return next(req);
  }

  const token = localStorage.getItem('accessToken');

  // If token is missing or expired in local development, proactively authenticate before sending
  if (isTokenExpired(token)) {
    return autoLogin(http).pipe(
      switchMap((loginRes) => {
        const authedReq = req.clone({
          setHeaders: {
            Authorization: `Bearer ${loginRes.accessToken}`
          }
        });
        return next(authedReq);
      }),
      catchError(() => next(req))
    );
  }

  // Token is valid; attach it to outgoing request
  const authReq = req.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`
    }
  });

  return next(authReq).pipe(
    catchError((error: unknown) => {
      // If server rejects with 401 Unauthorized, invalidate token and re-login once
      if (error instanceof HttpErrorResponse && error.status === 401) {
        localStorage.removeItem('accessToken');
        return autoLogin(http).pipe(
          switchMap((loginRes) => {
            const retryReq = req.clone({
              setHeaders: {
                Authorization: `Bearer ${loginRes.accessToken}`
              }
            });
            return next(retryReq);
          }),
          catchError(() => throwError(() => error))
        );
      }
      return throwError(() => error);
    })
  );
};
