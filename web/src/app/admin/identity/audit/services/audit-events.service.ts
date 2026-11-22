import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'src/environments/environment';
import { AuditEventFilter, PaginatedAuditEvents } from '../models/audit.model';

/** Read-only client of the audit trail: there is deliberately no create/update/delete call. */
@Injectable({
  providedIn: 'root'
})
export class AuditEventsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getEvents(filters: Partial<AuditEventFilter> = {}): Observable<PaginatedAuditEvents> {
    let params = new HttpParams()
      .set('page', (filters.page ?? 1).toString())
      .set('limit', (filters.limit ?? 10).toString());

    for (const key of ['from', 'to', 'actorId', 'action', 'schoolId'] as const) {
      const value = filters[key]?.trim();
      if (value) {
        params = params.set(key, value);
      }
    }
    return this.http.get<PaginatedAuditEvents>(`${this.apiUrl}/audit/events`, { params });
  }
}
