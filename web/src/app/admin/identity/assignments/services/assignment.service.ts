import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, expand, map, reduce } from 'rxjs';
import { environment } from 'src/environments/environment';
import {
  AssignmentEntity,
  CreateAssignmentPayload,
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

  /** Groups of one school (all pages). */
  getGroups(schoolId: string): Observable<GroupOption[]> {
    const fetchPage = (page: number) => {
      const params = new HttpParams().set('schoolId', schoolId).set('page', String(page)).set('limit', '100');
      return this.http.get<{ data: GroupOption[]; page?: number; totalPages?: number }>(`${this.apiUrl}/groups`, {
        params
      });
    };

    return fetchPage(1).pipe(
      expand((res) => (res.page && res.totalPages && res.page < res.totalPages ? fetchPage(res.page + 1) : EMPTY)),
      reduce((all, res) => [...all, ...(res.data ?? [])], [] as GroupOption[])
    );
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
