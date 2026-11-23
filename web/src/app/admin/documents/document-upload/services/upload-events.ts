import { HttpEvent, HttpEventType } from '@angular/common/http';
import { OperatorFunction, filter, map } from 'rxjs';
import { UploadEvent, UploadedDocument } from '../models/upload.model';

/**
 * Turns the raw HTTP events of a multipart upload (`reportProgress` + `observe: 'events'`) into
 * `progress` events (0 to 100) and one final `done` event with the created document.
 * Shared by the upload form (#115) and the version replace (#116).
 */
export function toUploadEvents(): OperatorFunction<HttpEvent<UploadedDocument>, UploadEvent> {
  return (source) =>
    source.pipe(
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
