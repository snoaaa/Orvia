import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { Subject, Subscription, catchError, forkJoin, of, switchMap, tap } from 'rxjs';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';
import { CardComponent } from 'src/app/admin/theme/shared/components/card/card.component';
import { formatFileSize } from '../../document-upload/models/upload.model';
import { apiErrorStatus } from '../../shared/api-error.util';
import { sessionGrants, sessionGrantsInSchool } from '../../shared/api-permissions.util';
import {
  DocumentSummary,
  DocumentVersionItem,
  statusDisplay,
  versionFileName
} from '../models/document-version.model';
import { DocumentVersionService } from '../services/document-version.service';

/** Version history of one document (#116, §4.5): list the versions and download or replace them. */
@Component({
  selector: 'app-document-versions',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, DatePipe],
  templateUrl: './document-versions.component.html'
})
export class DocumentVersionsComponent implements OnInit {
  private readonly versionService = inject(DocumentVersionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(GoeyToastService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
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

  readonly replacing = signal(false);
  readonly replaceProgress = signal(0);
  readonly replaceError = signal<string | null>(null);

  readonly canManage = computed(() => {
    if (typeof this.session.user === 'function' && this.session.user() !== null && typeof this.session.isPlatformAdmin === 'function') {
      const schoolId = this.document()?.schoolId ?? this.session.activeSchoolId?.() ?? null;
      return sessionGrantsInSchool(this.session, schoolId, 'documents:manage');
    }
    if (typeof this.session.activePermissions === 'function') {
      return sessionGrants(this.session, 'documents:manage');
    }
    return this.session.hasPermission('documents:manage');
  });
  readonly heading = computed(() => {
    const doc = this.document();
    return doc ? `Version history - ${doc.title}` : 'Version history';
  });

  private readonly loadTrigger$ = new Subject<void>();
  private replaceSub?: Subscription;

  constructor() {
    this.destroyRef.onDestroy(() => this.replaceSub?.unsubscribe());

    this.loadTrigger$
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap(() => {
          const id = this.documentId();
          return forkJoin({
            doc: this.versionService.getDocument(id).pipe(catchError(() => of(null))),
            list: this.versionService.list(id)
          }).pipe(
            catchError((error: unknown) => {
              const status = apiErrorStatus(error);
              const msg = this.versionService.errorMessage(error, 'load');
              this.loading.set(false);
              if (status === 400 || status === 403 || status === 404) {
                this.toast?.error(msg);
                void this.router.navigate(['/admin/spaces']);
                return of(null);
              }
              this.error.set(msg);
              return of(null);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        if (!result) return;
        if (result.doc) this.document.set(result.doc);
        this.versions.set(
          [...result.list].sort((a, b) => b.versionNumber - a.versionNumber)
        );
        this.loading.set(false);
      });
  }

  ngOnInit(): void {
    const paramMap$ = (this.route as { paramMap?: ActivatedRoute['paramMap'] }).paramMap;
    if (paramMap$ && typeof paramMap$.subscribe === 'function') {
      paramMap$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
        this.applyDocumentId(params.get('documentId') ?? '');
      });
    } else {
      this.applyDocumentId(this.route.snapshot.paramMap.get('documentId') ?? '');
    }
  }

  private applyDocumentId(nextId: string): void {
    if (!nextId) return;
    if (nextId !== this.documentId()) {
      this.document.set(null);
      this.versions.set([]);
      this.replaceError.set(null);
    }
    this.documentId.set(nextId);
    if (this.canManage()) this.load();
  }

  load(): void {
    if (!this.documentId()) return;
    this.loadTrigger$.next();
  }

  /** Uploads the picked file as a new version, then reloads the list. */
  onReplacePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.replacing()) return;

    this.replacing.set(true);
    this.replaceProgress.set(0);
    this.replaceError.set(null);
    this.replaceSub?.unsubscribe();
    this.replaceSub = this.versionService.replace(this.documentId(), file).subscribe({
      next: (e) => {
        if (e.type === 'progress') {
          this.replaceProgress.set(e.percent);
        } else {
          this.replacing.set(false);
          this.toast?.success('New version uploaded');
          this.load();
        }
      },
      error: (error: unknown) => {
        this.replacing.set(false);
        this.replaceError.set(this.versionService.errorMessage(error, 'replace'));
      }
    });
  }

  download(version: DocumentVersionItem): void {
    if (this.downloading() !== null) return;
    this.downloading.set(version.versionNumber);
    this.versionService
      .download(this.documentId(), version.versionNumber)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
