import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { of, throwError } from 'rxjs';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';
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
    saveFile: ReturnType<typeof vi.fn>;
    errorMessage: ReturnType<typeof vi.fn>;
  };
  let toast: { error: ReturnType<typeof vi.fn> };

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
      saveFile: vi.fn(),
      errorMessage: vi.fn((e: { message?: string }) => e?.message ?? 'fallback')
    };
    toast = { error: vi.fn() };
    TestBed.configureTestingModule({
      imports: [DocumentVersionsComponent],
      providers: [
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

  it('toasts a failed download', () => {
    service.download.mockReturnValueOnce(throwError(() => ({ message: 'gone' })));
    create();
    component.download(version(2));
    expect(toast.error).toHaveBeenCalledWith('gone');
    expect(service.saveFile).not.toHaveBeenCalled();
  });
});
