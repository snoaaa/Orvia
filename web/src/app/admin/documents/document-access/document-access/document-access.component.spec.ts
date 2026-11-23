import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { of, throwError } from 'rxjs';
import { PortalSessionService } from 'src/app/admin/identity/services/portal-session.service';
import { UserManagementService } from 'src/app/admin/identity/users/services/user-management.service';
import { DocumentVersionService } from '../../document-versions/services/document-version.service';
import { AccessOptions, AccessRule } from '../models/document-access.model';
import { DocumentAccessService } from '../services/document-access.service';
import { DocumentAccessComponent } from './document-access.component';

describe('DocumentAccessComponent', () => {
  let fixture: ComponentFixture<DocumentAccessComponent>;
  let component: DocumentAccessComponent;
  let permissions: string[];
  let service: {
    list: ReturnType<typeof vi.fn>;
    options: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    errorMessage: ReturnType<typeof vi.fn>;
  };
  let users: { getUsers: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  const rule = (id: string, type: AccessRule['type'], name: string, targetId = `t-${id}`): AccessRule => ({
    id,
    documentId: 'doc-1',
    type,
    targetId,
    targetName: name,
    createdAt: '2026-01-02T10:00:00.000Z'
  });
  const options: AccessOptions = {
    school: { id: 's1', name: 'Lycee A' },
    roles: [{ id: 'r1', name: 'STAFF' }],
    classes: [{ id: 'c1', name: '6e A' }],
    groups: [{ id: 'g1', name: 'Sciences' }]
  };

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const click = (selector: string): void => (el().querySelector(selector) as HTMLElement).click();

  function create(): void {
    fixture = TestBed.createComponent(DocumentAccessComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    permissions = ['documents:manage', 'users:read'];
    service = {
      list: vi.fn().mockReturnValue(of([rule('a', 'class', '6e A', 'c1'), rule('b', 'user', 'Ada')])),
      options: vi.fn().mockReturnValue(of(options)),
      add: vi.fn(),
      remove: vi.fn().mockReturnValue(of(undefined)),
      errorMessage: vi.fn((e: { message?: string }) => e?.message ?? 'fallback')
    };
    users = { getUsers: vi.fn() };
    toast = { success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      imports: [DocumentAccessComponent],
      providers: [
        { provide: DocumentAccessService, useValue: service },
        {
          provide: DocumentVersionService,
          useValue: { getDocument: vi.fn().mockReturnValue(of({ id: 'doc-1', title: 'Notes' })) }
        },
        { provide: UserManagementService, useValue: users },
        { provide: GoeyToastService, useValue: toast },
        { provide: PortalSessionService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'doc-1' } } } }
      ]
    });
  });

  it('hides the page without documents:manage', () => {
    permissions = [];
    create();
    expect(el().querySelector('#access-no-access')).not.toBeNull();
    expect(service.list).not.toHaveBeenCalled();
  });

  it('lists the rules by type and name, not by id', () => {
    create();
    const rows = el().querySelectorAll('#access-list tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Class');
    expect(rows[0].textContent).toContain('6e A');
    expect(rows[1].textContent).toContain('Ada');
    expect(el().querySelector('#access-draft')).toBeNull();
    expect(el().querySelector('#access-school')?.textContent).toContain('Lycee A');
    expect(component.heading()).toBe('Access - Notes');
  });

  it('shows the draft notice when there are no rules', () => {
    service.list.mockReturnValue(of([]));
    create();
    expect(el().querySelector('#access-draft')?.textContent).toContain('visible only to managers');
    expect(el().querySelector('#access-list')).toBeNull();
  });

  it('shows the API error with a retry', () => {
    service.list.mockReturnValueOnce(throwError(() => ({ message: 'Document not found' })));
    create();
    expect(el().querySelector('#access-error')?.textContent).toContain('Document not found');
    click('#access-error button');
    expect(service.list).toHaveBeenCalledTimes(2);
  });

  it('only offers targets without a rule, from the options of the document', () => {
    create();
    component.onTypeChange('class');
    expect(component.choices()).toEqual([]); // 6e A already has a rule
    component.onTypeChange('role');
    expect(component.choices()).toEqual(options.roles);
    component.onTypeChange('group');
    expect(component.choices()).toEqual(options.groups);
    component.onTypeChange('school');
    expect(component.choices()).toEqual([options.school]);
  });

  it('adds a rule with POST and shows the new list', () => {
    const added = [rule('a', 'class', '6e A'), rule('c', 'role', 'STAFF')];
    service.add.mockReturnValue(of(added));
    create();
    component.onTypeChange('role');
    component.newTargetId.set('r1');
    fixture.detectChanges();
    click('#access-add');
    expect(service.add).toHaveBeenCalledWith('doc-1', [{ type: 'role', id: 'r1' }]);
    expect(component.rules()).toEqual(added);
    expect(toast.success).toHaveBeenCalled();
    expect(component.newTargetId()).toBe('');
  });

  it('shows the API reason when adding is refused', () => {
    service.add.mockReturnValue(throwError(() => ({ message: 'Role x is a platform role' })));
    create();
    component.onTypeChange('role');
    component.newTargetId.set('r1');
    component.add();
    fixture.detectChanges();
    expect(el().querySelector('#access-add-error')?.textContent).toContain('platform role');
    expect(component.rules()).toHaveLength(2);
  });

  it('removes a rule only after the confirmation', () => {
    create();
    click('.rule-remove');
    fixture.detectChanges();
    expect(service.remove).not.toHaveBeenCalled();
    expect(component.removeDetail()).toBe('Class: 6e A');

    component.cancelRemove();
    expect(component.ruleToRemove()).toBeNull();
    expect(service.remove).not.toHaveBeenCalled();

    component.askRemove(component.rules()[0]);
    component.confirmRemove();
    expect(service.remove).toHaveBeenCalledWith('doc-1', 'a');
    expect(component.rules().map((r) => r.id)).toEqual(['b']);
    expect(toast.success).toHaveBeenCalledWith('Rule removed');
  });

  it('reports a failed removal and keeps the rule', () => {
    service.remove.mockReturnValue(throwError(() => ({ message: 'Rule not found' })));
    create();
    component.askRemove(component.rules()[0]);
    component.confirmRemove();
    expect(toast.error).toHaveBeenCalledWith('Rule not found');
    expect(component.rules()).toHaveLength(2);
  });

  it('searches users of the school of the document and adds the picked one', () => {
    users.getUsers.mockReturnValue(
      of({ data: [{ id: 'u1', fullName: 'Grace', email: 'g@x.io' }], total: 1, page: 1, limit: 10, totalPages: 1 })
    );
    service.add.mockReturnValue(of([]));
    create();
    component.onTypeChange('user');
    component.onUserSearchInput('gra');
    component.searchUsers();
    expect(users.getUsers).toHaveBeenCalledWith({ search: 'gra', schoolId: 's1', limit: 10 });
    component.pickUser(component.userResults()[0] ?? ({ id: 'u1', fullName: 'Grace', email: 'g@x.io' } as never));
    component.add();
    expect(service.add).toHaveBeenCalledWith('doc-1', [{ type: 'user', id: 'u1' }]);
  });

  it('without users:read offers no user type and explains why', () => {
    permissions = ['documents:manage'];
    create();
    expect(component.types()).not.toContain('user');
    expect(el().querySelector('#access-users-note')).not.toBeNull();
  });
});
