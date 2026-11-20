import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { ConversationsService } from './conversations.service.js';

describe('ConversationsService (#123)', () => {
  let service: ConversationsService;
  let mockPrisma: {
    conversation: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    message: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };

  const student: AuthenticatedUser = {
    id: 'user-student-1',
    email: 'student@school.edu',
    fullName: 'Student One',
    status: 'ACTIVE',
    assignments: [],
    permissions: ['conversations:read'],
    schoolIds: ['school-1'],
    isPlatformAdmin: false,
    role: 'STUDENT',
    schoolId: 'school-1',
    sessionId: 'sess-1',
  };

  const platformAdmin: AuthenticatedUser = {
    ...student,
    id: 'user-platform-admin',
    email: 'admin@orvia.internal',
    isPlatformAdmin: true,
    role: 'PLATFORM_ADMIN',
    permissions: ['*'],
    schoolIds: [],
    schoolId: null,
  };

  beforeEach(() => {
    mockPrisma = {
      conversation: {
        count: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
      message: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    service = new ConversationsService(mockPrisma as unknown as PrismaService);
  });

  describe('findAll', () => {
    it('scopes to the caller userId (even for platform admin), excludes soft-deleted, orders newest first', async () => {
      mockPrisma.conversation.count.mockResolvedValueOnce(1);
      mockPrisma.conversation.findMany.mockResolvedValueOnce([
        {
          id: 'conv-1',
          userId: platformAdmin.id,
          spaceId: 'space-1',
          title: 'My Own Admin Chat',
          createdAt: new Date('2026-11-20T10:00:00Z'),
          updatedAt: new Date('2026-11-20T10:05:00Z'),
          space: { name: 'Math Space' },
          _count: { messages: 2 },
        },
      ]);

      const result = await service.findAll(platformAdmin, { page: 1, limit: 10 });

      expect(mockPrisma.conversation.count).toHaveBeenCalledWith({
        where: { userId: platformAdmin.id, deletedAt: null },
      });
      expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: platformAdmin.id, deletedAt: null },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          skip: 0,
          take: 10,
        }),
      );
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.data[0]).toMatchObject({
        id: 'conv-1',
        spaceName: 'Math Space',
        messageCount: 2,
      });
    });

    it('applies spaceId, q filter, and caps limit at 100', async () => {
      mockPrisma.conversation.count.mockResolvedValueOnce(0);
      mockPrisma.conversation.findMany.mockResolvedValueOnce([]);

      const result = await service.findAll(student, {
        page: 2,
        limit: 500,
        spaceId: 'space-9',
        q: 'algebra',
      });

      expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: student.id,
            deletedAt: null,
            spaceId: 'space-9',
            title: { contains: 'algebra' },
          },
          skip: 100,
          take: 100,
        }),
      );
      expect(result.limit).toBe(100);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('findById', () => {
    it('throws NotFoundException if conversation does not exist or is soft-deleted', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValueOnce(null);
      await expect(service.findById('conv-missing', student)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when another user (even platform admin) requests someone else’s conversation', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValueOnce({
        id: 'conv-1',
        userId: student.id,
        spaceId: 'space-1',
        title: 'Private Chat',
        messages: [],
      });

      await expect(service.findById('conv-1', platformAdmin)).rejects.toThrow(NotFoundException);
    });

    it('returns conversation detail with chronological messages and citation availability', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValueOnce({
        id: 'conv-1',
        userId: student.id,
        spaceId: 'space-1',
        title: 'Calculus Help',
        createdAt: new Date('2026-11-20T09:00:00Z'),
        updatedAt: new Date('2026-11-20T09:01:00Z'),
        space: { name: 'Math' },
        messages: [
          {
            id: 'msg-1',
            conversationId: 'conv-1',
            role: 'user',
            content: 'What is a derivative?',
            modelUsed: 'default',
            parameters: null,
            status: 'completed',
            references: [],
            createdAt: new Date('2026-11-20T09:00:00Z'),
            updatedAt: new Date('2026-11-20T09:00:00Z'),
          },
          {
            id: 'msg-2',
            conversationId: 'conv-1',
            role: 'assistant',
            content: 'A derivative measures rate of change [1][2].',
            modelUsed: 'mock-rag',
            parameters: { temperature: 0.2 },
            status: 'completed',
            references: [
              {
                id: 'ref-1',
                documentVersionId: 'ver-1',
                pageOrImageId: 'page_3',
                excerpt: 'Rate of change excerpt',
                coordinates: '{"x1":10}',
                documentVersion: {
                  id: 'ver-1',
                  documentId: 'doc-1',
                  versionNo: 2,
                  status: 'available',
                  document: { title: 'Calculus Textbook', deletedAt: null },
                },
              },
              {
                id: 'ref-2',
                documentVersionId: 'ver-2',
                pageOrImageId: 'page_1',
                excerpt: 'Deleted doc excerpt',
                coordinates: null,
                documentVersion: {
                  id: 'ver-2',
                  documentId: 'doc-2',
                  versionNo: 1,
                  status: 'available',
                  document: { title: 'Old Syllabus', deletedAt: new Date('2026-11-19T00:00:00Z') },
                },
              },
            ],
            createdAt: new Date('2026-11-20T09:01:00Z'),
            updatedAt: new Date('2026-11-20T09:01:00Z'),
          },
        ],
      });

      const detail = await service.findById('conv-1', student);

      expect(detail.id).toBe('conv-1');
      expect(detail.spaceName).toBe('Math');
      expect(detail.messages).toHaveLength(2);
      expect(detail.messages[1].citations).toEqual([
        expect.objectContaining({
          id: 'ref-1',
          documentId: 'doc-1',
          versionId: 'ver-1',
          documentName: 'Calculus Textbook',
          versionNumber: 2,
          pageOrImageId: 'page_3',
          excerpt: 'Rate of change excerpt',
          coordinates: '{"x1":10}',
          available: true,
        }),
        expect.objectContaining({
          id: 'ref-2',
          documentId: 'doc-2',
          available: false,
        }),
      ]);
    });
  });

  describe('findMessages', () => {
    it('throws NotFoundException if conversation does not belong to actor', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-1', userId: 'other-user' });
      await expect(service.findMessages('conv-1', student)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
    });

    it('returns messages ordered chronologically with citations', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-1', userId: student.id });
      mockPrisma.message.findMany.mockResolvedValueOnce([
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'user',
          content: 'Hello',
          modelUsed: 'default',
          parameters: null,
          status: 'completed',
          references: [],
          createdAt: new Date('2026-11-20T09:00:00Z'),
          updatedAt: new Date('2026-11-20T09:00:00Z'),
        },
      ]);

      const messages = await service.findMessages('conv-1', student);
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('msg-1');
    });
  });

  describe('rename (#124)', () => {
    it('renames an owned conversation using conditional updateMany', async () => {
      mockPrisma.conversation.findFirst
        .mockResolvedValueOnce({ id: 'conv-1', userId: student.id })
        .mockResolvedValueOnce({
          id: 'conv-1',
          userId: student.id,
          spaceId: 'space-1',
          title: 'New Title',
          createdAt: new Date('2026-11-20T09:00:00Z'),
          updatedAt: new Date('2026-11-20T09:05:00Z'),
          space: { name: 'Math' },
          _count: { messages: 2 },
        });
      mockPrisma.conversation.updateMany.mockResolvedValueOnce({ count: 1 });

      const updated = await service.rename('conv-1', { title: 'New Title' }, student);

      expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: 'conv-1', userId: student.id, deletedAt: null },
        data: { title: 'New Title' },
      });
      expect(updated.title).toBe('New Title');
      expect(updated.messageCount).toBe(2);
    });

    it('throws NotFoundException when renaming another user’s conversation or missing conversation', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-1', userId: student.id });
      await expect(service.rename('conv-1', { title: 'Hack' }, platformAdmin)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.conversation.updateMany).not.toHaveBeenCalled();

      mockPrisma.conversation.findFirst.mockResolvedValueOnce(null);
      await expect(service.rename('conv-missing', { title: 'Nope' }, student)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when deleted concurrently before updateMany (count === 0)', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-1', userId: student.id });
      mockPrisma.conversation.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.rename('conv-1', { title: 'Race' }, student)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (#124)', () => {
    it('soft-deletes an owned conversation conditionally', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-1', userId: student.id });
      mockPrisma.conversation.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.remove('conv-1', student);

      expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: 'conv-1', userId: student.id, deletedAt: null },
        data: { deletedAt: expect.any(Date), updatedAt: expect.any(Date) },
      });
    });

    it('throws NotFoundException when deleting another user’s, missing, or concurrently deleted conversation', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-1', userId: student.id });
      await expect(service.remove('conv-1', platformAdmin)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.conversation.updateMany).not.toHaveBeenCalled();

      mockPrisma.conversation.findFirst.mockResolvedValueOnce({ id: 'conv-1', userId: student.id });
      mockPrisma.conversation.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.remove('conv-1', student)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMessageStatus (#122)', () => {
    it.each([
      ['pending', 'pending', false, false],
      ['generating', 'generating', false, false],
      ['streaming', 'generating', false, false],
      ['done', 'done', true, true],
      ['completed', 'done', true, true],
      ['failed', 'failed', false, false],
    ])('maps stored status %s -> %s (ready=%s, answer=%s)', async (stored, expectedStatus, expectedReady, hasAnswer) => {
      mockPrisma.message.findFirst.mockResolvedValueOnce({
        id: 'msg-1',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'Answer text',
        modelUsed: 'mock-rag-v1',
        parameters: null,
        status: stored,
        references: [],
        ragMetric: stored === 'failed' ? { errorCode: 'RAG_TIMEOUT' } : null,
        conversation: { userId: student.id },
        createdAt: new Date('2026-11-21T00:00:00Z'),
        updatedAt: new Date('2026-11-21T00:00:05Z'),
      });

      const res = await service.getMessageStatus('conv-1', 'msg-1', student);

      expect(res.status).toBe(expectedStatus);
      expect(res.ready).toBe(expectedReady);
      expect(res.errorCode).toBe(stored === 'failed' ? 'RAG_TIMEOUT' : null);
      if (hasAnswer) {
        expect(res.answer).toMatchObject({ id: 'msg-1', content: 'Answer text' });
      } else {
        expect(res.answer).toBeNull();
      }
    });

    it('throws NotFoundException when polling missing message or another user’s message', async () => {
      mockPrisma.message.findFirst.mockResolvedValueOnce(null);
      await expect(service.getMessageStatus('conv-1', 'msg-missing', student)).rejects.toThrow(NotFoundException);

      mockPrisma.message.findFirst.mockResolvedValueOnce({
        id: 'msg-1',
        conversationId: 'conv-1',
        status: 'done',
        conversation: { userId: student.id },
        references: [],
      });
      await expect(service.getMessageStatus('conv-1', 'msg-1', platformAdmin)).rejects.toThrow(NotFoundException);
    });
  });
});
