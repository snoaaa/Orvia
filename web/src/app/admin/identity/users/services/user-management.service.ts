import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import { environment } from 'src/environments/environment';
import { ActiveSession, PaginatedUsers, UpdateUserPayload, UserEntity, UserListFilter } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class UserManagementService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  /**
   * Fetches paginated users with optional search and filters.
   */
  getUsers(filters: Partial<UserListFilter> = {}): Observable<PaginatedUsers> {
    let params = new HttpParams()
      .set('page', (filters.page ?? 1).toString())
      .set('limit', (filters.limit ?? 10).toString());

    if (filters.status && filters.status !== 'ALL') {
      params = params.set('status', filters.status.toUpperCase());
    }
    if (filters.search && filters.search.trim()) {
      params = params.set('search', filters.search.trim());
    }
    if (filters.sortBy) {
      params = params.set('sortBy', filters.sortBy);
    }
    if (filters.sortOrder) {
      params = params.set('sortOrder', filters.sortOrder);
    }

    return this.http.get<PaginatedUsers>(`${this.apiUrl}/identity/users`, { params }).pipe(
      catchError((error) => {
        return throwError(() => error);
      })
    );
  }

  /**
   * Fetches a single user by ID.
   */
  getUserById(id: string): Observable<UserEntity> {
    return this.http.get<UserEntity>(`${this.apiUrl}/identity/users/${id}`).pipe(
      catchError((error) => {
        return throwError(() => error);
      })
    );
  }

  /**
   * Updates user profile fields (e.g. fullName, email, status).
   */
  updateUser(id: string, payload: UpdateUserPayload): Observable<UserEntity> {
    return this.http.patch<UserEntity>(`${this.apiUrl}/identity/users/${id}`, payload).pipe(
      catchError((error) => {
        return throwError(() => error);
      })
    );
  }

  /**
   * Suspends a user account and immediately revokes all their active sessions.
   */
  suspendUser(id: string): Observable<UserEntity> {
    return this.updateUser(id, { status: 'SUSPENDED' });
  }

  /**
   * Reactivates a suspended user account.
   */
  reactivateUser(id: string): Observable<UserEntity> {
    return this.updateUser(id, { status: 'ACTIVE' });
  }

  /**
   * Fetches the user's active sessions and registered devices.
   */
  getUserSessions(userId: string): Observable<ActiveSession[]> {
    return this.http.get<ActiveSession[]>(`${this.apiUrl}/identity/users/${userId}/sessions`).pipe(
      catchError((error) => {
        return throwError(() => error);
      })
    );
  }

  /**
   * Revokes a single session for the specified user.
   */
  revokeSession(userId: string, sessionId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/identity/users/${userId}/sessions/${sessionId}`).pipe(
      catchError((error) => {
        return throwError(() => error);
      })
    );
  }

  /**
   * Revokes all active sessions for the specified user (e.g. account compromised).
   */
  revokeAllSessions(userId: string): Observable<{ revoked: number }> {
    return this.http.delete<{ revoked: number }>(`${this.apiUrl}/identity/users/${userId}/sessions`).pipe(
      catchError((error) => {
        return throwError(() => error);
      })
    );
  }

  /**
   * Extracts clean, human-readable error messages from NestJS backend responses.
   */
  extractErrorMessage(error: unknown, fallback: string = 'An unexpected error occurred'): string {
    if (error instanceof HttpErrorResponse) {
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
      if (error.status === 401) {
        return 'Authentication required. Please sign in to access user management.';
      }
      if (error.status === 403) {
        return 'Permission denied: You do not have sufficient rights or school scope for this action.';
      }
      if (error.status === 404) {
        return 'The requested resource was not found.';
      }
      if (error.status === 409) {
        return 'Conflict: An account with this email address already exists.';
      }
      if (error.status === 0) {
        return 'Unable to reach API server. Please verify the backend is running.';
      }
    }
    return fallback;
  }
}

