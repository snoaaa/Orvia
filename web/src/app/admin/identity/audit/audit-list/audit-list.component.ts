import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GoeyToastService } from 'goey-toast-angular';
import { PortalSessionService } from '../../services/portal-session.service';
import { SchoolSummaryOption, UserEntity } from '../../users/models/user.model';
import { UserManagementService } from '../../users/services/user-management.service';
import { AUDIT_ACTIONS, AuditEvent, PaginatedAuditEvents } from '../models/audit.model';
import { AuditEventsService } from '../services/audit-events.service';

/** A line of the detail view: a single value, or a before/after pair. */
export interface AuditDetailRow {
  key: string;
  value?: string;
  from?: string;
  to?: string;
  previous?: boolean;
}

/**
 * Read-only audit trail (#96, section 4.5). Filters, server-side pagination and an event detail
 * view; there is no edit or delete action. The school filter exists for platform admins only, a
 * school admin is scoped to their school by the API.
 */
@Component({
  selector: 'app-audit-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './audit-list.component.html',
  styleUrls: ['./audit-list.component.scss']
})
export class AuditListComponent implements OnInit {
  private readonly auditService = inject(AuditEventsService);
  private readonly userService = inject(UserManagementService);
  private readonly toast = inject(GoeyToastService);
  readonly session = inject(PortalSessionService);

  readonly events = signal<AuditEvent[]>([]);
  readonly totalEvents = signal<number>(0);
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(10);
  readonly totalPages = signal<number>(1);

  readonly isInitialLoading = signal<boolean>(true);
  readonly isUpdating = signal<boolean>(false);
  readonly errorMessage = signal<string>('');

  // Filter state
  readonly dateFrom = signal<string>('');
  readonly dateTo = signal<string>('');
  readonly selectedAction = signal<string>('');
  readonly selectedSchoolId = signal<string>('');
  readonly selectedActor = signal<UserEntity | null>(null);

  // Actor picker (search by name/email, no UUID needed)
  readonly actorSearch = signal<string>('');
  readonly actorResults = signal<UserEntity[]>([]);
  readonly actorSearching = signal<boolean>(false);
  readonly actorMenuOpen = signal<boolean>(false);

  readonly actions = AUDIT_ACTIONS;
  readonly schools = signal<SchoolSummaryOption[]>([]);

  // Detail view
  readonly selectedEvent = signal<AuditEvent | null>(null);
  readonly detailRows = computed<AuditDetailRow[]>(() => {
    const event = this.selectedEvent();
    return event ? this.buildDetailRows(event.details) : [];
  });
  readonly hasBeforeAfter = computed<boolean>(() =>
    this.detailRows().some((r) => r.from !== undefined || r.to !== undefined)
  );

