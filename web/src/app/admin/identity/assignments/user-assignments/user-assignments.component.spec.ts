import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { GoeyToastService } from 'goey-toast-angular';
import { UserSchoolAssignment } from '../../users/models/user.model';
import { AssignmentService } from '../services/assignment.service';
import { UserAssignmentsComponent } from './user-assignments.component';

describe('UserAssignmentsComponent', () => {
  let fixture: ComponentFixture<UserAssignmentsComponent>;
  let component: UserAssignmentsComponent;
  let service: any;
  let toast: any;

  const assignments: UserSchoolAssignment[] = [
    { id: 'as-1', schoolId: 's1', schoolName: 'School A', role: 'STAFF', groupId: 'g1', groupName: 'ISI 4' },
    { id: 'as-2', schoolId: 's2', schoolName: 'School B', role: 'STUDENT', groupId: null, groupName: null }
  ];

  async function setup(permissions: string[]) {
    service = {
      getCurrentAdmin: vi.fn().mockReturnValue(of({ id: 'me', permissions, isPlatformAdmin: false })),
      removeAssignment: vi.fn().mockReturnValue(of(undefined)),
      extractErrorMessage: vi.fn().mockImplementation((_e, fallback) => fallback)
    };
    toast = { success: vi.fn(), error: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [UserAssignmentsComponent],
      providers: [
        { provide: AssignmentService, useValue: service },
        { provide: GoeyToastService, useValue: toast }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserAssignmentsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('assignments', assignments);
    fixture.detectChanges();
  }

  it('lists the assignments when the admin holds users:assign_role', async () => {
    await setup(['users:assign_role']);
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('School A');
    expect(rows[0].textContent).toContain('ISI 4');
    expect(rows[1].textContent).toContain('—');
  });

  it('hides the card without users:assign_role', async () => {
    await setup(['users:read']);
    expect(component.canManage()).toBe(false);
    expect(fixture.nativeElement.querySelector('app-card')).toBeNull();
  });

  it('hides the card when /auth/me fails', async () => {
    service = undefined;
    await TestBed.configureTestingModule({
      imports: [UserAssignmentsComponent],
      providers: [
        {
          provide: AssignmentService,
          useValue: { getCurrentAdmin: () => throwError(() => new Error('x')) }
        },
        { provide: GoeyToastService, useValue: { success: vi.fn(), error: vi.fn() } }
      ]
    }).compileComponents();
    const f = TestBed.createComponent(UserAssignmentsComponent);
    f.componentRef.setInput('userId', 'user-1');
    f.detectChanges();
    expect(f.componentInstance.canManage()).toBe(false);
  });

  it('removes an assignment after confirmation and notifies the parent', async () => {
    await setup(['users:assign_role']);
    const changed = vi.fn();
    component.changed.subscribe(changed);

    component.openRemoveModal(assignments[0]);
    expect(component.removeTarget()).toEqual(assignments[0]);
    component.confirmRemove();

    expect(service.removeAssignment).toHaveBeenCalledWith('as-1');
    expect(toast.success).toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();
    expect(component.removeTarget()).toBeNull();
  });

  it('shows the API message in a toast when removal fails (409 last school admin)', async () => {
    await setup(['users:assign_role']);
    service.removeAssignment.mockReturnValue(throwError(() => new Error('409')));
    service.extractErrorMessage.mockReturnValue('The last school administrator cannot be removed');
    const changed = vi.fn();
    component.changed.subscribe(changed);

    component.openRemoveModal(assignments[0]);
    component.confirmRemove();

    expect(toast.error).toHaveBeenCalledWith('Removal Failed', {
      description: 'The last school administrator cannot be removed'
    });
    expect(changed).not.toHaveBeenCalled();
  });

  it('does not remove when the modal is cancelled', async () => {
    await setup(['users:assign_role']);
    component.openRemoveModal(assignments[0]);
    component.closeModal();
    expect(component.removeTarget()).toBeNull();
    expect(service.removeAssignment).not.toHaveBeenCalled();
  });
});
