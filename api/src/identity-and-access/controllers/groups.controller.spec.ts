import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { GroupsService } from '../services/groups.service.js';
import { GroupsController } from './groups.controller.js';

describe('GroupsController (#89)', () => {
  let controller: GroupsController;
  let mockGroupsService: any;

  const mockActor: AuthenticatedUser = {
    id: 'user-admin',
    sessionId: 'session-1',
    email: 'admin@school-a.edu',
    fullName: 'School Admin',
    status: 'ACTIVE',
    isPlatformAdmin: false,
    permissions: ['groups:create', 'groups:read'],
    schoolIds: ['school-a'],
    assignments: [
      {
        role: 'SCHOOL_ADMIN',
        scope: 'school',
        schoolId: 'school-a',
        schoolStatus: 'active',
        groupId: null,
        permissions: ['groups:create', 'groups:read'],
      },
    ],
  };

  beforeEach(() => {
    mockGroupsService = {
      createGroup: vi.fn(),
      listGroups: vi.fn(),
      getGroup: vi.fn(),
    };
    controller = new GroupsController(mockGroupsService as unknown as GroupsService);
  });

  it('delegates createGroup to groupsService.createGroup', async () => {
    const dto = { schoolId: 'school-a', name: 'Class 10-A' };
    mockGroupsService.createGroup.mockResolvedValueOnce({ id: 'group-1', ...dto });

    const result = await controller.createGroup(dto, mockActor);
    expect(mockGroupsService.createGroup).toHaveBeenCalledWith(dto, mockActor);
    expect(result.id).toBe('group-1');
  });

  it('delegates listGroups to groupsService.listGroups with the query', async () => {
    const page = { data: [{ id: 'group-1', name: 'Class 10-A' }], total: 1, page: 1, limit: 10, totalPages: 1 };
    mockGroupsService.listGroups.mockResolvedValueOnce(page);

    const result = await controller.listGroups({ schoolId: 'school-a' }, mockActor);
    expect(mockGroupsService.listGroups).toHaveBeenCalledWith(mockActor, { schoolId: 'school-a' });
    expect(result.data).toHaveLength(1);
  });

  it('delegates getGroup to groupsService.getGroup', async () => {
    mockGroupsService.getGroup.mockResolvedValueOnce({ id: 'group-1', name: 'Class 10-A' });

    const result = await controller.getGroup('group-1', mockActor);
    expect(mockGroupsService.getGroup).toHaveBeenCalledWith('group-1', mockActor);
    expect(result.id).toBe('group-1');
  });
});
