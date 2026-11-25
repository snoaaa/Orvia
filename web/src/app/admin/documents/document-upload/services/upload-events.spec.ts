import { HttpEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { UploadEvent } from '../models/upload.model';
import { toUploadEvents } from './upload-events';

describe('toUploadEvents', () => {
  function run(events: unknown[]): UploadEvent[] {
    const out: UploadEvent[] = [];
    of(...(events as HttpEvent<{ id: string; title: string }>[]))
      .pipe(toUploadEvents())
      .subscribe((e) => out.push(e));
    return out;
  }

  it('maps upload progress to a percentage and the response to done', () => {
    const out = run([
      { type: HttpEventType.Sent },
      { type: HttpEventType.UploadProgress, loaded: 50, total: 200 },
      new HttpResponse({ body: { id: 'd1', title: 'a' } })
    ]);
    expect(out).toEqual([
      { type: 'progress', percent: 25 },
      { type: 'done', document: { id: 'd1', title: 'a' } }
    ]);
  });

  it('reports 0 without a total and never exceeds 100', () => {
    const out = run([
      { type: HttpEventType.UploadProgress, loaded: 10 },
      { type: HttpEventType.UploadProgress, loaded: 300, total: 200 }
    ]);
    expect(out).toEqual([
      { type: 'progress', percent: 0 },
      { type: 'progress', percent: 100 }
    ]);
  });
});
