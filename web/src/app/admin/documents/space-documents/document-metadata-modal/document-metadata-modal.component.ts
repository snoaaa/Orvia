import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  computed,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { maxTags, notBlank, trimmedMaxLength } from '../../shared/form-validators';
import {
  DOCUMENT_MAX_TAGS,
  DOCUMENT_TEXT_MAX_LENGTH,
  DocumentFormField,
  SpaceDocument,
  UpdateDocumentPayload,
  tagList
} from '../models/document.model';
import { SpaceDocumentService } from '../services/space-document.service';

const FIELD_LABELS: Record<DocumentFormField, string> = {
  title: 'Title',
  author: 'Author',
  tags: 'Tags'
};

/** Normalizes a tag list the way the API stores it: trimmed, no empty ones, each kept once. */
function normalizeTags(raw: string): string {
  const seen = new Set<string>();
  return tagList(raw)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(',');
}

/**
 * Dialog to edit the title, author and tags of a document (#114, `PATCH /documents/{id}`).
 * Open it by setting `document`; it emits `saved` with the updated document or `cancelled`.
 */
@Component({
  selector: 'app-document-metadata-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './document-metadata-modal.component.html',
  styleUrls: ['./document-metadata-modal.component.scss']
})
export class DocumentMetadataModalComponent implements OnChanges {
  private readonly fb = inject(FormBuilder);
  private readonly documentService = inject(SpaceDocumentService);

  @Input() document: SpaceDocument | null = null;
  @Output() saved = new EventEmitter<SpaceDocument>();
  @Output() cancelled = new EventEmitter<void>();

  readonly maxLength = DOCUMENT_TEXT_MAX_LENGTH;
  readonly maxTags = DOCUMENT_MAX_TAGS;
  readonly isSaving = signal(false);
  readonly generalError = signal<string | null>(null);
  private readonly original = signal<SpaceDocument | null>(null);

  readonly form = this.fb.nonNullable.group({
    title: ['', [notBlank, trimmedMaxLength(DOCUMENT_TEXT_MAX_LENGTH)]],
    author: ['', trimmedMaxLength(DOCUMENT_TEXT_MAX_LENGTH)],
    tags: ['', maxTags(DOCUMENT_MAX_TAGS)]
  });

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  /** The fields that differ from the document (what PATCH sends). */
  readonly changes = computed<UpdateDocumentPayload>(() => {
    const doc = this.original();
    const value = this.formValue();
    if (!doc) return {};
    const changes: UpdateDocumentPayload = {};
    const title = (value.title ?? '').trim();
    const author = (value.author ?? '').trim();
    const tags = normalizeTags(value.tags ?? '');
    if (title !== doc.title) changes.title = title;
    if (author !== (doc.author ?? '')) changes.author = author;
    if (tags !== normalizeTags(doc.tags ?? '')) changes.tags = tags;
    return changes;
  });

  readonly hasChanges = computed(() => Object.keys(this.changes()).length > 0);

  ngOnChanges(): void {
    this.original.set(this.document);
    this.generalError.set(null);
    this.isSaving.set(false);
    if (this.document) {
      this.form.reset({
        title: this.document.title,
        author: this.document.author ?? '',
        tags: tagList(this.document.tags).join(', ')
      });
    }
  }

  /** The message to show under a field, once the user has touched it or tried to save. */
  fieldError(field: DocumentFormField): string | null {
    const control = this.form.controls[field];
    if (!control.errors || !(control.touched || control.dirty)) return null;
    const errors = control.errors;
    if (errors['server']) return errors['server'] as string;
    if (errors['required']) return `${FIELD_LABELS[field]} is required.`;
    if (errors['maxlength']) {
      return `${FIELD_LABELS[field]} cannot exceed ${errors['maxlength'].requiredLength} characters.`;
    }
    if (errors['maxTags']) return `At most ${errors['maxTags'].max} tags.`;
    return `${FIELD_LABELS[field]} is not valid.`;
  }

  save(): void {
    const doc = this.original();
    if (!doc || this.isSaving()) return;
    this.generalError.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid || !this.hasChanges()) return;

    this.isSaving.set(true);
    this.documentService.updateDocument(doc.id, this.changes()).subscribe({
      next: (updated) => {
        this.isSaving.set(false);
        this.saved.emit(updated);
      },
      error: (error) => {
        this.isSaving.set(false);
        const { fields, general } = this.documentService.formErrors(error);
        for (const [field, message] of Object.entries(fields) as [DocumentFormField, string][]) {
          const control = this.form.controls[field];
          control.setErrors({ ...control.errors, server: message });
          control.markAsTouched();
        }
        this.generalError.set(general);
      }
    });
  }

  cancel(): void {
    if (!this.isSaving()) this.cancelled.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.document) this.cancel();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal')) this.cancel();
  }
}
