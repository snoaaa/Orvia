import {
  HttpClient,
  HttpErrorResponse,
  HttpEventType,
  HttpParams
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, filter, forkJoin, map, of, switchMap } from 'rxjs';
import { environment } from 'src/environments/environment';
import { apiErrorMessages } from '../../shared/api-error.util';
import {
  UPLOAD_SPACE_LIMIT,
  UploadEvent,
  UploadMetadata,
  UploadSpacePage,
  UploadedDocument,
  uploadKindOf
} from '../models/upload.model';

/** Calls the document upload API (#102, #103) for the portal upload form (#115). */
@Injectable({
  providedIn: 'root'
})
export class DocumentUploadService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/documents/spaces`;

  /** Every accessible space (fetches remaining pages in parallel when `totalPages > 1`). */
  getSpaces(schoolId?: string): Observable<UploadSpacePage> {
    const fetchPage = (page: number) => {
      let params = new HttpParams()
        .set('page', String(page))
        .set('limit', String(UPLOAD_SPACE_LIMIT));
      if (schoolId) {
        params = params.set('schoolId', schoolId);
      }
      return this.http.get<UploadSpacePage>(this.baseUrl, { params });
    };

    return fetchPage(1).pipe(
      switchMap((first) => {
        const limit = first.limit || UPLOAD_SPACE_LIMIT;
        const pages = first.totalPages ?? (Math.ceil(first.total / limit) || 1);
        if (pages <= 1 || first.data.length >= first.total) {
          return of(first);
        }
        const rest = Array.from({ length: pages - 1 }, (_, i) => fetchPage(i + 2));
        return forkJoin(rest).pipe(
          map((others) => ({
            ...first,
            data: [first, ...others].flatMap((p) => p.data)
          }))
        );
      })
    );
  }

  /**
   * Sends one file to the endpoint that matches its type and reports progress.
   * Emits `progress` events (0 to 100) and then one `done` event with the created document.
   */
  upload(spaceId: string, file: File, metadata: UploadMetadata): Observable<UploadEvent> {
    const endpoint = uploadKindOf(file) === 'image' ? 'upload-image' : 'upload';
    const body = new FormData();
    body.append('file', file, file.name);
    for (const key of ['title', 'author', 'tags'] as const) {
      const value = metadata[key].trim();
      if (value) body.append(key, value);
    }

    return this.http
      .post<UploadedDocument>(`${this.baseUrl}/${encodeURIComponent(spaceId)}/${endpoint}`, body, {
        reportProgress: true,
        observe: 'events'
      })
      .pipe(
        map((event): UploadEvent | null => {
          if (event.type === HttpEventType.UploadProgress) {
            const percent = event.total ? Math.round((100 * event.loaded) / event.total) : 0;
            return { type: 'progress', percent: Math.min(percent, 100) };
          }
          if (event.type === HttpEventType.Response) {
            return { type: 'done', document: event.body as UploadedDocument };
          }
          return null;
        }),
        filter((event): event is UploadEvent => event !== null)
      );
  }

  /** The API's reason for a refused file (type, size, antivirus, duplicate...), or a readable fallback. */
  errorMessage(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'The file could not be uploaded.';

    const messages = apiErrorMessages(error);
    if (messages.length > 0) return messages.join('. ');

    switch (error.status) {
      case 0:
        return 'Unable to reach the API server. Please check that the backend is running.';
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 403:
        return 'You can only upload documents to the spaces of your own school(s).';
      case 404:
        return 'This space no longer exists.';
      case 409:
        return 'This file already exists in the space.';
      case 413:
        return 'The file exceeds the maximum allowed size.';
    }
    return 'The file could not be uploaded.';
  }
}
