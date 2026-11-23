import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';
import { environment } from 'src/environments/environment';
import {
  CreateSpacePayload,
  SchoolOption,
  PaginatedSpaces,
  SpaceEntity,
  SpaceFormErrors,
  SpaceFormField,
  SpaceListFilter,
  UpdateSpacePayload
} from '../models/space.model';

const FORM_FIELDS: readonly SpaceFormField[] = [
  'schoolId',
  'name',
  'description',
  'language',
  'privacy'
];

/** Largest page `GET /schools` accepts. */
const SCHOOLS_PAGE_SIZE = 100;

/** Calls the document spaces API (#97, #98, #99) for the portal screens (#113). */
@Injectable({
  providedIn: 'root'
})
export class SpaceManagementService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/documents/spaces`;

  /** The spaces the caller may see, alphabetical, one page at a time. */
  getSpaces(filter: SpaceListFilter): Observable<PaginatedSpaces> {
    let params = new HttpParams()
      .set('page', String(filter.page))
      .set('limit', String(filter.limit));
    const search = filter.search?.trim();
    if (search) params = params.set('search', search);
    if (filter.schoolId) params = params.set('schoolId', filter.schoolId);
    return this.http.get<PaginatedSpaces>(this.baseUrl, { params });
  }

  getSpace(id: string): Observable<SpaceEntity> {
    return this.http.get<SpaceEntity>(`${this.baseUrl}/${encodeURIComponent(id)}`);
  }

  createSpace(payload: CreateSpacePayload): Observable<SpaceEntity> {
    return this.http.post<SpaceEntity>(this.baseUrl, payload);
  }

  updateSpace(id: string, payload: UpdateSpacePayload): Observable<SpaceEntity> {
    return this.http.patch<SpaceEntity>(`${this.baseUrl}/${encodeURIComponent(id)}`, payload);
  }

  /**
   * Every school, for the platform admin's school filter and field: `GET /schools` returns at most 100 per
   * page, so the other pages are read too (in parallel).
   */
  getAllSchools(): Observable<SchoolOption[]> {
    const page = (n: number) =>
      this.http.get<{ data: SchoolOption[]; total: number; limit: number; totalPages?: number }>(
        `${environment.apiUrl}/schools`,
        { params: new HttpParams().set('page', String(n)).set('limit', String(SCHOOLS_PAGE_SIZE)) }
      );
    return page(1).pipe(
      switchMap((first) => {
        const pages = first.totalPages || Math.ceil(first.total / first.limit) || 1;
        if (pages <= 1) return of(first.data);
        const rest = Array.from({ length: pages - 1 }, (_, i) => page(i + 2));
        return forkJoin(rest).pipe(map((others) => [first, ...others].flatMap((p) => p.data)));
      })
    );
  }

  /** Soft delete: the API answers 204 and hides the documents of the space with it. */
  deleteSpace(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${encodeURIComponent(id)}`);
  }

  /**
   * Splits an API error into messages for the form fields it is about and one message for the whole
   * form: a 409 is about the name, a 400 message starting with a field name is about that field.
   */
  formErrors(error: unknown): SpaceFormErrors {
    const result: SpaceFormErrors = { fields: {}, general: null };
    const messages = this.messagesOf(error);

    if (error instanceof HttpErrorResponse && error.status === 409) {
      result.fields.name = messages[0] ?? 'A space with this name already exists in this school.';
      return result;
    }
    if (error instanceof HttpErrorResponse && error.status === 400) {
      const unmatched: string[] = [];
      for (const message of messages) {
        const field = FORM_FIELDS.find((f) => message.startsWith(`${f} `));
        if (field && !result.fields[field]) {
          result.fields[field] = capitalize(message);
        } else if (!field) {
          unmatched.push(capitalize(message));
        }
      }
      result.general = unmatched.length > 0 ? unmatched.join('. ') : null;
      return result;
    }
    result.general = this.errorMessage(error, 'The space could not be saved.');
    return result;
  }

  /** A readable message for an error of any spaces call. */
  errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      switch (error.status) {
        case 0:
          return 'Unable to reach the API server. Please check that the backend is running.';
        case 401:
          return 'Your session has expired. Please sign in again.';
        case 403:
          return 'You can only manage the spaces of your own school(s).';
        case 404:
          return 'This space no longer exists. It may have been deleted.';
      }
      const messages = this.messagesOf(error);
      if (messages.length > 0) return messages.map(capitalize).join('. ');
    }
    return fallback;
  }

  private messagesOf(error: unknown): string[] {
    if (!(error instanceof HttpErrorResponse) || !error.error || typeof error.error !== 'object')
      return [];
    const message = (error.error as { message?: unknown }).message;
    if (Array.isArray(message)) return message.filter((m): m is string => typeof m === 'string');
    return typeof message === 'string' ? [message] : [];
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
