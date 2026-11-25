import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'src/environments/environment';
import { UploadEvent, UploadedDocument } from '../../document-upload/models/upload.model';
import { toUploadEvents } from '../../document-upload/services/upload-events';
import { apiErrorMessages } from '../../shared/api-error.util';
import { DocumentSummary, DocumentVersionItem } from '../models/document-version.model';

export type VersionAction = 'load' | 'download' | 'replace';

/** Calls the version APIs (#107 list, #104 download, #106 replace) for the version history page (#116). */
@Injectable({
  providedIn: 'root'
})
export class DocumentVersionService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/documents`;

  /** The versions of a document, newest first. */
  list(documentId: string): Observable<DocumentVersionItem[]> {
    return this.http.get<DocumentVersionItem[]>(`${this.url(documentId)}/versions`);
  }

  /** The document itself (its title names the downloaded files). */
  getDocument(documentId: string): Observable<DocumentSummary> {
    return this.http.get<DocumentSummary>(this.url(documentId));
  }

  /**
   * The file of one version. Fetched with `HttpClient` (not a link) so the session's token is sent;
   * the caller saves the blob.
   */
  download(documentId: string, versionNumber: number): Observable<Blob> {
    return this.http.get(`${this.url(documentId)}/versions/${versionNumber}/download`, {
      responseType: 'blob'
    });
  }

  /**
   * Uploads a replacement file: the API adds a new version (the old ones are kept).
   * Emits `progress` events (0 to 100) and then one `done` event with the document.
   */
  replace(documentId: string, file: File): Observable<UploadEvent> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http
      .post<UploadedDocument>(`${this.url(documentId)}/replace`, body, {
        reportProgress: true,
        observe: 'events'
      })
      .pipe(toUploadEvents());
  }

  /** Hands a downloaded blob to the browser as a file save. */
  saveFile(blob: Blob, fileName: string): void {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  /** The API's reason for a refused request, or a readable fallback for the action. */
  errorMessage(error: unknown, action: VersionAction): string {
    if (!(error instanceof HttpErrorResponse)) return this.fallback(action);

    // A blob error body (download) is not JSON-parsed; only object bodies carry a message.
    if (!(error.error instanceof Blob)) {
      const messages = apiErrorMessages(error);
      if (messages.length > 0) return messages.join('. ');
    }

    switch (error.status) {
      case 0:
        return 'Unable to reach the API server. Please check that the backend is running.';
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 403:
        return 'You can only manage the documents of your own school(s).';
      case 404:
        return 'This document or version no longer exists.';
      case 413:
        return 'The file exceeds the maximum allowed size.';
    }
    return this.fallback(action);
  }

  private fallback(action: VersionAction): string {
    switch (action) {
      case 'load':
        return 'The version history could not be loaded.';
      case 'download':
        return 'The file could not be downloaded.';
      case 'replace':
        return 'The file could not be uploaded.';
    }
  }

  private url(documentId: string): string {
    return `${this.baseUrl}/${encodeURIComponent(documentId)}`;
  }
}
