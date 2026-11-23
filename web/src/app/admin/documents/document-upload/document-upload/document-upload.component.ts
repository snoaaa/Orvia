import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { Subscription } from 'rxjs';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';
import { CardComponent } from 'src/app/admin/theme/shared/components/card/card.component';
import {
  UPLOAD_ACCEPT,
  UPLOAD_AUTHOR_MAX_LENGTH,
  UPLOAD_CONCURRENCY,
  UPLOAD_SPACE_LIMIT,
  UPLOAD_TAGS_MAX_LENGTH,
  UPLOAD_TITLE_MAX_LENGTH,
  UploadItem,
  UploadMetadata,
  UploadSpace,
  UploadedDocument,
  defaultTitle,
  formatFileSize
} from '../models/upload.model';
import { DocumentUploadService } from '../services/document-upload.service';

/**
 * Upload form of the documents area (#115, §4.1): drag-and-drop or pick several PDFs/images,
 * fill optional metadata, and send them to a space with per-file progress and errors.
 *
 * Reusable: give it `spaceId` and it hides the space picker (e.g. to embed it in a space page).
 * Used as a page, it reads an optional `?spaceId=` query parameter.
 */
@Component({
  selector: 'app-document-upload',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent],
  templateUrl: './document-upload.component.html',
  styleUrls: ['./document-upload.component.scss']
})
export class DocumentUploadComponent implements OnInit {
  private readonly uploadService = inject(DocumentUploadService);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly toast = inject(GoeyToastService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  readonly session = inject(PortalSessionService);

  /** Fixed target space; when set, the space picker is hidden. */
  readonly spaceId = input<string | null>(null);
  /** Emits each document created by the API. */
  readonly uploaded = output<UploadedDocument>();

  readonly accept = UPLOAD_ACCEPT;
  readonly titleMax = UPLOAD_TITLE_MAX_LENGTH;
  readonly authorMax = UPLOAD_AUTHOR_MAX_LENGTH;
  readonly tagsMax = UPLOAD_TAGS_MAX_LENGTH;
  readonly spaceLimit = UPLOAD_SPACE_LIMIT;
  readonly formatFileSize = formatFileSize;
  readonly defaultTitle = defaultTitle;

  readonly spaces = signal<UploadSpace[]>([]);
  readonly spacesTotal = signal(0);
  readonly spacesLoading = signal(false);
  readonly spacesError = signal<string | null>(null);
  readonly pickedSpaceId = signal<string | null>(null);
  readonly items = signal<UploadItem[]>([]);
  readonly isDragging = signal(false);

  /** Documents may be uploaded only with the `documents:manage` permission. */
  readonly canUpload = computed(() => this.session.hasPermission('documents:manage'));
  readonly targetSpaceId = computed(() => this.spaceId() ?? this.pickedSpaceId());
  readonly showPicker = computed(() => !this.spaceId());

  readonly readyCount = computed(() => this.items().filter((i) => i.status === 'ready').length);
  readonly failedCount = computed(() => this.items().filter((i) => i.status === 'error').length);
  readonly finishedCount = computed(
    () => this.items().filter((i) => i.status === 'done' || i.status === 'error').length
  );
  readonly isBusy = computed(() =>
    this.items().some((i) => i.status === 'queued' || i.status === 'uploading')
  );
  readonly canStart = computed(
    () => this.readyCount() > 0 && this.targetSpaceId() !== null && !this.spacesLoading()
  );

  private nextId = 1;
  private readonly running = new Map<number, Subscription>();
  /** Counts of the current batch, for the final toast. */
  private batchDone = 0;
  private batchFailed = 0;

  constructor() {
    this.destroyRef.onDestroy(() => this.running.forEach((sub) => sub.unsubscribe()));
  }

  ngOnInit(): void {
    if (!this.canUpload()) return;
    if (this.showPicker()) {
      const fromQuery = this.route?.snapshot?.queryParamMap?.get('spaceId');
      if (fromQuery) this.pickedSpaceId.set(fromQuery);
      this.loadSpaces();
    }
  }

  loadSpaces(): void {
    this.spacesLoading.set(true);
    this.spacesError.set(null);
    this.uploadService.getSpaces().subscribe({
      next: (page) => {
        this.spaces.set(page.data);
        this.spacesTotal.set(page.total);
        this.spacesLoading.set(false);
      },
      error: (error: unknown) => {
        this.spacesError.set(this.uploadService.errorMessage(error));
        this.spacesLoading.set(false);
      }
    });
  }

  onSpaceChange(event: Event): void {
    this.pickedSpaceId.set((event.target as HTMLSelectElement).value || null);
  }

  // ----- adding / removing files -----

  onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  addFiles(files: File[]): void {
    if (!this.canUpload() || files.length === 0) return;
    const rows: UploadItem[] = files.map((file) => ({
      id: this.nextId++,
      file,
      title: '',
      author: '',
      tags: '',
      status: 'ready',
      progress: 0,
      error: null
    }));
    this.items.update((list) => [...list, ...rows]);
  }

  /** Removes a file from the list; a file being sent is cancelled. */
  remove(id: number): void {
    this.running.get(id)?.unsubscribe();
    this.running.delete(id);
    this.items.update((list) => list.filter((i) => i.id !== id));
    this.pump();
  }

  clearFinished(): void {
    this.items.update((list) => list.filter((i) => i.status !== 'done'));
  }

  setMetadata(id: number, field: keyof UploadMetadata, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.patch(id, { [field]: value });
  }

  // ----- uploading -----

  /** Queues every file that was added and starts sending them. */
  startUpload(): void {
    if (!this.canStart()) return;
    this.items.update((list) =>
      list.map((i) => (i.status === 'ready' ? { ...i, status: 'queued' as const } : i))
    );
    this.pump();
  }

  /** Sends a failed file again. */
  retry(id: number): void {
    if (this.targetSpaceId() === null) return;
    this.patch(id, { status: 'queued', progress: 0, error: null });
    this.pump();
  }

  /** Starts queued files while fewer than `UPLOAD_CONCURRENCY` are in flight. */
  private pump(): void {
    const spaceId = this.targetSpaceId();
    if (spaceId === null) return;

    let inFlight = this.items().filter((i) => i.status === 'uploading').length;
    for (const item of this.items().filter((i) => i.status === 'queued')) {
      if (inFlight >= UPLOAD_CONCURRENCY) break;
      inFlight++;
      this.send(spaceId, item);
    }

    if (!this.isBusy() && this.batchDone + this.batchFailed > 0) this.announceBatch();
  }

  private send(spaceId: string, item: UploadItem): void {
    this.patch(item.id, { status: 'uploading', progress: 0, error: null });

    const sub = this.uploadService.upload(spaceId, item.file, item).subscribe({
      next: (event) => {
        if (event.type === 'progress') {
          this.patch(item.id, { progress: event.percent });
        } else {
          this.running.delete(item.id);
          this.patch(item.id, { status: 'done', progress: 100 });
          this.batchDone++;
          this.uploaded.emit(event.document);
          this.pump();
        }
      },
      error: (error: unknown) => {
        this.running.delete(item.id);
        this.patch(item.id, {
          status: 'error',
          error: this.uploadService.errorMessage(error)
        });
        this.batchFailed++;
        this.pump();
      }
    });
    this.running.set(item.id, sub);
  }

  private announceBatch(): void {
    const done = this.batchDone;
    const failed = this.batchFailed;
    this.batchDone = 0;
    this.batchFailed = 0;
    if (failed === 0) {
      this.toast?.success(done === 1 ? 'Document uploaded' : `${done} documents uploaded`);
    } else {
      this.toast?.error(`${failed} file(s) could not be uploaded`, {
        description: done > 0 ? `${done} uploaded successfully.` : undefined
      });
    }
  }

  private patch(id: number, changes: Partial<UploadItem>): void {
    this.items.update((list) => list.map((i) => (i.id === id ? { ...i, ...changes } : i)));
  }
}
