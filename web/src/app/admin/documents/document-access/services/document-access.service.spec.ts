import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from 'src/environments/environment';
import { DocumentAccessService } from './document-access.service';

describe('DocumentAccessService', () => {
  let service: DocumentAccessService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/documents/doc-1/access`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DocumentAccessService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the rules and the options', () => {
    service.list('doc-1').subscribe();
    http.expectOne({ method: 'GET', url: base }).flush([]);
    service.options('doc-1').subscribe();
    http.expectOne({ method: 'GET', url: `${base}/options` }).flush({});
  });

  it('adds rules with POST and removes one with DELETE', () => {
    service.add('doc-1', [{ type: 'role', id: 'r1' }]).subscribe();
    const post = http.expectOne({ method: 'POST', url: base });
    expect(post.request.body).toEqual({ rules: [{ type: 'role', id: 'r1' }] });
    post.flush([]);

    service.remove('doc-1', 'rule-1').subscribe();
    http.expectOne({ method: 'DELETE', url: `${base}/rule-1` }).flush(null, { status: 204, statusText: 'No Content' });
  });

  it('uses the API message, else a message per status', () => {
    const err = (status: number, body: unknown) => new HttpErrorResponse({ status, error: body });
    expect(service.errorMessage(err(400, { message: ['target outside school'] }), 'add')).toBe('Target outside school');
    expect(service.errorMessage(err(403, null), 'add')).toContain('your own school');
    expect(service.errorMessage(err(404, null), 'remove')).toContain('no longer exists');
    expect(service.errorMessage(err(500, null), 'remove')).toBe('The rule could not be removed.');
    expect(service.errorMessage(new Error('x'), 'load')).toBe('The access rules could not be loaded.');
  });
});
