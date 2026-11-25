import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from 'src/environments/environment';
import {
  UploadEvent,
  defaultTitle,
  formatFileSize,
  uploadKindOf
} from '../models/upload.model';
import { DocumentUploadService } from './document-upload.service';

describe('DocumentUploadService', () => {
  let service: DocumentUploadService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiUrl}/documents/spaces`;
  const meta = { title: '', author: '', tags: '' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DocumentUploadService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(DocumentUploadService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads the spaces with limit 100 and merges additional pages', () => {
    let total = 0;
    let names: string[] = [];
    service.getSpaces('school-1').subscribe((page) => {
      total = page.total;
      names = page.data.map((s) => s.name);
    });
    const req1 = httpMock.expectOne((r) => r.url === base && r.params.get('page') === '1');
    expect(req1.request.params.get('limit')).toBe('100');
    expect(req1.request.params.get('schoolId')).toBe('school-1');
    req1.flush({
      data: [{ id: 's1', name: 'First', schoolId: 'school-1' }],
      total: 101,
      limit: 100,
      totalPages: 2
    });
    const req2 = httpMock.expectOne((r) => r.url === base && r.params.get('page') === '2');
    req2.flush({
      data: [{ id: 's2', name: 'Second', schoolId: 'school-1' }],
      total: 101,
      limit: 100,
      totalPages: 2
    });
    expect(total).toBe(101);
    expect(names).toEqual(['First', 'Second']);
  });

  it('sends documents to /upload with the file and the filled metadata only', () => {
    const file = new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' });
    service.upload('space-1', file, { title: ' Notes ', author: '', tags: 'a,b' }).subscribe();

    const req = httpMock.expectOne(`${base}/space-1/upload`);
    const body = req.request.body as FormData;
    expect(req.request.method).toBe('POST');
    expect((body.get('file') as File).name).toBe('notes.pdf');
    expect(body.get('title')).toBe('Notes');
    expect(body.get('tags')).toBe('a,b');
    expect(body.has('author')).toBe(false);
    expect(req.request.reportProgress).toBe(true);
    req.flush({ id: 'd1', title: 'Notes' });
  });

  it('sends images to /upload-image', () => {
    const file = new File(['x'], 'photo.HEIC');
    service.upload('space-1', file, meta).subscribe();
    httpMock.expectOne(`${base}/space-1/upload-image`).flush({ id: 'd2', title: 'photo' });
  });

  it('emits progress then done', () => {
    const events: UploadEvent[] = [];
    service.upload('s', new File(['x'], 'a.pdf'), meta).subscribe((e) => events.push(e));
    const req = httpMock.expectOne(`${base}/s/upload`);
    req.event({ type: 1, loaded: 50, total: 200 } as never);
    req.flush({ id: 'd3', title: 'a' });

    expect(events[0]).toEqual({ type: 'progress', percent: 25 });
    expect(events[events.length - 1]).toEqual({
      type: 'done',
      document: { id: 'd3', title: 'a' }
    });
  });

  describe('errorMessage', () => {
    const http = (status: number, body: unknown) =>
      new HttpErrorResponse({ status, error: body });

    it("shows the API's reason", () => {
      expect(service.errorMessage(http(400, { message: 'file is infected' }))).toBe(
        'File is infected'
      );
      expect(service.errorMessage(http(409, { message: ['duplicate file', 'again'] }))).toBe(
        'Duplicate file. Again'
      );
    });

    it('falls back to a readable message per status', () => {
      expect(service.errorMessage(http(0, null))).toContain('Unable to reach');
      expect(service.errorMessage(http(413, null))).toContain('maximum');
      expect(service.errorMessage(http(409, null))).toContain('already exists');
      expect(service.errorMessage(new Error('x'))).toBe('The file could not be uploaded.');
    });
  });
});

describe('upload model helpers', () => {
  it('picks the endpoint from the file type', () => {
    expect(uploadKindOf({ name: 'a.pdf' })).toBe('document');
    expect(uploadKindOf({ name: 'a.PNG' })).toBe('image');
    expect(uploadKindOf({ name: 'noext', type: 'image/jpeg' })).toBe('image');
    expect(uploadKindOf({ name: 'a.exe' })).toBe('document');
  });

  it('formats sizes and default titles', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(defaultTitle('my.notes.pdf')).toBe('my.notes');
    expect(defaultTitle('.hidden')).toBe('.hidden');
  });
});
