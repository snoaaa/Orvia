import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'src/environments/environment';
import { apiErrorMessages, apiErrorStatus, splitFieldMessages } from '../../shared/api-error.util';
import {
  DocumentFormErrors,
  DocumentFormField,
  DocumentListFilter,
  PaginatedDocuments,
  SpaceDocument,
  UpdateDocumentPayload
} from '../models/document.model';

const FORM_FIELDS: readonly DocumentFormField[] = ['title', 'author', 'tags'];

/** Calls the documents API for the document list of a space (#114). */
@Injectable({
  providedIn: 'root'
})
export class SpaceDocumentService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/documents`;

  /** One page of the documents of a space, newest first, with their current version (#111, #112). */
  getDocuments(filter: DocumentListFilter): Observable<PaginatedDocuments> {
    let params = new HttpParams()
      .set('spaceId', filter.spaceId)
      .set('page', String(filter.page))
      .set('limit', String(filter.limit));
    const q = filter.q?.trim();
    if (q) params = params.set('q', q);
    const tags = filter.tags?.trim();
    if (tags) params = params.set('tags', tags);
    if (filter.status) params = params.set('status', filter.status);
    if (filter.type) params = params.set('type', filter.type);
    return this.http.get<PaginatedDocuments>(this.baseUrl, { params });
  }

  updateDocument(id: string, payload: UpdateDocumentPayload): Observable<SpaceDocument> {
    return this.http.patch<SpaceDocument>(`${this.baseUrl}/${encodeURIComponent(id)}`, payload);
  }

  /** Soft delete (#108): the document is no longer listed, downloadable or used in answers. */
  deleteDocument(id: string): Observable<unknown> {
    return this.http.delete(`${this.baseUrl}/${encodeURIComponent(id)}`);
  }

  /**
   * The file of the current version, to show in the browser. Fetched with the session's token (the
   * interceptor adds it), which a plain link to `/stream` would not carry.
   */
  getCurrentFile(id: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${encodeURIComponent(id)}/stream`, {
      responseType: 'blob'
    });
  }

  /** Splits an API error of the metadata form into field messages and a message for the form. */
  formErrors(error: unknown): DocumentFormErrors {
    if (apiErrorStatus(error) === 400) {
      const { fields, unmatched } = splitFieldMessages(apiErrorMessages(error), FORM_FIELDS);
      // "Document title cannot be empty" (the service's own check) is about the title too.
      const rest = unmatched.filter((m) => {
        if (fields.title || !/\btitle\b/i.test(m)) return true;
        fields.title = m;
        return false;
      });
      return { fields, general: rest.length > 0 ? rest.join('. ') : null };
    }
    return { fields: {}, general: this.errorMessage(error, 'The document could not be saved.') };
  }

  /** A readable message for an error of any documents call. */
  errorMessage(error: unknown, fallback: string): string {
    switch (apiErrorStatus(error)) {
      case null:
        return fallback;
      case 0:
        return 'Unable to reach the API server. Please check that the backend is running.';
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 403:
        return 'You can only manage the documents of your own school(s).';
      case 404:
        return 'This document no longer exists. It may have been deleted.';
    }
    const messages = apiErrorMessages(error);
    return messages.length > 0 ? messages.join('. ') : fallback;
  }
}
