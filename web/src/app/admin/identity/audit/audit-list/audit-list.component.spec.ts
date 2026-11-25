import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { PortalSessionService } from '../../services/portal-session.service';
import { UserManagementService } from '../../users/services/user-management.service';
import { AuditEvent, PaginatedAuditEvents } from '../models/audit.model';
import { AuditEventsService } from '../services/audit-events.service';
import { AuditListComponent } from './audit-list.component';

describe('AuditListComponent', () => {
  let component: AuditListComponent;
  let fixture: ComponentFixture<AuditListComponent>;
  let mockAudit: any;
  let mockUsers: any;
  let session: PortalSessionService;

  const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
    id: 'e1',
    seq: '1',
    category: 'identity_access',
    action: 'role_assigned',
    actorId: '11111111-2222-3333-4444-555555555555',
    actorName: 'Jane Doe',
    actorEmail: 'jane@school.edu',
    actorRole: 'SCHOOL_ADMIN',
    schoolId: 'school-a',
    schoolName: 'Demo School A',
    entityType: 'user',
    entityId: '99999999-2222-3333-4444-555555555555',
    ip: '10.0.0.1',
    deviceId: 'dev-1',
    details: { role: 'STAFF', previousRole: 'STUDENT' },
    createdAt: '2026-11-20T10:00:00.000Z',
    ...over
  });

  const page = (data: AuditEvent[], over: Partial<PaginatedAuditEvents> = {}): PaginatedAuditEvents => ({
    data,
    total: data.length,
    page: 1,
    limit: 10,
    totalPages: 1,
    ...over
  });

  async function setup(platform: boolean) {
    mockAudit = { getEvents: vi.fn().mockReturnValue(of(page([event()]))) };
    mockUsers = {
      getUsers: vi.fn().mockReturnValue(
        of({
          data: [{ id: 'u-jane', fullName: 'Jane Doe', email: 'jane@school.edu' }],
          total: 1,
          page: 1,
          limit: 8,
          totalPages: 1
        })
      ),
      getSchools: vi.fn().mockReturnValue(of([{ id: 'school-a', name: 'Demo School A' }])),
      extractErrorMessage: vi.fn().mockImplementation((_e, fallback) => fallback)
    };

    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AuditListComponent],
      providers: [
        PortalSessionService,
        { provide: AuditEventsService, useValue: mockAudit },
        { provide: UserManagementService, useValue: mockUsers }
      ]
    }).compileComponents();

    session = TestBed.inject(PortalSessionService);
    session.user.set({
      id: 'me',
      email: 'me@x.edu',
      fullName: 'Me',
      status: 'ACTIVE',
      role: platform ? 'PLATFORM_ADMIN' : 'SCHOOL_ADMIN',
      permissions: ['audit:read'],
      schoolIds: platform ? [] : ['school-a'],
      schools: platform ? [] : [{ id: 'school-a', name: 'Demo School A' }],
      isPlatformAdmin: platform,
      assignments: [
        {
          role: platform ? 'PLATFORM_ADMIN' : 'SCHOOL_ADMIN',
          scope: platform ? 'platform' : 'school',
          schoolId: platform ? '' : 'school-a',
          groupId: null,
          permissions: ['audit:read']
        }
      ]
    });
    session.initialized.set(true);

    fixture = TestBed.createComponent(AuditListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  describe('as platform admin', () => {
    beforeEach(() => setup(true));

    it('loads the first page on init', () => {
      expect(mockAudit.getEvents).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 10 }));
      expect(component.events().length).toBe(1);
      expect(component.totalEvents()).toBe(1);
    });

    it('shows the school filter and loads the schools', () => {
      expect(mockUsers.getSchools).toHaveBeenCalled();
      expect(fixture.nativeElement.querySelector('#audit-school')).not.toBeNull();
    });

    it('sends the school filter and resets to page 1', () => {
      component.currentPage.set(3);
      component.onSchoolFilterChange('school-a');
      expect(component.currentPage()).toBe(1);
      expect(mockAudit.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ schoolId: 'school-a', page: 1 }));
    });

    it('turns the date inputs into an inclusive ISO range', () => {
      component.onDateFromChange('2026-11-01');
      component.onDateToChange('2026-11-30');
      const args = mockAudit.getEvents.mock.calls.at(-1)[0];
      expect(args.from).toBe(new Date('2026-11-01T00:00:00').toISOString());
      expect(args.to).toBe(new Date('2026-11-30T23:59:59.999').toISOString());
    });

    it('sends the action filter', () => {
      component.onActionChange('login_failure');
      expect(mockAudit.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'login_failure' }));
    });

    it('picks an actor by searching name/email, then filters on its id', () => {
      vi.useFakeTimers();
      component.onActorSearchChange('jane');
      vi.advanceTimersByTime(300);
      vi.useRealTimers();
      expect(mockUsers.getUsers).toHaveBeenCalledWith(expect.objectContaining({ search: 'jane', limit: 8 }));
      expect(component.actorResults().length).toBe(1);

      component.selectActor(component.actorResults()[0]);
      expect(mockAudit.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ actorId: 'u-jane', page: 1 }));

      component.clearActor();
      expect(mockAudit.getEvents.mock.calls.at(-1)[0].actorId).toBeUndefined();
    });

    it('paginates server-side and respects the boundaries', () => {
      mockAudit.getEvents.mockImplementation((f: { page: number; limit: number }) =>
        of(page([event()], { total: 25, totalPages: 3, page: f.page, limit: f.limit }))
      );
      component.loadEvents();
      component.goToPage(2);
      expect(mockAudit.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
      component.goToPage(9);
      expect(component.currentPage()).toBe(2);
      component.changePageSize(25);
      expect(mockAudit.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 25 }));
    });

    it('resets every filter', () => {
      component.onActionChange('logout');
      component.onSchoolFilterChange('school-a');
      component.resetFilters();
      expect(component.hasActiveFilters).toBe(false);
    });

    it('labels actors, falling back to role + short id for a deleted user', () => {
      expect(component.actorLabel(event())).toBe('Jane Doe');
      expect(component.actorLabel(event({ actorName: null, actorEmail: null }))).toBe('SCHOOL_ADMIN · 11111111');
      expect(component.actorLabel(event({ actorId: null, actorName: null }))).toBe('Anonymous');
    });

    it('opens and closes the read-only detail, with no edit or delete control', () => {
      component.openDetail(event());
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
      const buttons = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('button')).map((b) =>
        (b.textContent ?? '').trim().toLowerCase()
      );
      expect(buttons.filter((t) => /delete|edit|remove|save/.test(t))).toEqual([]);
      component.closeDetail();
      expect(component.selectedEvent()).toBeNull();
    });

    it('builds before/after rows from details.changes ({from,to} and {before,after}) and plain rows otherwise', () => {
      const rows = component.buildDetailRows({
        changes: {
          title: { from: 'Old', to: 'New' },
          name: { before: 'Demo A', after: 'Demo B' }
        },
        previousRole: 'STUDENT',
        role: 'STAFF',
        rules: [{ type: 'school' }]
      });
      expect(rows).toContainEqual({ key: 'title', from: 'Old', to: 'New' });
      expect(rows).toContainEqual({ key: 'name', from: 'Demo A', to: 'Demo B' });
      expect(rows).toContainEqual({ key: 'previousRole', value: 'STUDENT', previous: true });
      expect(rows).toContainEqual({ key: 'role', value: 'STAFF', previous: false });
      expect(rows).toContainEqual({ key: 'rules', value: '[{"type":"school"}]', previous: false });
      expect(component.buildDetailRows({})).toEqual([]);
    });

    it('drops stale responses when filters change quickly (switchMap) and closes modal on Escape', () => {
      const first$ = new Subject<PaginatedAuditEvents>();
      const second$ = new Subject<PaginatedAuditEvents>();
      mockAudit.getEvents.mockReturnValueOnce(first$).mockReturnValueOnce(second$);

      component.onActionChange('login_success');
      component.onActionChange('logout');

      second$.next(page([event({ id: 'newer', action: 'logout' })]));
      first$.next(page([event({ id: 'stale', action: 'login_success' })]));

      expect(component.events().map((e) => e.id)).toEqual(['newer']);

      component.openDetail(component.events()[0]);
      expect(component.selectedEvent()?.id).toBe('newer');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(component.selectedEvent()).toBeNull();
    });

    it('clamps back to the last page when a page turns out past the end', () => {
      mockAudit.getEvents
        .mockReturnValueOnce(of(page([], { total: 15, page: 5, limit: 10, totalPages: 2 })))
        .mockReturnValueOnce(of(page([event()], { total: 15, page: 2, limit: 10, totalPages: 2 })));

      component.currentPage.set(5);
      component.loadEvents();

      expect(component.currentPage()).toBe(2);
      expect(mockAudit.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    });
  });

  describe('as school admin', () => {
    beforeEach(() => setup(false));

    it('hides the school filter and never sends a schoolId', () => {
      expect(fixture.nativeElement.querySelector('#audit-school')).toBeNull();
      expect(mockUsers.getSchools).not.toHaveBeenCalled();
      expect(mockAudit.getEvents.mock.calls.at(-1)[0].schoolId).toBeUndefined();
    });

    it('scopes the actor search to the admin school', () => {
      vi.useFakeTimers();
      component.onActorSearchChange('jane');
      vi.advanceTimersByTime(300);
      vi.useRealTimers();
      expect(mockUsers.getUsers).toHaveBeenCalledWith(expect.objectContaining({ schoolId: 'school-a' }));
    });

    it('scopes to the active school and reloads when a multi-school admin switches schools', () => {
      session.user.set({
        id: 'multi',
        email: 'multi@x.edu',
        fullName: 'Multi Admin',
        status: 'ACTIVE',
        role: 'SCHOOL_ADMIN',
        permissions: ['audit:read'],
        schoolIds: ['school-a', 'school-b'],
        schools: [
          { id: 'school-a', name: 'Demo School A' },
          { id: 'school-b', name: 'Demo School B' }
        ],
        isPlatformAdmin: false,
        assignments: [
          { role: 'SCHOOL_ADMIN', scope: 'school', schoolId: 'school-a', groupId: null, permissions: ['audit:read'] },
          { role: 'SCHOOL_ADMIN', scope: 'school', schoolId: 'school-b', groupId: null, permissions: ['audit:read'] }
        ]
      });
      fixture.detectChanges();

      expect(mockAudit.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ schoolId: 'school-a' }));

      component.selectedActor.set({ id: 'u1', fullName: 'Jane Doe', email: 'jane@school.edu' } as any);
      session.selectedSchoolId.set('school-b');
      fixture.detectChanges();

      expect(component.selectedActor()).toBeNull();
      expect(mockAudit.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ schoolId: 'school-b', page: 1 }));
    });
  });
});
