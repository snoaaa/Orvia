import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { Subject, catchError, forkJoin, of, switchMap, tap } from 'rxjs';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';
import { UserEntity } from 'src/app/admin/identity/users/models/user.model';
import { ConfirmationModalComponent } from 'src/app/admin/identity/users/components/confirmation-modal/confirmation-modal.component';
import { UserManagementService } from 'src/app/admin/identity/users/services/user-management.service';
import { CardComponent } from 'src/app/admin/theme/shared/components/card/card.component';
import { DocumentSummary } from '../../document-versions/models/document-version.model';
import { DocumentVersionService } from '../../document-versions/services/document-version.service';
import { apiErrorStatus } from '../../shared/api-error.util';
import { sessionGrants, sessionGrantsInSchool } from '../../shared/api-permissions.util';
import {
  AccessOption,
  AccessOptions,
  AccessRule,
  AccessTargetType,
  TARGET_TYPE_LABELS,
  ruleLabel
} from '../models/document-access.model';
import { DocumentAccessService } from '../services/document-access.service';

/** Who a document is published to (#117, §4.5, §4.7): list, add and remove its access rules. */
@Component({
  selector: 'app-document-access',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, CardComponent, DatePipe, ConfirmationModalComponent],
  templateUrl: './document-access.component.html'
})
export class DocumentAccessComponent implements OnInit {
  private readonly accessService = inject(DocumentAccessService);
  private readonly versionService = inject(DocumentVersionService);
  private readonly userService = inject(UserManagementService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(GoeyToastService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  readonly session = inject(PortalSessionService);

  readonly typeLabels = TARGET_TYPE_LABELS;
  readonly ruleLabel = ruleLabel;

  readonly documentId = signal('');
  readonly document = signal<DocumentSummary | null>(null);
  readonly rules = signal<AccessRule[]>([]);
  readonly options = signal<AccessOptions | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Add form. */
  readonly newType = signal<AccessTargetType>('school');
  readonly newTargetId = signal('');
  readonly adding = signal(false);
  readonly addError = signal<string | null>(null);

  /** User picker (only with `users:read`). */
  readonly userSearch = signal('');
  readonly userResults = signal<UserEntity[]>([]);
  readonly searchingUsers = signal(false);
  readonly userSearchError = signal<string | null>(null);

  /** Rule waiting for the removal confirmation, and the removal in progress. */
  readonly ruleToRemove = signal<AccessRule | null>(null);
  readonly removing = signal(false);

  private readonly targetSchoolId = computed(
    () => this.options()?.school.id ?? this.document()?.schoolId ?? this.session.activeSchoolId?.() ?? null
  );

  readonly canManage = computed(() => this.hasScopedPermission('documents:manage'));
  readonly canPickUsers = computed(() => this.hasScopedPermission('users:read'));
  readonly heading = computed(() => {
    const doc = this.document();
    return doc ? `Access - ${doc.title}` : 'Access';
  });
  /** Types offered by the type selector. */
  readonly types = computed<AccessTargetType[]>(() => {
    const base: AccessTargetType[] = ['school', 'role', 'class', 'group'];
    return this.canPickUsers() ? [...base, 'user'] : base;
  });
  /** Targets of the selected type that have no rule yet (users are searched, not listed). */
  readonly choices = computed<AccessOption[]>(() =>
    this.choicesForType(this.newType(), this.options(), this.rules())
  );
  /** Matched users excluding anyone who already has an explicit user rule on this document. */
  readonly availableUserResults = computed<UserEntity[]>(() => {
    const taken = new Set(this.rules().filter((r) => r.type === 'user').map((r) => r.targetId));
    return this.userResults().filter((u) => !taken.has(u.id));
  });
  readonly isDraft = computed(() => !this.loading() && !this.error() && this.rules().length === 0);

  private readonly loadTrigger$ = new Subject<void>();
  private readonly userSearchTrigger$ = new Subject<string>();

  constructor() {
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
            options: this.accessService.options(id),
            rules: this.accessService.list(id)
          }).pipe(
            catchError((error: unknown) => {
              const status = apiErrorStatus(error);
              const msg = this.accessService.errorMessage(error, 'load');
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
        this.options.set(result.options);
        this.rules.set(result.rules);
        this.pickInitialType(result.options, result.rules);
        this.loading.set(false);
      });

    this.userSearchTrigger$
      .pipe(
        tap(() => {
          this.searchingUsers.set(true);
          this.userSearchError.set(null);
        }),
        switchMap((search) =>
          this.userService
            .getUsers({ search, schoolId: this.options()?.school.id, limit: 10 })
            .pipe(
              catchError((error: unknown) => {
                this.userSearchError.set(this.accessService.errorMessage(error, 'load'));
                this.searchingUsers.set(false);
                return of(null);
              })
            )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((page) => {
        if (!page) return;
        this.userResults.set(page.data);
        this.searchingUsers.set(false);
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

  private hasScopedPermission(permission: string): boolean {
    if (
      typeof this.session.user === 'function' &&
      this.session.user() !== null &&
      typeof this.session.isPlatformAdmin === 'function'
    ) {
      return sessionGrantsInSchool(this.session, this.targetSchoolId(), permission);
    }
    if (typeof this.session.activePermissions === 'function') {
      return sessionGrants(this.session, permission);
    }
    return this.session.hasPermission(permission);
  }

  private choicesForType(
    type: AccessTargetType,
    options: AccessOptions | null,
    rules: readonly AccessRule[]
  ): AccessOption[] {
    if (!options) return [];
    const all =
      type === 'school'
        ? [options.school]
        : type === 'role'
          ? options.roles
          : type === 'class'
            ? options.classes
            : type === 'group'
              ? options.groups
              : [];
    const taken = new Set(rules.filter((r) => r.type === type).map((r) => r.targetId));
    return all.filter((o) => !taken.has(o.id));
  }

  private pickInitialType(options: AccessOptions, rules: readonly AccessRule[]): void {
    const current = this.newType();
    if (current === 'user') {
      if (!this.canPickUsers()) this.newType.set('school');
      else return;
    }
    if (this.choicesForType(this.newType(), options, rules).length > 0) return;
    const available = (['school', 'role', 'class', 'group'] as const).find(
      (t) => this.choicesForType(t, options, rules).length > 0
    );
    if (available) {
      this.newType.set(available);
    } else if (this.canPickUsers()) {
      this.newType.set('user');
    }
  }

  private applyDocumentId(nextId: string): void {
    if (!nextId) return;
    if (nextId !== this.documentId()) {
      this.document.set(null);
      this.options.set(null);
      this.rules.set([]);
      this.newType.set('school');
      this.newTargetId.set('');
      this.userSearch.set('');
      this.userResults.set([]);
      this.userSearchError.set(null);
      this.addError.set(null);
    }
    this.documentId.set(nextId);
    if (this.canManage()) this.load();
  }

  load(): void {
    if (!this.documentId()) return;
    this.loadTrigger$.next();
  }

  onTypeChange(type: AccessTargetType): void {
    this.newType.set(type);
    this.newTargetId.set('');
    this.userSearch.set('');
    this.userResults.set([]);
    this.userSearchError.set(null);
    this.addError.set(null);
  }

  onTargetChange(targetId: string): void {
    this.newTargetId.set(targetId);
    this.addError.set(null);
  }

  searchUsers(): void {
    const search = this.userSearch().trim();
    if (!search || !this.canPickUsers()) return;
    this.userSearchTrigger$.next(search);
  }

  onUserSearchInput(value: string): void {
    this.userSearch.set(value);
    this.newTargetId.set('');
    this.userSearchError.set(null);
    this.addError.set(null);
  }

  pickUser(user: UserEntity): void {
    this.newTargetId.set(user.id);
    this.userSearch.set(`${user.fullName} (${user.email})`);
    this.userResults.set([]);
    this.addError.set(null);
  }

  /** Publishes the document to the selected target. */
  add(): void {
    const id = this.newTargetId();
    if (!id || this.adding()) return;
    this.adding.set(true);
    this.addError.set(null);
    this.accessService
      .add(this.documentId(), [{ type: this.newType(), id }])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rules) => {
          this.rules.set(rules);
          this.newTargetId.set('');
          this.userSearch.set('');
          this.adding.set(false);
          this.toast?.success('Rule added');
        },
        error: (error: unknown) => {
          this.addError.set(this.accessService.errorMessage(error, 'add'));
          this.adding.set(false);
        }
      });
  }

  askRemove(rule: AccessRule): void {
    this.ruleToRemove.set(rule);
  }

  cancelRemove(): void {
    if (!this.removing()) this.ruleToRemove.set(null);
  }

  confirmRemove(): void {
    const rule = this.ruleToRemove();
    if (!rule || this.removing()) return;
    this.removing.set(true);
    this.accessService
      .remove(this.documentId(), rule.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.rules.update((list) => list.filter((r) => r.id !== rule.id));
          this.removing.set(false);
          this.ruleToRemove.set(null);
          this.toast?.success('Rule removed');
        },
        error: (error: unknown) => {
          this.removing.set(false);
          this.ruleToRemove.set(null);
          this.toast?.error(this.accessService.errorMessage(error, 'remove'));
        }
      });
  }

  removeDetail(): string {
    const rule = this.ruleToRemove();
    return rule ? `${TARGET_TYPE_LABELS[rule.type]}: ${ruleLabel(rule)}` : '';
  }
}
