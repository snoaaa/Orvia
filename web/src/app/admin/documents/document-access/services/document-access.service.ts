import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'src/environments/environment';
import { AccessOptions, AccessRule, AccessTarget } from '../models/document-access.model';

export type AccessAction = 'load' | 'add' | 'remove';

/**
 * Calls the access APIs of a document (#117): the rules (#109, #110) and the targets it can be published
 * to. Adding uses `POST` and removing uses `DELETE` per rule; `PUT` (replace all) is not needed.
 * The API checks the scope and writes the audit and sync changes.
 */
@Injectable({
  providedIn: 'root'
})
export class DocumentAccessService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/documents`;

  /** The rules of the document, oldest first. */
  list(documentId: string): Observable<AccessRule[]> {
    return this.http.get<AccessRule[]>(`${this.url(documentId)}/access`);
  }

  /** The school, roles, classes and groups the document can be published to. */
  options(documentId: string): Observable<AccessOptions> {
    return this.http.get<AccessOptions>(`${this.url(documentId)}/access/options`);
  }

  /** Publishes to more targets; answers with all the rules of the document. */
  add(documentId: string, rules: AccessTarget[]): Observable<AccessRule[]> {
    return this.http.post<AccessRule[]>(`${this.url(documentId)}/access`, { rules });
  }

  /** Removes one rule (204). */
  remove(documentId: string, ruleId: string): Observable<void> {
    return this.http.delete<void>(`${this.url(documentId)}/access/${encodeURIComponent(ruleId)}`);
  }

  /** The API's reason (400 target outside the school, 403, 404...), or a readable fallback. */
  errorMessage(error: unknown, action: AccessAction): string {
    if (!(error instanceof HttpErrorResponse)) return this.fallback(action);

    const messages = this.messagesOf(error);
    if (messages.length > 0) return messages.map(capitalize).join('. ');

    switch (error.status) {
      case 0:
        return 'Unable to reach the API server. Please check that the backend is running.';
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 403:
        return 'You can only manage the access of the documents of your own school(s).';
      case 404:
        return 'This document or rule no longer exists.';
    }
    return this.fallback(action);
  }

  private fallback(action: AccessAction): string {
    switch (action) {
      case 'load':
        return 'The access rules could not be loaded.';
      case 'add':
        return 'The rule could not be added.';
      case 'remove':
        return 'The rule could not be removed.';
    }
  }

  private url(documentId: string): string {
    return `${this.baseUrl}/${encodeURIComponent(documentId)}`;
  }

  private messagesOf(error: HttpErrorResponse): string[] {
    if (!error.error || typeof error.error !== 'object') return [];
    const message = (error.error as { message?: unknown }).message;
    const list = Array.isArray(message) ? message : [message];
    return list.filter((m): m is string => typeof m === 'string' && m !== '');
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
