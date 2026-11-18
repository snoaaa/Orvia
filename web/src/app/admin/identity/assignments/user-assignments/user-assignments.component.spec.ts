import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { GoeyToastService } from 'goey-toast-angular';
import { UserAssignment } from '../models/assignment.model';
import { AssignmentService } from '../services/assignment.service';
import { UserAssignmentsComponent } from './user-assignments.component';

describe('UserAssignmentsComponent', () => {
  let fixture: ComponentFixture<UserAssignmentsComponent>;
  let component: UserAssignmentsComponent;
  let service: any;
  let toast: any;

  const assignments: UserAssignment[] = [
    { id: 'as-1', schoolId: 's1', schoolName: 'School A', role: 'STAFF', groupId: 'g1', groupName: 'ISI 4' },
    { id: 'as-2', schoolId: 's2', schoolName: 'School B', role: 'STUDENT', groupId: null, groupName: null }
  ];

  async function setup(permissions: string[]) {
    service = {
      getCurrentAdmin: vi.fn().mockReturnValue(of({ id: 'me', permissions, isPlatformAdmin: false })),
      removeAssignment: vi.fn().mockReturnValue(of(undefined)),
      getSchools: vi.fn().mockReturnValue(of([
        { id: 's1', name: 'School A' },
        { id: 's2', name: 'School B' },
        { id: 's3', name: 'School C' }
      ])),
      getGroups: vi.fn().mockImplementation((schoolId: string) =>
        of([{ id: `g-${schoolId}`, schoolId, name: `Group of ${schoolId}`, type: 'class' }])
      ),
      getAssignableRoles: vi.fn().mockReturnValue(of([
        { id: 'r1', name: 'STAFF', scope: 'school', level: 2 },
        { id: 'r2', name: 'ADMIN', scope: 'platform', level: 3 }
      ])),
      createAssignment: vi.fn().mockReturnValue(of({})),
      updateAssignment: vi.fn().mockReturnValue(of({})),
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

  describe('create form', () => {
    beforeEach(async () => {
      await setup(['users:assign_role']);
      component.openCreateForm();
    });

    it('offers only schools where the user has no assignment yet', () => {
      expect(component.availableSchools().map((s) => s.id)).toEqual(['s3']);
    });

    it('reloads groups and roles for the chosen school, and again when the school changes', () => {
      component.form.controls.schoolId.setValue('s3');
      expect(service.getGroups).toHaveBeenCalledWith('s3');
      expect(service.getAssignableRoles).toHaveBeenCalledWith('s3');
      expect(component.groups().map((g) => g.id)).toEqual(['g-s3']);

      component.form.patchValue({ groupId: 'g-s3', role: 'STAFF' });
      component.form.controls.schoolId.setValue('s9');
      expect(service.getGroups).toHaveBeenLastCalledWith('s9');
      expect(component.groups().map((g) => g.id)).toEqual(['g-s9']);
      // the previous group and role no longer apply to the new school
      expect(component.form.controls.groupId.value).toBe('');
      expect(component.form.controls.role.value).toBe('');
    });

    it('creates the assignment with the selected school, group and role', () => {
      const changed = vi.fn();
      component.changed.subscribe(changed);
      component.form.controls.schoolId.setValue('s3');
      component.form.patchValue({ groupId: 'g-s3', role: 'STAFF' });

      component.submit();

      expect(service.createAssignment).toHaveBeenCalledWith({
        userId: 'user-1',
        schoolId: 's3',
        role: 'STAFF',
        groupId: 'g-s3'
      });
      expect(toast.success).toHaveBeenCalled();
      expect(changed).toHaveBeenCalled();
      expect(component.formMode()).toBeNull();
    });

    it('omits the group when none is selected', () => {
      component.form.controls.schoolId.setValue('s3');
      component.form.patchValue({ role: 'STAFF' });
      component.submit();
      expect(service.createAssignment).toHaveBeenCalledWith({ userId: 'user-1', schoolId: 's3', role: 'STAFF' });
    });

    it('does not submit an incomplete form', () => {
      component.submit();
      expect(service.createAssignment).not.toHaveBeenCalled();
    });

    it('clears and locks the group for a platform role', () => {
      component.form.controls.schoolId.setValue('s3');
      component.form.patchValue({ groupId: 'g-s3', role: 'ADMIN' });
      expect(component.groupDisabled).toBe(true);
      component.onRoleChange();
      expect(component.form.controls.groupId.value).toBe('');
    });

    it('shows the API message in a toast on a 409 and keeps the form open', () => {
      service.createAssignment.mockReturnValue(throwError(() => new Error('409')));
      service.extractErrorMessage.mockReturnValue('The user already has an assignment in this school');
      component.form.controls.schoolId.setValue('s3');
      component.form.patchValue({ role: 'STAFF' });

      component.submit();

      expect(toast.error).toHaveBeenCalledWith('Assignment Failed', {
        description: 'The user already has an assignment in this school'
      });
      expect(component.formMode()).toBe('create');
      expect(component.isSaving()).toBe(false);
    });

    it('toasts when the schools cannot be loaded', () => {
      service.getSchools.mockReturnValue(throwError(() => new Error('403')));
      service.extractErrorMessage.mockReturnValue('Forbidden');
      component.openCreateForm();
      expect(toast.error).toHaveBeenCalledWith('Could Not Load Schools', { description: 'Forbidden' });
    });
  });

  describe('edit form', () => {
    beforeEach(async () => {
      await setup(['users:assign_role']);
      component.openEditForm(assignments[0]);
    });

    it('locks the school and prefills role and group', () => {
      expect(component.form.controls.schoolId.disabled).toBe(true);
      expect(component.form.getRawValue()).toEqual({ schoolId: 's1', groupId: 'g1', role: 'STAFF' });
      expect(service.getAssignableRoles).toHaveBeenCalledWith('s1');
    });

    it('needs a change before saving', () => {
      expect(component.hasChanges()).toBe(false);
      component.submit();
      expect(service.updateAssignment).not.toHaveBeenCalled();
    });

    it('sends only the changed field', () => {
      component.form.patchValue({ groupId: '' });
      component.submit();
      expect(service.updateAssignment).toHaveBeenCalledWith('as-1', { groupId: null });
    });

    it('sends the new role without touching the group', () => {
      component.form.patchValue({ role: 'ADMIN' });
      component.submit();
      expect(service.updateAssignment).toHaveBeenCalledWith('as-1', { role: 'ADMIN' });
    });

    it('shows the API message in a toast when the update is refused (403)', () => {
      service.updateAssignment.mockReturnValue(throwError(() => new Error('403')));
      service.extractErrorMessage.mockReturnValue('You cannot assign a role above your level');
      component.form.patchValue({ role: 'ADMIN' });
      component.submit();
      expect(toast.error).toHaveBeenCalledWith('Update Failed', {
        description: 'You cannot assign a role above your level'
      });
    });
  });

  it('does not remove when the modal is cancelled', async () => {
    await setup(['users:assign_role']);
    component.openRemoveModal(assignments[0]);
    component.closeModal();
    expect(component.removeTarget()).toBeNull();
    expect(service.removeAssignment).not.toHaveBeenCalled();
  });
});
