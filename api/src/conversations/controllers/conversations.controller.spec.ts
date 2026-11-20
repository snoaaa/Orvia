import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { PaginatedConversationsEntity } from '../entities/paginated-conversations.entity.js';
import { ConversationDetailEntity } from '../entities/conversation-detail.entity.js';
import type { ConversationsService } from '../services/conversations.service.js';
import { ConversationsController } from './conversations.controller.js';

describe('ConversationsController (#123)', () => {
  let controller: ConversationsController;
  let mockService: {
    findAll: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findMessages: ReturnType<typeof vi.fn>;
  };

  const actor: AuthenticatedUser = {
    id: 'user-1',
    email: 'user@school.edu',
    fullName: 'User One',
    status: 'ACTIVE',
    assignments: [],
    permissions: ['conversations:read'],
    schoolIds: ['school-1'],
    isPlatformAdmin: false,
    role: 'STUDENT',
    schoolId: 'school-1',
    sessionId: 'sess-1',
  };

  beforeEach(() => {
    mockService = {
      findAll: vi.fn(),
      findById: vi.fn(),
      findMessages: vi.fn(),
    };
    controller = new ConversationsController(mockService as unknown as ConversationsService);
  });

  it('delegates getConversations to service.findAll with actor and query', async () => {
    const expected = new PaginatedConversationsEntity({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
    mockService.findAll.mockResolvedValueOnce(expected);

    const res = await controller.getConversations({ page: 1, limit: 10 }, actor);
    expect(mockService.findAll).toHaveBeenCalledWith(actor, { page: 1, limit: 10 });
    expect(res).toBe(expected);
  });

  it('delegates getConversationById to service.findById with id and actor', async () => {
    const expected = new ConversationDetailEntity({ id: 'conv-1', messages: [] });
    mockService.findById.mockResolvedValueOnce(expected);

    const res = await controller.getConversationById('conv-1', actor);
    expect(mockService.findById).toHaveBeenCalledWith('conv-1', actor);
    expect(res).toBe(expected);
  });

  it('delegates getMessages to service.findMessages with id and actor', async () => {
    mockService.findMessages.mockResolvedValueOnce([]);

    const res = await controller.getMessages('conv-1', actor);
    expect(mockService.findMessages).toHaveBeenCalledWith('conv-1', actor);
    expect(res).toEqual([]);
  });
});
