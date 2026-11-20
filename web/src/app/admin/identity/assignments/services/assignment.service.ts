import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from 'src/environments/environment';
import {
  AssignableRole,
  AssignmentEntity,
  CreateAssignmentPayload,
  CurrentAdmin,
  GroupOption,
  SchoolOption,
  UpdateAssignmentPayload
} from '../models/assignment.model';

@Injectable({
  providedIn: 'root'
})
export class AssignmentService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  /** Current admin with permissions (GET /auth/me). */
  getCurrentAdmin(): Observable<CurrentAdmin> {
    return this.http.get<CurrentAdmin>(`${this.apiUrl}/auth/me`);
  }

  /** Roles the current admin may assign, optionally limited to one school. */
  getAssignableRoles(schoolId?: string): Observable<AssignableRole[]> {
    let params = new HttpParams();
    if (schoolId) {
      params = params.set('schoolId', schoolId);
    }
    return this.http.get<AssignableRole[]>(`${this.apiUrl}/assignments/assignable-roles`, { params });
  }

  /** Schools the admin can see (platform: all, school admin: own school). */
  getSchools(): Observable<SchoolOption[]> {
    const params = new HttpParams().set('limit', '100');
    return this.http
      .get<{ data: SchoolOption[] }>(`${this.apiUrl}/schools`, { params })
      .pipe(map((page) => page.data));
  }

  /** Groups of one school. */
  getGroups(schoolId: string): Observable<GroupOption[]> {
    const params = new HttpParams().set('schoolId', schoolId).set('limit', '100');
    return this.http
      .get<{ data: GroupOption[] }>(`${this.apiUrl}/groups`, { params })
      .pipe(map((page) => page.data));
  }

  createAssignment(payload: CreateAssignmentPayload): Observable<AssignmentEntity> {
    return this.http.post<AssignmentEntity>(`${this.apiUrl}/assignments`, payload);
  }

  updateAssignment(id: string, payload: UpdateAssignmentPayload): Observable<AssignmentEntity> {
    return this.http.patch<AssignmentEntity>(`${this.apiUrl}/assignments/${id}`, payload);
  }

  removeAssignment(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/assignments/${id}`);
  }

  /** Keeps the API's own message (403, 409 "last school admin", 400 validation...). */
  extractErrorMessage(error: unknown, fallback: string = 'An unexpected error occurred'): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as { message?: string | string[] } | null;
      if (body && typeof body === 'object') {
        if (Array.isArray(body.message)) {
          return body.message.join('. ');
        }
        if (typeof body.message === 'string') {
          return body.message;
        }
      }
      if (error.status === 0) {
        return 'Unable to reach API server. Please verify the backend is running.';
      }
    }
    return fallback;
  }
}
