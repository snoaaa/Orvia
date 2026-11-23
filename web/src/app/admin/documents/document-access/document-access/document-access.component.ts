import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';
import { UserEntity } from 'src/app/admin/identity/users/models/user.model';
import { ConfirmationModalComponent } from 'src/app/admin/identity/users/components/confirmation-modal/confirmation-modal.component';
import { UserManagementService } from 'src/app/admin/identity/users/services/user-management.service';
import { CardComponent } from 'src/app/admin/theme/shared/components/card/card.component';
import { DocumentSummary } from '../../document-versions/models/document-version.model';
import { DocumentVersionService } from '../../document-versions/services/document-version.service';
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
  private readonly toast = inject(GoeyToastService, { optional: true });
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

  readonly canManage = computed(() => this.session.hasPermission('documents:manage'));
  readonly canPickUsers = computed(() => this.session.hasPermission('users:read'));
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
  readonly choices = computed<AccessOption[]>(() => {
    const options = this.options();
    if (!options) return [];
    const type = this.newType();
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
    const taken = new Set(this.rules().filter((r) => r.type === type).map((r) => r.targetId));
    return all.filter((o) => !taken.has(o.id));
  });
  readonly isDraft = computed(() => !this.loading() && !this.error() && this.rules().length === 0);

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
      error: () => undefined // the title is only cosmetic; the rules report real errors
    });
    this.accessService.options(id).subscribe({
      next: (options) => this.options.set(options),
      error: (error: unknown) => this.error.set(this.accessService.errorMessage(error, 'load'))
    });
    this.accessService.list(id).subscribe({
      next: (rules) => {
        this.rules.set(rules);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.accessService.errorMessage(error, 'load'));
        this.loading.set(false);
      }
    });
  }

  onTypeChange(type: AccessTargetType): void {
    this.newType.set(type);
    this.newTargetId.set('');
    this.userSearch.set('');
    this.userResults.set([]);
    this.addError.set(null);
  }

  searchUsers(): void {
    const search = this.userSearch().trim();
    if (!search) return;
    this.searchingUsers.set(true);
    this.userSearchError.set(null);
    this.userService.getUsers({ search, schoolId: this.options()?.school.id, limit: 10 }).subscribe({
      next: (page) => {
        this.userResults.set(page.data);
        this.searchingUsers.set(false);
      },
      error: (error: unknown) => {
        this.userSearchError.set(this.accessService.errorMessage(error, 'load'));
        this.searchingUsers.set(false);
      }
    });
  }

  onUserSearchInput(value: string): void {
    this.userSearch.set(value);
    this.newTargetId.set('');
  }

  pickUser(user: UserEntity): void {
    this.newTargetId.set(user.id);
    this.userSearch.set(`${user.fullName} (${user.email})`);
    this.userResults.set([]);
  }

  /** Publishes the document to the selected target. */
  add(): void {
    const id = this.newTargetId();
    if (!id || this.adding()) return;
    this.adding.set(true);
    this.addError.set(null);
    this.accessService.add(this.documentId(), [{ type: this.newType(), id }]).subscribe({
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
    this.accessService.remove(this.documentId(), rule.id).subscribe({
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
