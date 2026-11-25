import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { Subject, of, throwError } from 'rxjs';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';
import { UploadEvent } from '../../document-upload/models/upload.model';
import { DocumentVersionItem } from '../models/document-version.model';
import { DocumentVersionService } from '../services/document-version.service';
import { DocumentVersionsComponent } from './document-versions.component';

describe('DocumentVersionsComponent', () => {
  let fixture: ComponentFixture<DocumentVersionsComponent>;
  let component: DocumentVersionsComponent;
  let canManage: boolean;
  let service: {
    list: ReturnType<typeof vi.fn>;
    getDocument: ReturnType<typeof vi.fn>;
    download: ReturnType<typeof vi.fn>;
    replace: ReturnType<typeof vi.fn>;
    saveFile: ReturnType<typeof vi.fn>;
    errorMessage: ReturnType<typeof vi.fn>;
  };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  const version = (n: number, isCurrent = false): DocumentVersionItem => ({
    id: `v${n}`,
    documentId: 'doc-1',
    versionNumber: n,
    date: '2026-01-02T10:00:00.000Z',
    uploader: { id: 'u1', name: 'Ada', email: 'ada@x.io' },
    size: 2048,
    status: 'available',
    mimeType: 'application/pdf',
    isCurrent
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  function create(): void {
    fixture = TestBed.createComponent(DocumentVersionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    canManage = true;
    service = {
      list: vi.fn().mockReturnValue(of([version(1), version(2, true)])),
      getDocument: vi.fn().mockReturnValue(of({ id: 'doc-1', title: 'Notes' })),
      download: vi.fn().mockReturnValue(of(new Blob(['x']))),
      replace: vi.fn(),
      saveFile: vi.fn(),
      errorMessage: vi.fn((e: { message?: string }) => e?.message ?? 'fallback')
    };
    toast = { success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      imports: [DocumentVersionsComponent],
      providers: [
        provideRouter([]),
        { provide: DocumentVersionService, useValue: service },
        { provide: GoeyToastService, useValue: toast },
        {
          provide: PortalSessionService,
          useValue: { hasPermission: (p: string) => canManage && p === 'documents:manage' }
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'doc-1' } } }
        }
      ]
    });
  });

  it('hides the page without documents:manage', () => {
    canManage = false;
    create();
    expect(el().querySelector('#versions-no-access')).not.toBeNull();
    expect(service.list).not.toHaveBeenCalled();
  });

  it('lists versions newest first and marks the current one', () => {
    create();
    const rows = el().querySelectorAll('#versions-list tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('v2');
    expect(rows[0].textContent).toContain('Current');
    expect(rows[1].textContent).toContain('v1');
    expect(component.heading()).toBe('Version history - Notes');
  });

  it('shows a retry when the list cannot be loaded', () => {
    service.list.mockReturnValueOnce(throwError(() => ({ message: 'boom' })));
    create();
    expect(el().querySelector('#versions-error')?.textContent).toContain('boom');
    (el().querySelector('#versions-error button') as HTMLButtonElement).click();
    expect(service.list).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state', () => {
    service.list.mockReturnValueOnce(of([]));
    create();
    expect(el().querySelector('#versions-empty')).not.toBeNull();
  });

  it('downloads a version under a name built from title and number', () => {
    create();
    (el().querySelectorAll('.version-download')[1] as HTMLButtonElement).click();
    expect(service.download).toHaveBeenCalledWith('doc-1', 1);
    expect(service.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'Notes-v1.pdf');
    expect(component.downloading()).toBeNull();
  });

  describe('replace', () => {
    const pick = (file: File): void => {
      const input = el().querySelector('#replace-file-input') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    const pdf = new File(['%PDF'], 'v3.pdf', { type: 'application/pdf' });

    it('shows progress, then reloads the list and toasts on success', () => {
      const events = new Subject<UploadEvent>();
      service.replace.mockReturnValue(events.asObservable());
      create();

      pick(pdf);
      expect(service.replace).toHaveBeenCalledWith('doc-1', pdf);
      events.next({ type: 'progress', percent: 40 });
      fixture.detectChanges();
      expect(el().querySelector('#replace-progress')?.textContent).toContain('40%');

      events.next({ type: 'done', document: { id: 'doc-1', title: 'Notes' } });
      fixture.detectChanges();
      expect(component.replacing()).toBe(false);
      expect(toast.success).toHaveBeenCalledWith('New version uploaded');
      expect(service.list).toHaveBeenCalledTimes(2);
    });

    it('shows the API reason when the replacement is refused', () => {
      service.replace.mockReturnValue(throwError(() => ({ message: 'file is infected' })));
      create();
      pick(pdf);
      expect(el().querySelector('#replace-error')?.textContent).toContain('file is infected');
      expect(component.replacing()).toBe(false);
      expect(service.list).toHaveBeenCalledTimes(1);
    });
  });

  it('toasts a failed download', () => {
    service.download.mockReturnValueOnce(throwError(() => ({ message: 'gone' })));
    create();
    component.download(version(2));
    expect(toast.error).toHaveBeenCalledWith('gone');
    expect(service.saveFile).not.toHaveBeenCalled();
  });

  it('redirects to /admin/spaces on 403/404 when loading', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    service.list.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403 })));
    create();
    expect(navSpy).toHaveBeenCalledWith(['/admin/spaces']);
  });

  it('shows statusError on failed versions and reloads when route paramMap emits', () => {
    const paramMap$ = new Subject<ReturnType<typeof convertToParamMap>>();
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: { paramMap: convertToParamMap({ documentId: 'doc-1' }) },
        paramMap: paramMap$.asObservable()
      }
    });
    service.list.mockReturnValue(
      of([{ ...version(1), status: 'error', statusError: 'OCR timeout' }])
    );
    service.getDocument.mockReturnValue(of({ id: 'doc-1', title: 'Notes', spaceId: 'sp-9' }));
    create();

    paramMap$.next(convertToParamMap({ documentId: 'doc-1' }));
    fixture.detectChanges();
    expect(el().querySelector('.version-status-error')?.textContent).toContain('OCR timeout');
    expect((el().querySelector('#versions-back-documents') as HTMLAnchorElement)?.getAttribute('href')).toContain(
      '/admin/spaces/sp-9/documents'
    );

    paramMap$.next(convertToParamMap({ documentId: 'doc-2' }));
    expect(service.list).toHaveBeenCalledWith('doc-2');
  });
});
