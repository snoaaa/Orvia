import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { PaginatedUsers, UserEntity } from '../models/user.model';
import { UserManagementService } from '../services/user-management.service';
import { UserListComponent } from './user-list.component';

describe('UserListComponent', () => {
  let component: UserListComponent;
  let fixture: ComponentFixture<UserListComponent>;
  let mockUserService: any;

  const mockUsers: UserEntity[] = [
    {
      id: 'user-1',
      email: 'active@school.edu',
      fullName: 'Active User',
      authProvider: 'local',
      status: 'ACTIVE',
      createdAt: '2026-10-18T10:00:00.000Z',
      updatedAt: '2026-10-18T10:00:00.000Z'
    },
    {
      id: 'user-2',
      email: 'suspended@school.edu',
      fullName: 'Suspended User',
      authProvider: 'google',
      status: 'SUSPENDED',
      createdAt: '2026-10-19T10:00:00.000Z',
      updatedAt: '2026-10-19T10:00:00.000Z'
    }
  ];

  const mockPaginated: PaginatedUsers = {
    data: mockUsers,
    total: 2,
    page: 1,
    limit: 10,
    totalPages: 1
  };

  beforeEach(async () => {
    mockUserService = {
      getUsers: vi.fn().mockImplementation((filters) => {
        if (filters?.status === 'ACTIVE' && filters?.limit === 1) {
          return of({ data: [], total: 5, page: 1, limit: 1, totalPages: 5 });
        }
        if (filters?.status === 'SUSPENDED' && filters?.limit === 1) {
          return of({ data: [], total: 2, page: 1, limit: 1, totalPages: 2 });
        }
        if (filters?.status === 'INVITED' && filters?.limit === 1) {
          return of({ data: [], total: 1, page: 1, limit: 1, totalPages: 1 });
        }
        return of(mockPaginated);
      }),
      suspendUser: vi.fn().mockReturnValue(of({ ...mockUsers[0], status: 'SUSPENDED' })),
      reactivateUser: vi.fn().mockReturnValue(of({ ...mockUsers[1], status: 'ACTIVE' })),
      extractErrorMessage: vi.fn().mockImplementation((_err, fallback) => fallback || 'Error')
    };

    await TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [
        provideRouter([]),
        { provide: UserManagementService, useValue: mockUserService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load users list and counter badges on init', () => {
    expect(component).toBeTruthy();
    expect(mockUserService.getUsers).toHaveBeenCalled();
    expect(component.users().length).toBe(2);
    expect(component.totalUsers()).toBe(2);
    expect(component.activeCount()).toBe(5);
    expect(component.suspendedCount()).toBe(2);
    expect(component.invitedCount()).toBe(1);
  });

  it('should filter users by status tab', () => {
    component.setStatusFilter('SUSPENDED');
    expect(component.selectedStatus()).toBe('SUSPENDED');
    expect(component.currentPage()).toBe(1);
    expect(mockUserService.getUsers).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUSPENDED', page: 1 })
    );
  });

  it('should toggle sort column and direction', () => {
    component.toggleSort('fullName');
    expect(component.sortBy()).toBe('fullName');
    expect(component.sortOrder()).toBe('asc');

    component.toggleSort('fullName');
    expect(component.sortBy()).toBe('fullName');
    expect(component.sortOrder()).toBe('desc');
  });

  it('should clear search term and reset to page 1', () => {
    component.searchTerm.set('test query');
    component.clearSearch();
    expect(component.searchTerm()).toBe('');
    expect(component.currentPage()).toBe(1);
  });

  it('should paginate correctly within boundary limits', () => {
    component.goToPage(2);
    // totalPages is 1 in mock, so page should not exceed totalPages
    expect(component.currentPage()).toBe(1);
  });

  it('should trigger suspend modal and suspend user, updating user in list immediately', () => {
    const fakeEvent = { stopPropagation: vi.fn() } as unknown as Event;
    component.openSuspendModal(mockUsers[0], fakeEvent);

    expect(component.modalAction()).toBe('suspend');
    expect(component.targetUser()?.id).toBe('user-1');

    component.confirmModalAction();

    expect(mockUserService.suspendUser).toHaveBeenCalledWith('user-1');
    const updatedUser = component.users().find((u) => u.id === 'user-1');
    expect(updatedUser?.status).toBe('SUSPENDED');
    expect(component.modalAction()).toBeNull();
  });

  it('should trigger reactivate modal and reactivate user, updating user in list immediately', () => {
    const fakeEvent = { stopPropagation: vi.fn() } as unknown as Event;
    component.openReactivateModal(mockUsers[1], fakeEvent);

    expect(component.modalAction()).toBe('reactivate');
    expect(component.targetUser()?.id).toBe('user-2');

    component.confirmModalAction();

    expect(mockUserService.reactivateUser).toHaveBeenCalledWith('user-2');
    const updatedUser = component.users().find((u) => u.id === 'user-2');
    expect(updatedUser?.status).toBe('ACTIVE');
    expect(component.modalAction()).toBeNull();
  });
});