  private actorDebounceTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    if (this.session.isPlatformAdmin()) {
      this.userService.getSchools().subscribe({
        next: (schools) => this.schools.set(schools),
        error: () => {}
      });
    }
    this.loadEvents();
  }

  /** School used to scope the actor search: the admin's school, or the one picked by a platform admin. */
  private get actorSearchSchoolId(): string | undefined {
    if (!this.session.isPlatformAdmin()) {
      return this.session.activeSchoolId() ?? undefined;
    }
    return this.selectedSchoolId() || undefined;
  }

  loadEvents(): void {
    if (this.events().length === 0) {
      this.isInitialLoading.set(true);
    } else {
      this.isUpdating.set(true);
    }
    this.errorMessage.set('');

    this.auditService
      .getEvents({
        page: this.currentPage(),
        limit: this.pageSize(),
        from: this.toStartOfDay(this.dateFrom()),
        to: this.toEndOfDay(this.dateTo()),
        actorId: this.selectedActor()?.id,
        action: this.selectedAction() || undefined,
        // Only platform admins choose a school; for school admins the API already scopes the list.
        schoolId: this.session.isPlatformAdmin() ? this.selectedSchoolId() || undefined : undefined
      })
      .subscribe({
        next: (res: PaginatedAuditEvents) => {
          this.events.set(res.data);
          this.totalEvents.set(res.total);
          this.currentPage.set(res.page);
          this.pageSize.set(res.limit);
          this.totalPages.set(res.totalPages || Math.ceil(res.total / res.limit) || 1);
          this.isInitialLoading.set(false);
          this.isUpdating.set(false);
        },
        error: (error) => {
          this.isInitialLoading.set(false);
          this.isUpdating.set(false);
          const msg = this.userService.extractErrorMessage(error, 'Failed to retrieve audit events.');
          this.errorMessage.set(msg);
          this.toast.error('Failed to load audit events', { description: msg });
        }
      });
  }

  // ---- Filters ----

  onDateFromChange(value: string): void {
    this.dateFrom.set(value);
    this.applyFilters();
  }

  onDateToChange(value: string): void {
    this.dateTo.set(value);
    this.applyFilters();
  }

  onActionChange(value: string): void {
    this.selectedAction.set(value);
    this.applyFilters();
  }

  onSchoolFilterChange(schoolId: string): void {
    this.selectedSchoolId.set(schoolId);
    // A previously picked actor may not belong to the new school: restart the actor filter.
    this.clearActor(false);
    this.applyFilters();
  }

  onActorSearchChange(term: string): void {
    this.actorSearch.set(term);
    if (this.actorDebounceTimer) {
      clearTimeout(this.actorDebounceTimer);
    }
    if (!term.trim()) {
      this.actorResults.set([]);
      this.actorMenuOpen.set(false);
      return;
    }
    this.actorDebounceTimer = setTimeout(() => this.searchActors(), 300);
  }

  private searchActors(): void {
    this.actorSearching.set(true);
    this.actorMenuOpen.set(true);
    const schoolId = this.actorSearchSchoolId;
    this.userService
      .getUsers({ search: this.actorSearch(), limit: 8, ...(schoolId ? { schoolId } : {}) })
      .subscribe({
        next: (res) => {
          this.actorResults.set(res.data);
          this.actorSearching.set(false);
        },
        error: () => {
          this.actorResults.set([]);
          this.actorSearching.set(false);
        }
      });
  }

  selectActor(user: UserEntity): void {
    this.selectedActor.set(user);
    this.actorSearch.set('');
    this.actorResults.set([]);
    this.actorMenuOpen.set(false);
    this.applyFilters();
  }

  clearActor(reload = true): void {
    this.selectedActor.set(null);
    this.actorSearch.set('');
    this.actorResults.set([]);
    this.actorMenuOpen.set(false);
    if (reload) {
      this.applyFilters();
    }
  }

  resetFilters(): void {
    this.dateFrom.set('');
    this.dateTo.set('');
    this.selectedAction.set('');
    this.selectedSchoolId.set('');
    this.clearActor(false);
    this.applyFilters();
  }

  get hasActiveFilters(): boolean {
    return !!(
      this.dateFrom() ||
      this.dateTo() ||
      this.selectedAction() ||
      this.selectedSchoolId() ||
      this.selectedActor()
    );
  }

  private applyFilters(): void {
    this.currentPage.set(1);
    this.loadEvents();
  }

  // ---- Pagination ----

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
    this.loadEvents();
  }

  changePageSize(newSize: number): void {
    this.pageSize.set(newSize);
    this.currentPage.set(1);
    this.loadEvents();
  }

  // ---- Detail view ----

  openDetail(event: AuditEvent): void {
    this.selectedEvent.set(event);
  }

  closeDetail(): void {
    this.selectedEvent.set(null);
  }

  /** `changes: { field: { from, to } }` becomes before/after rows; every other key is shown as is. */
  buildDetailRows(details: Record<string, unknown> | null | undefined): AuditDetailRow[] {
    const rows: AuditDetailRow[] = [];
    for (const [key, value] of Object.entries(details ?? {})) {
      if (key === 'changes' && this.isRecord(value)) {
        for (const [field, change] of Object.entries(value)) {
          if (this.isRecord(change) && ('from' in change || 'to' in change)) {
            rows.push({ key: field, from: this.format(change['from']), to: this.format(change['to']) });
          } else {
            rows.push({ key: `changes.${field}`, value: this.format(change) });
          }
        }
      } else {
        rows.push({ key, value: this.format(value), previous: /^previous[A-Z]/.test(key) });
      }
    }
    return rows;
  }

  // ---- Display helpers ----

  actionLabel(action: string): string {
    const text = action.replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** Actor name, or role + short id when the user no longer exists, or "Anonymous". */
  actorLabel(e: AuditEvent): string {
    if (e.actorName) return e.actorName;
    if (!e.actorId) return 'Anonymous';
    return `${e.actorRole ?? 'Unknown'} · ${this.shortId(e.actorId)}`;
  }

  targetLabel(e: AuditEvent): string {
    if (!e.entityType) return '—';
    return e.entityId ? `${e.entityType} · ${this.shortId(e.entityId)}` : e.entityType;
  }

  shortId(id: string): string {
    return /^[0-9a-f]{8}-/i.test(id) ? id.slice(0, 8) : id;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private format(value: unknown): string {
    if (value === null || value === undefined) return '—';
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  /** `YYYY-MM-DD` from the date input, as the start of that day in local time (ISO 8601). */
  private toStartOfDay(date: string): string | undefined {
    return date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
  }

  private toEndOfDay(date: string): string | undefined {
    return date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined;
  }
}
