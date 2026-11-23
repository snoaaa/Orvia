import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';
import { CardComponent } from 'src/app/admin/theme/shared/components/card/card.component';
import { formatFileSize } from '../../document-upload/models/upload.model';
import {
  DocumentSummary,
  DocumentVersionItem,
  statusDisplay,
  versionFileName
} from '../models/document-version.model';
import { DocumentVersionService } from '../services/document-version.service';

/** Version history of one document (#116, §4.5): list the versions and download any of them. */
@Component({
  selector: 'app-document-versions',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, DatePipe],
  templateUrl: './document-versions.component.html'
})
export class DocumentVersionsComponent implements OnInit {
  private readonly versionService = inject(DocumentVersionService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(GoeyToastService, { optional: true });
  readonly session = inject(PortalSessionService);

  readonly formatFileSize = formatFileSize;
  readonly statusDisplay = statusDisplay;

  readonly documentId = signal('');
  readonly document = signal<DocumentSummary | null>(null);
  readonly versions = signal<DocumentVersionItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Version number being downloaded, if any. */
  readonly downloading = signal<number | null>(null);

  readonly canManage = computed(() => this.session.hasPermission('documents:manage'));
  readonly heading = computed(() => {
    const doc = this.document();
    return doc ? `Version history - ${doc.title}` : 'Version history';
  });

  ngOnInit(): void {
    this.documentId.set(this.route.snapshot.paramMap.get('documentId') ?? '');
    if (this.canManage() && this.documentId()) this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    const id = this.documentId();
    this.versionService.getDocument(id).subscribe({
      next: (doc) => this.document.set(doc),
      error: () => undefined // the title is only cosmetic; the list reports real errors
    });
    this.versionService.list(id).subscribe({
      next: (list) => {
        this.versions.set([...list].sort((a, b) => b.versionNumber - a.versionNumber));
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.versionService.errorMessage(error, 'load'));
        this.loading.set(false);
      }
    });
  }

  download(version: DocumentVersionItem): void {
    if (this.downloading() !== null) return;
    this.downloading.set(version.versionNumber);
    this.versionService.download(this.documentId(), version.versionNumber).subscribe({
      next: (blob) => {
        const title = this.document()?.title ?? '';
        this.versionService.saveFile(
          blob,
          versionFileName(title, version.versionNumber, version.mimeType)
        );
        this.downloading.set(null);
      },
      error: (error: unknown) => {
        this.toast?.error(this.versionService.errorMessage(error, 'download'));
        this.downloading.set(null);
      }
    });
  }
}
