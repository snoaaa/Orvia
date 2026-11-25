import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from 'src/environments/environment';
import {
  documentStatusOption,
  documentTypeLabel,
  documentTypeOf,
  tagList
} from '../models/document.model';
import { SpaceDocumentService } from './space-document.service';

describe('SpaceDocumentService', () => {
  let service: SpaceDocumentService;
  let http: HttpTestingController;
  const url = `${environment.apiUrl}/documents`;

  const httpError = (status: number, message?: string | string[]) =>
    new HttpErrorResponse({
      status,
      error: message === undefined ? null : { statusCode: status, message }
    });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SpaceDocumentService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(SpaceDocumentService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists one space with every filter', () => {
    service
      .getDocuments({
        spaceId: 'sp1',
        page: 2,
        limit: 25,
        q: ' algebra ',
        tags: ' math,exam ',
        status: 'error',
        type: 'pdf'
      })
      .subscribe();
    const req = http.expectOne((r) => r.url === url);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().sort()).toEqual([
      'limit',
      'page',
      'q',
      'spaceId',
      'status',
      'tags',
      'type'
    ]);
    expect(req.request.params.get('spaceId')).toBe('sp1');
    expect(req.request.params.get('q')).toBe('algebra');
    expect(req.request.params.get('tags')).toBe('math,exam');
    expect(req.request.params.get('status')).toBe('error');
    expect(req.request.params.get('type')).toBe('pdf');
    req.flush({ data: [], total: 0, page: 2, limit: 25 });
  });

  it('leaves out empty filters', () => {
    service.getDocuments({ spaceId: 'sp1', page: 1, limit: 10, q: '  ', tags: '' }).subscribe();
    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.keys().sort()).toEqual(['limit', 'page', 'spaceId']);
    req.flush({ data: [], total: 0, page: 1, limit: 10 });
  });

  it('updates, deletes and fetches the current file', () => {
    service.updateDocument('d1', { title: 'New' }).subscribe();
    const patch = http.expectOne({ method: 'PATCH', url: `${url}/d1` });
    expect(patch.request.body).toEqual({ title: 'New' });
    patch.flush({});

    service.deleteDocument('d1').subscribe();
    http.expectOne({ method: 'DELETE', url: `${url}/d1` }).flush({});

    service.getCurrentFile('d1').subscribe();
    const stream = http.expectOne({ method: 'GET', url: `${url}/d1/stream` });
    expect(stream.request.responseType).toBe('blob');
    stream.flush(new Blob(['%PDF']));
  });

  describe('formErrors', () => {
    it('puts validation messages on their fields, title checks included', () => {
      expect(service.formErrors(httpError(400, 'Document title cannot be empty'))).toEqual({
        fields: { title: 'Document title cannot be empty' },
        general: null
      });
      expect(
        service.formErrors(
          httpError(400, ['author must be a string', 'property foo should not exist'])
        )
      ).toEqual({
        fields: { author: 'Author must be a string' },
        general: 'Property foo should not exist'
      });
    });

    it('gives a form message for other errors', () => {
      expect(service.formErrors(httpError(403)).general).toBe(
        'You can only manage the documents of your own school(s).'
      );
      expect(service.formErrors(httpError(404)).general).toContain('no longer exists');
      expect(service.formErrors(httpError(500, 'database down')).general).toBe('Database down');
    });
  });

  describe('model helpers', () => {
    it('names the type of a MIME type like the API filter', () => {
      expect(documentTypeOf('application/pdf')).toBe('pdf');
      expect(documentTypeOf('image/heic')).toBe('image');
      expect(documentTypeOf('text/csv')).toBe('spreadsheet');
      expect(documentTypeOf('application/zip')).toBeNull();
      expect(
        documentTypeLabel('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      ).toBe('Word');
      expect(documentTypeLabel('application/zip')).toBe('application/zip');
      expect(documentTypeLabel(undefined)).toBe('—');
    });

    it('labels statuses and splits tags', () => {
      expect(documentStatusOption('ocr')?.label).toBe('OCR');
      expect(documentStatusOption('unknown')).toBeUndefined();
      expect(tagList('math, exam,,')).toEqual(['math', 'exam']);
      expect(tagList('')).toEqual([]);
    });
  });
});
