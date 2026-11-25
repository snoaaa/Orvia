import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { GoeyToastService } from 'goey-toast-angular';
import { Observable, firstValueFrom, of } from 'rxjs';
import { PortalSessionService } from '../../identity/services/portal-session.service';
import { apiPermissionGuard, grantsApiPermission, sessionGrantsInSchool } from './api-permissions.util';

describe('grantsApiPermission (same rules as the API)', () => {
  it.each([
    [['*'], 'spaces:create', true],
    [['spaces:create'], 'spaces:create', true],
    // documents:manage covers each document and space permission...
    [['documents:manage'], 'spaces:create', true],
    [['documents:manage'], 'spaces:delete', true],
    // ...and any of them grants documents:manage, like the API's PermissionsGuard.
    [['spaces:update'], 'documents:manage', true],
    [['documents:publish'], 'documents:manage', true],
    // But they do not grant one another.
    [['spaces:update'], 'spaces:create', false],
    [['spaces:create'], 'spaces:delete', false],
    [['documents:read', 'spaces:read'], 'documents:manage', false],
    [['documents:read'], 'spaces:read', false],
    [[], 'spaces:read', false]
  ] as [string[], string, boolean][])('%j -> %s: %s', (permissions, required, expected) => {
    expect(grantsApiPermission(permissions, required)).toBe(expected);
  });
});

describe('apiPermissionGuard', () => {
  let permissions: string[];
  let router: { navigate: ReturnType<typeof vi.fn> };
  let toast: { error: ReturnType<typeof vi.fn> };

  const run = (...anyOf: string[]) =>
    TestBed.runInInjectionContext(() =>
      firstValueFrom(
        apiPermissionGuard(...anyOf)(
          {} as ActivatedRouteSnapshot,
          { url: '/admin/spaces/new' } as RouterStateSnapshot
        ) as Observable<boolean>
      )
    );

  beforeEach(() => {
    permissions = [];
    router = { navigate: vi.fn() };
    toast = { error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PortalSessionService,
          useValue: { ensureLoaded: () => of(null), activePermissions: () => permissions }
        },
        { provide: Router, useValue: router },
        { provide: GoeyToastService, useValue: toast }
      ]
    });
  });

  it('lets the page open with one of the permissions', async () => {
    permissions = ['spaces:read'];
    expect(await run('spaces:read', 'documents:manage')).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('sends anyone else to the "Not allowed" page', async () => {
    permissions = ['spaces:update'];
    expect(await run('spaces:create')).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/forbidden'], {
      queryParams: { blocked: '/admin/spaces/new' }
    });
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('sessionGrantsInSchool', () => {
  const makeSession = (
    overrides: Partial<{
      isPlatformAdmin: boolean;
      activePermissions: string[];
      assignments: Array<{ schoolId: string; scope?: string; permissions?: string[] }>;
    }>
  ) =>
    ({
      isPlatformAdmin: () => overrides.isPlatformAdmin ?? false,
      activePermissions: () => overrides.activePermissions ?? [],
      user: () => ({
        assignments: overrides.assignments ?? []
      })
    }) as unknown as PortalSessionService;

  it('scopes checks to the target school assignments without leaking from other schools', () => {
    const sess = makeSession({
      activePermissions: ['documents:manage', 'documents:read', 'spaces:create'],
      assignments: [
        { schoolId: 'school-a', scope: 'school', permissions: ['documents:manage', 'spaces:create'] },
        { schoolId: 'school-b', scope: 'school', permissions: ['documents:read'] }
      ]
    });
    expect(sessionGrantsInSchool(sess, 'school-a', 'spaces:create')).toBe(true);
    expect(sessionGrantsInSchool(sess, 'school-b', 'documents:manage')).toBe(false);
    expect(sessionGrantsInSchool(sess, 'school-b', 'documents:read')).toBe(true);
  });

  it('allows platform admins in any school', () => {
    const sess = makeSession({ isPlatformAdmin: true });
    expect(sessionGrantsInSchool(sess, 'school-x', 'documents:manage')).toBe(true);
  });
});
