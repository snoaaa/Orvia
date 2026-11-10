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
      findAllGroups: vi.fn(),
      findGroupById: vi.fn(),
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

  it('delegates getGroups to groupsService.findAllGroups with optional schoolId', async () => {
    mockGroupsService.findAllGroups.mockResolvedValueOnce([{ id: 'group-1', name: 'Class 10-A' }]);

    const result = await controller.getGroups('school-a', mockActor);
    expect(mockGroupsService.findAllGroups).toHaveBeenCalledWith(mockActor, 'school-a');
    expect(result).toHaveLength(1);
  });

  it('delegates getGroupById to groupsService.findGroupById', async () => {
    mockGroupsService.findGroupById.mockResolvedValueOnce({ id: 'group-1', name: 'Class 10-A' });

    const result = await controller.getGroupById('group-1', mockActor);
    expect(mockGroupsService.findGroupById).toHaveBeenCalledWith('group-1', mockActor);
    expect(result.id).toBe('group-1');
  });
});
