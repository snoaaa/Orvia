import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ActiveSession, UserEntity } from '../models/user.model';
import { UserManagementService } from '../services/user-management.service';
import { UserEditComponent } from './user-edit.component';

describe('UserEditComponent', () => {
  let component: UserEditComponent;
  let fixture: ComponentFixture<UserEditComponent>;
  let mockUserService: any;

  const mockUser: UserEntity = {
    id: 'user-123',
    email: 'test@school.edu',
    fullName: 'Test User',
    authProvider: 'local',
    status: 'ACTIVE',
    createdAt: '2026-10-15T08:00:00.000Z',
    updatedAt: '2026-10-15T08:00:00.000Z'
  };

  const mockSessions: ActiveSession[] = [
    {
      id: 'session-1',
      current: true,
      device: { id: 'device-1', platform: 'windows', lastSyncAt: '2026-10-15T08:00:00.000Z' },
      ip: '192.168.1.1',
      userAgent: 'Chrome on Windows',
      createdAt: '2026-10-15T08:00:00.000Z',
      lastUsedAt: '2026-10-15T09:00:00.000Z',
      expiresAt: '2026-11-15T08:00:00.000Z'
    }
  ];

  beforeEach(async () => {
    mockUserService = {
      getUserById: vi.fn().mockReturnValue(of(mockUser)),
      getUserSessions: vi.fn().mockReturnValue(of(mockSessions)),
      updateUser: vi.fn().mockReturnValue(of({ ...mockUser, fullName: 'Updated Name' })),
      suspendUser: vi.fn().mockReturnValue(of({ ...mockUser, status: 'SUSPENDED' })),
      reactivateUser: vi.fn().mockReturnValue(of({ ...mockUser, status: 'ACTIVE' })),
      revokeSession: vi.fn().mockReturnValue(of(undefined)),
      revokeAllSessions: vi.fn().mockReturnValue(of({ revoked: 1 })),
      extractErrorMessage: vi.fn().mockImplementation((_err, fallback) => fallback || 'Error')
    };

    await TestBed.configureTestingModule({
      imports: [UserEditComponent],
      providers: [
        { provide: UserManagementService, useValue: mockUserService },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 'user-123' })
            }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserEditComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load user profile and sessions on init', () => {
    expect(component).toBeTruthy();
    expect(mockUserService.getUserById).toHaveBeenCalledWith('user-123');
    expect(mockUserService.getUserSessions).toHaveBeenCalledWith('user-123');
    expect(component.user()?.fullName).toBe('Test User');
    expect(component.sessions().length).toBe(1);
    expect(component.editForm.get('fullName')?.value).toBe('Test User');
    expect(component.editForm.get('email')?.value).toBe('test@school.edu');
  });

  it('should validate edit form fields correctly', () => {
    component.editForm.patchValue({ fullName: '', email: 'invalid-email' });
    expect(component.editForm.invalid).toBe(true);
    expect(component.editForm.get('fullName')?.hasError('required')).toBe(true);
    expect(component.editForm.get('email')?.hasError('email')).toBe(true);

    component.editForm.patchValue({ fullName: 'Valid Name', email: 'valid@school.edu' });
    expect(component.editForm.valid).toBe(true);
  });

  it('should save edited user profile', () => {
    component.editForm.patchValue({ fullName: 'Updated Name', email: 'test@school.edu' });
    component.editForm.markAsDirty();

    component.saveProfile();

    expect(mockUserService.updateUser).toHaveBeenCalledWith('user-123', {
      fullName: 'Updated Name',
      email: 'test@school.edu'
    });
    expect(component.user()?.fullName).toBe('Updated Name');
    expect(component.successMessage()).toContain('profile updated successfully');
  });

  it('should reset form values to initial user data', () => {
    component.editForm.patchValue({ fullName: 'Modified', email: 'mod@school.edu' });
    component.resetForm();

    expect(component.editForm.get('fullName')?.value).toBe('Test User');
    expect(component.editForm.get('email')?.value).toBe('test@school.edu');
    expect(component.editForm.pristine).toBe(true);
  });

  it('should identify device icons based on platform and user agent', () => {
    expect(component.getDeviceIcon('android', '')).toBe('ti-device-mobile');
    expect(component.getDeviceIcon('ios', 'iphone')).toBe('ti-device-mobile');
    expect(component.getDeviceIcon('ipad', '')).toBe('ti-device-tablet');
    expect(component.getDeviceIcon('windows', 'Chrome')).toBe('ti-device-laptop');
  });

  it('should handle API errors and show error banner when user update fails', () => {
    mockUserService.updateUser.mockReturnValueOnce(throwError(() => new Error('Server failure')));
    component.editForm.patchValue({ fullName: 'New Name', email: 'test@school.edu' });
    component.editForm.markAsDirty();

    component.saveProfile();

    expect(component.isSaving()).toBe(false);
    expect(component.errorMessage()).toBeTruthy();
  });

  it('should open suspend modal and suspend user on confirmation, updating status badge', () => {
    component.openSuspendModal();
    expect(component.modalType()).toBe('suspend');

    component.handleModalConfirm();

    expect(mockUserService.suspendUser).toHaveBeenCalledWith('user-123');
    expect(component.user()?.status).toBe('SUSPENDED');
    expect(component.modalType()).toBeNull();
    expect(component.successMessage()).toContain('suspended');
  });

  it('should open reactivate modal and reactivate user on confirmation, updating status badge', () => {
    component.openReactivateModal();
    expect(component.modalType()).toBe('reactivate');

    component.handleModalConfirm();

    expect(mockUserService.reactivateUser).toHaveBeenCalledWith('user-123');
    expect(component.user()?.status).toBe('ACTIVE');
    expect(component.modalType()).toBeNull();
    expect(component.successMessage()).toContain('reactivated');
  });

  it('should revoke a single session on confirmation', () => {
    component.openRevokeSessionModal(mockSessions[0]);
    expect(component.modalType()).toBe('revoke-session');
    expect(component.selectedSessionToRevoke()?.id).toBe('session-1');

    component.handleModalConfirm();

    expect(mockUserService.revokeSession).toHaveBeenCalledWith('user-123', 'session-1');
    expect(component.modalType()).toBeNull();
  });

  it('should revoke all active sessions on confirmation', () => {
    component.openRevokeAllModal();
    expect(component.modalType()).toBe('revoke-all');

    component.handleModalConfirm();

    expect(mockUserService.revokeAllSessions).toHaveBeenCalledWith('user-123');
    expect(component.modalType()).toBeNull();
  });
});
