import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from 'src/environments/environment';
import {
  AssignmentEntity,
  CreateAssignmentPayload,
  CurrentAdmin,
  GroupOption,
  UpdateAssignmentPayload
} from '../models/assignment.model';

/**
 * Assignment actions of the user-edit screen (#61): create, edit and remove an assignment, and the groups
 * of a school. The assignable roles and the schools come from UserManagementService, which already
 * provides them for the same screen.
 */
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
}
