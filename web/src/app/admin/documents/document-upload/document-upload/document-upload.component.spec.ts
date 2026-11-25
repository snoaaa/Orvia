import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { Subject, of, throwError } from 'rxjs';
import { PortalSessionService, PortalSessionUser } from 'src/app/admin/identity/services/portal-session.service';
import { UploadEvent, UploadedDocument } from '../models/upload.model';
import { DocumentUploadService } from '../services/document-upload.service';
import { DocumentUploadComponent } from './document-upload.component';

describe('DocumentUploadComponent', () => {
  let fixture: ComponentFixture<DocumentUploadComponent>;
  let component: DocumentUploadComponent;
  let uploads: { file: File; spaceId: string; subject: Subject<UploadEvent> }[];
  let service: {
    getSpaces: ReturnType<typeof vi.fn>;
    upload: ReturnType<typeof vi.fn>;
    errorMessage: ReturnType<typeof vi.fn>;
  };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let canManage: boolean;
  let queryParams: Record<string, string>;
  let sessionUser: ReturnType<typeof signal<PortalSessionUser | null>>;
  let activeSchoolIdSig: ReturnType<typeof signal<string | null>>;
  let isPlatformSig: ReturnType<typeof signal<boolean>>;
  let showSchoolColSig: ReturnType<typeof signal<boolean>>;
  let schoolsSig: ReturnType<typeof signal<{ id: string; name: string }[]>>;

  const doc = (id: string): UploadedDocument => ({ id, title: id });
  const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' });

  function create(): void {
    fixture = TestBed.createComponent(DocumentUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const statuses = () => component.items().map((i) => i.status);

  beforeEach(() => {
    uploads = [];
    canManage = true;
    queryParams = {};
    service = {
      getSpaces: vi.fn().mockReturnValue(
        of({
          data: [
            { id: 's1', name: 'Maths', schoolId: 'school-1' },
            { id: 's2', name: 'Physics', schoolId: 'school-1' }
          ],
          total: 2
        })
      ),
      upload: vi.fn((spaceId: string, file: File) => {
        const subject = new Subject<UploadEvent>();
        uploads.push({ file, spaceId, subject });
        return subject.asObservable();
      }),
      errorMessage: vi.fn((e: { message?: string }) => e?.message ?? 'fallback')
    };
    toast = { success: vi.fn(), error: vi.fn() };
    sessionUser = signal<PortalSessionUser | null>(null);
    activeSchoolIdSig = signal<string | null>('school-1');
    isPlatformSig = signal(false);
    showSchoolColSig = signal(false);
    schoolsSig = signal([{ id: 'school-1', name: 'School A' }]);

    TestBed.configureTestingModule({
      imports: [DocumentUploadComponent],
      providers: [
        provideRouter([]),
        { provide: DocumentUploadService, useValue: service },
        { provide: GoeyToastService, useValue: toast },
        {
          provide: PortalSessionService,
          useValue: {
            hasPermission: (p: string) => canManage && p === 'documents:manage',
            activePermissions: () => (canManage ? ['documents:manage'] : ['documents:read']),
            user: sessionUser,
            isPlatformAdmin: isPlatformSig,
            showSchoolColumn: showSchoolColSig,
            schools: schoolsSig,
            activeSchoolId: activeSchoolIdSig,
            activeSchoolName: () => 'School A'
          }
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: (k: string) => queryParams[k] ?? null } } }
        }
      ]
    });
  });

  it('hides the form without documents:manage', () => {
    canManage = false;
    create();
    expect(el().querySelector('#upload-no-access')).not.toBeNull();
    expect(el().querySelector('#upload-dropzone')).toBeNull();
    expect(service.getSpaces).not.toHaveBeenCalled();

    component.addFiles([pdf('a.pdf')]);
    expect(component.items()).toHaveLength(0);
  });

  it('loads the spaces and preselects ?spaceId=', () => {
    queryParams = { spaceId: 's2' };
    create();
    expect(service.getSpaces).toHaveBeenCalledOnce();
    expect(el().querySelectorAll('#upload-space option')).toHaveLength(3);
    expect(component.targetSpaceId()).toBe('s2');
  });

  it('shows a retry when the spaces cannot be loaded', () => {
    service.getSpaces.mockReturnValueOnce(throwError(() => ({ message: 'boom' })));
    create();
    expect(el().querySelector('#upload-spaces-error')?.textContent).toContain('boom');
  });

  it('uses the given spaceId without a picker or a spaces call', () => {
    fixture = TestBed.createComponent(DocumentUploadComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('spaceId', 'fixed');
    fixture.detectChanges();

    expect(el().querySelector('#upload-space')).toBeNull();
    expect(service.getSpaces).not.toHaveBeenCalled();
    component.addFiles([pdf('a.pdf')]);
    component.startUpload();
    expect(uploads[0].spaceId).toBe('fixed');
  });

  it('needs a space before uploading and lets a file be removed first', () => {
    create();
    component.addFiles([pdf('a.pdf'), pdf('b.pdf')]);
    fixture.detectChanges();
    expect(component.canStart()).toBe(false);

    component.remove(component.items()[0].id);
    expect(component.items().map((i) => i.file.name)).toEqual(['b.pdf']);

    component.pickedSpaceId.set('s1');
    expect(component.canStart()).toBe(true);
    component.startUpload();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].spaceId).toBe('s1');
  });

  it('sends the metadata typed for each file', () => {
    create();
    component.pickedSpaceId.set('s1');
    component.addFiles([pdf('a.pdf')]);
    const id = component.items()[0].id;
    component.setMetadata(id, 'title', { target: { value: 'My title' } } as unknown as Event);
    component.setMetadata(id, 'tags', { target: { value: 'x,y' } } as unknown as Event);
    component.startUpload();

    const meta = service.upload.mock.calls[0][2] as { title: string; tags: string };
    expect(meta.title).toBe('My title');
    expect(meta.tags).toBe('x,y');
  });

  it('sends at most 3 files at once and starts the next when one finishes', () => {
    create();
    component.pickedSpaceId.set('s1');
    component.addFiles(['1', '2', '3', '4', '5'].map((n) => pdf(`${n}.pdf`)));
    component.startUpload();

    expect(uploads).toHaveLength(3);
    expect(statuses()).toEqual(['uploading', 'uploading', 'uploading', 'queued', 'queued']);

    uploads[0].subject.next({ type: 'progress', percent: 40 });
    fixture.detectChanges();
    expect(component.items()[0].progress).toBe(40);
    expect(el().querySelector('[data-status="uploading"] .progress-bar')?.textContent).toContain(
      '40%'
    );

    uploads[0].subject.next({ type: 'done', document: doc('d1') });
    expect(uploads).toHaveLength(4);
    expect(component.items()[0].status).toBe('done');

    uploads[1].subject.next({ type: 'done', document: doc('d2') });
    expect(uploads).toHaveLength(5);
  });

  it('emits each created document and toasts once the batch is over', () => {
    create();
    const emitted: string[] = [];
    component.uploaded.subscribe((d) => emitted.push(d.id));
    component.pickedSpaceId.set('s1');
    component.addFiles([pdf('a.pdf'), pdf('b.pdf')]);
    component.startUpload();

    uploads[0].subject.next({ type: 'done', document: doc('d1') });
    expect(toast.success).not.toHaveBeenCalled();
    uploads[1].subject.next({ type: 'done', document: doc('d2') });

    expect(emitted).toEqual(['d1', 'd2']);
    expect(toast.success).toHaveBeenCalledWith('2 documents uploaded');
  });

  it("shows the API's reason for a refused file and retries only that file", () => {
    create();
    component.pickedSpaceId.set('s1');
    component.addFiles([pdf('ok.pdf'), pdf('bad.pdf')]);
    component.startUpload();

    uploads[0].subject.next({ type: 'done', document: doc('d1') });
    uploads[1].subject.error({ message: 'File is infected with malware' });
    fixture.detectChanges();

    expect(statuses()).toEqual(['done', 'error']);
    expect(el().querySelector('.upload-error')?.textContent).toContain(
      'File is infected with malware'
    );
    expect(toast.error).toHaveBeenCalled();

    (el().querySelector('.upload-retry') as HTMLButtonElement).click();
    expect(uploads).toHaveLength(3);
    expect(uploads[2].file.name).toBe('bad.pdf');
    expect(component.items()[1].error).toBeNull();

    uploads[2].subject.next({ type: 'done', document: doc('d2') });
    expect(statuses()).toEqual(['done', 'done']);
  });

  it('cancels a file that is removed while uploading', () => {
    create();
    component.pickedSpaceId.set('s1');
    component.addFiles([pdf('a.pdf')]);
    component.startUpload();
    expect(uploads[0].subject.observed).toBe(true);

    component.remove(component.items()[0].id);
    expect(uploads[0].subject.observed).toBe(false);
    expect(component.items()).toHaveLength(0);
  });

  it('adds dropped files and highlights the drop zone', () => {
    create();
    const event = (files: File[]) =>
      ({ preventDefault: vi.fn(), dataTransfer: { files } }) as unknown as DragEvent;

    component.onDragOver(event([]));
    expect(component.isDragging()).toBe(true);
    component.onDrop(event([pdf('dropped.pdf')]));
    expect(component.isDragging()).toBe(false);
    expect(component.items().map((i) => i.file.name)).toEqual(['dropped.pdf']);
  });

  it('clears a stale ?spaceId= not present in writable spaces and hides read-only schools', () => {
    sessionUser.set({
      id: 'u1',
      email: 'u1@x.edu',
      fullName: 'Multi User',
      status: 'ACTIVE',
      role: null,
      permissions: ['documents:manage'],
      schoolIds: ['school-1', 'school-ro'],
      isPlatformAdmin: false,
      assignments: [
        { role: 'STAFF', scope: 'school', schoolId: 'school-1', groupId: null, permissions: ['documents:manage'] },
        { role: 'READER', scope: 'school', schoolId: 'school-ro', groupId: null, permissions: ['documents:read'] }
      ]
    });
    service.getSpaces.mockReturnValue(
      of({
        data: [
          { id: 's1', name: 'Maths', schoolId: 'school-1' },
          { id: 's-ro', name: 'ReadOnly', schoolId: 'school-ro' }
        ],
        total: 2
      })
    );
    queryParams = { spaceId: 's-ro' };
    create();
    expect(component.spaces().map((s) => s.id)).toEqual(['s1']);
    expect(component.pickedSpaceId()).toBeNull();
  });

  it('reloads spaces for multi-school users when activeSchoolId changes and blocks invalid metadata', () => {
    schoolsSig.set([
      { id: 'school-1', name: 'School 1' },
      { id: 'school-2', name: 'School 2' }
    ]);
    showSchoolColSig.set(true);
    create();
    expect(service.getSpaces).toHaveBeenCalledWith('school-1');

    activeSchoolIdSig.set('school-2');
    fixture.detectChanges();
    expect(service.getSpaces).toHaveBeenLastCalledWith('school-2');

    component.pickedSpaceId.set('s1');
    component.addFiles([pdf('a.pdf')]);
    const id = component.items()[0].id;
    component.setMetadata(id, 'tags', {
      target: { value: Array.from({ length: 11 }, (_, i) => `t${i}`).join(',') }
    } as unknown as Event);
    fixture.detectChanges();
    expect(component.canStart()).toBe(false);
    expect(el().querySelector('.upload-meta-error')?.textContent).toContain('At most 10 tags');

    component.setMetadata(id, 'title', { target: { value: 'a'.repeat(192) } } as unknown as Event);
    fixture.detectChanges();
    expect(component.canStart()).toBe(false);
  });
});
