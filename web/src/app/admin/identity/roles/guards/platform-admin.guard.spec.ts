import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ADMIN_TYPE_STORAGE_KEY } from 'src/app/admin/theme/layouts/admin-layout/navigation/navigation';
import { platformAdminGuard } from './platform-admin.guard';

describe('platformAdminGuard', () => {
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    router = { navigate: vi.fn() };

    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: router }]
    });

    localStorage.removeItem(ADMIN_TYPE_STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(ADMIN_TYPE_STORAGE_KEY);
  });

  it('allows access when admin type is platform', () => {
    localStorage.setItem(ADMIN_TYPE_STORAGE_KEY, 'platform');
    const result = TestBed.runInInjectionContext(() =>
      platformAdminGuard({} as any, {} as any)
    );
    expect(result).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('allows access by default when no admin type is stored', () => {
    const result = TestBed.runInInjectionContext(() =>
      platformAdminGuard({} as any, {} as any)
    );
    expect(result).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('blocks access and redirects to dashboard when admin type is school', () => {
    localStorage.setItem(ADMIN_TYPE_STORAGE_KEY, 'school');
    const result = TestBed.runInInjectionContext(() =>
      platformAdminGuard({} as any, {} as any)
    );
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/dashboard/default']);
  });
});

