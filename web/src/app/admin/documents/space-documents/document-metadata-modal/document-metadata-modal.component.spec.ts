import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SpaceDocument } from '../models/document.model';
import { SpaceDocumentService } from '../services/space-document.service';
import { DocumentMetadataModalComponent } from './document-metadata-modal.component';

const DOC: SpaceDocument = {
  id: 'd1',
  spaceId: 'sp1',
  title: 'Algebra notes',
  author: 'Prof',
  tags: 'math,exam',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
  currentVersion: null
};

describe('DocumentMetadataModalComponent', () => {
  let fixture: ComponentFixture<DocumentMetadataModalComponent>;
  let component: DocumentMetadataModalComponent;
  let documentService: {
    updateDocument: ReturnType<typeof vi.fn>;
    formErrors: ReturnType<typeof vi.fn>;
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  function open(doc: SpaceDocument | null = DOC): void {
    fixture.componentRef.setInput('document', doc);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    documentService = {
      updateDocument: vi.fn().mockImplementation((_id, payload) => of({ ...DOC, ...payload })),
      formErrors: vi.fn()
    };
    await TestBed.configureTestingModule({
      imports: [DocumentMetadataModalComponent],
      providers: [{ provide: SpaceDocumentService, useValue: documentService }]
    }).compileComponents();
    fixture = TestBed.createComponent(DocumentMetadataModalComponent);
    component = fixture.componentInstance;
  });

  it('is closed without a document, and shows its details when given one', () => {
    open(null);
    expect(element().querySelector('.modal')).toBeNull();
    open();
    expect((element().querySelector('#document-title') as HTMLInputElement).value).toBe(
      'Algebra notes'
    );
    expect((element().querySelector('#document-tags') as HTMLInputElement).value).toBe(
      'math, exam'
    );
    expect((element().querySelector('#document-metadata-save') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('sends only the changed fields, trimmed, with the tags normalized', () => {
    open();
    const saved = vi.fn();
    component.saved.subscribe(saved);
    component.form.patchValue({
      title: '  Algebra 2 ',
      author: 'Prof',
      tags: 'math , exam, Math, quiz'
    });
    component.save();

    expect(documentService.updateDocument).toHaveBeenCalledWith('d1', {
      title: 'Algebra 2',
      tags: 'math,exam,quiz'
    });
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ title: 'Algebra 2' }));
  });

  it('does not save without a change, or with invalid fields', () => {
    open();
    component.form.patchValue({ tags: 'exam, math' });
    expect(component.hasChanges()).toBe(true);
    component.form.patchValue({ tags: 'math,  exam' });
    expect(component.hasChanges()).toBe(false);
    component.save();

    component.form.patchValue({ title: '  ', tags: 'a,b,c,d,e,f,g,h,i,j,k' });
    component.save();
    fixture.detectChanges();
    expect(documentService.updateDocument).not.toHaveBeenCalled();
    expect(component.fieldError('title')).toBe('Title is required.');
    expect(component.fieldError('tags')).toBe('At most 10 tags.');
  });

  it('shows API errors on their field and above the form', () => {
    documentService.updateDocument.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 400 }))
    );
    documentService.formErrors.mockReturnValue({
      fields: { title: 'Document title cannot be empty' },
      general: 'Property foo should not exist'
    });
    open();
    component.form.patchValue({ title: 'Other' });
    component.save();
    fixture.detectChanges();

    expect(component.fieldError('title')).toBe('Document title cannot be empty');
    expect(element().querySelector('#document-metadata-error')?.textContent).toContain(
      'Property foo'
    );
    expect(component.isSaving()).toBe(false);
  });

  it('closes with cancel and Escape, not while saving', () => {
    open();
    const cancelled = vi.fn();
    component.cancelled.subscribe(cancelled);
    component.cancel();
    component.onEscape();
    expect(cancelled).toHaveBeenCalledTimes(2);

    component.isSaving.set(true);
    component.cancel();
    expect(cancelled).toHaveBeenCalledTimes(2);
  });

  it('refuses tags longer than the database column in total', () => {
    open();
    const long = Array.from({ length: 5 }, (_, i) => `${i}${'x'.repeat(39)}`).join(', ');
    component.form.patchValue({ tags: long });
    component.save();
    expect(documentService.updateDocument).not.toHaveBeenCalled();
    expect(component.fieldError('tags')).toBe('Tags cannot exceed 191 characters in total.');
  });
});
