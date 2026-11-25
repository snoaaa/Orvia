import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from 'src/environments/environment';
import { UploadEvent } from '../../document-upload/models/upload.model';
import {
  extensionOfMime,
  statusDisplay,
  versionFileName
} from '../models/document-version.model';
import { DocumentVersionService } from './document-version.service';

describe('DocumentVersionService', () => {
  let service: DocumentVersionService;
  let httpMock: HttpTestingController;
  const base = `${environment.apiUrl}/documents/doc-1`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DocumentVersionService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(DocumentVersionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists the versions of a document', () => {
    let count = 0;
    service.list('doc-1').subscribe((v) => (count = v.length));
    const req = httpMock.expectOne(`${base}/versions`);
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 'v2' }, { id: 'v1' }]);
    expect(count).toBe(2);
  });

  it('loads the document', () => {
    service.getDocument('doc-1').subscribe();
    httpMock.expectOne(base).flush({ id: 'doc-1', title: 'Notes' });
  });

  it('downloads a version as a blob by its number', () => {
    let blob: Blob | null = null;
    service.download('doc-1', 2).subscribe((b) => (blob = b));
    const req = httpMock.expectOne(`${base}/versions/2/download`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['%PDF']));
    expect(blob).toBeInstanceOf(Blob);
  });

  it('replaces with a multipart "file" field and reports progress then done', () => {
    const events: UploadEvent[] = [];
    const file = new File(['%PDF'], 'v2.pdf', { type: 'application/pdf' });
    service.replace('doc-1', file).subscribe((e) => events.push(e));

    const req = httpMock.expectOne(`${base}/replace`);
    expect(req.request.method).toBe('POST');
    expect((req.request.body as FormData).get('file')).toBeInstanceOf(File);
    expect(req.request.reportProgress).toBe(true);
    req.event({ type: 1, loaded: 1, total: 4 } as never);
    req.flush({ id: 'doc-1', title: 'Notes' });

    expect(events[0]).toEqual({ type: 'progress', percent: 25 });
    expect(events[events.length - 1]).toEqual({
      type: 'done',
      document: { id: 'doc-1', title: 'Notes' }
    });
  });

  it('saves a blob through a temporary link', () => {
    const create = vi.fn().mockReturnValue('blob:x');
    const revoke = vi.fn();
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    service.saveFile(new Blob(['x']), 'Notes-v1.pdf');

    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:x');
    click.mockRestore();
    URL.createObjectURL = original.createObjectURL;
    URL.revokeObjectURL = original.revokeObjectURL;
  });

  describe('errorMessage', () => {
    const http = (status: number, body: unknown) =>
      new HttpErrorResponse({ status, error: body });

    it("shows the API's reason", () => {
      expect(service.errorMessage(http(400, { message: 'file is infected' }), 'replace')).toBe(
        'File is infected'
      );
    });

    it('falls back per status and per action', () => {
      expect(service.errorMessage(http(0, null), 'load')).toContain('Unable to reach');
      expect(service.errorMessage(http(403, null), 'load')).toContain('own school');
      expect(service.errorMessage(http(404, null), 'download')).toContain('no longer exists');
      expect(service.errorMessage(http(500, new Blob(['x'])), 'download')).toBe(
        'The file could not be downloaded.'
      );
      expect(service.errorMessage(http(500, null), 'load')).toBe(
        'The version history could not be loaded.'
      );
      expect(service.errorMessage(new Error('x'), 'replace')).toBe(
        'The file could not be uploaded.'
      );
    });
  });
});

describe('version model helpers', () => {
  it('names a downloaded version from the title, number and type', () => {
    expect(versionFileName('Notes', 2, 'application/pdf')).toBe('Notes-v2.pdf');
    expect(versionFileName('a/b:c', 1, 'image/png')).toBe('a_b_c-v1.png');
    expect(versionFileName('  ', 3, 'application/x-unknown')).toBe('document-v3');
  });

  it('maps MIME types to extensions', () => {
    expect(extensionOfMime('Application/PDF')).toBe('pdf');
    expect(extensionOfMime('nope/nope')).toBe('');
  });

  it('shows known statuses and passes unknown ones through', () => {
    expect(statusDisplay('available').label).toBe('Available');
    expect(statusDisplay('weird').label).toBe('weird');
  });
});
