import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateConversationDto, CreateMessageDto, ListConversationsQueryDto, ReportAnswerDto, SaveAnswerDto } from '../dto/index.js';
import {
  AnswerReportEntity,
  ConversationDetailEntity,
  ConversationEntity,
  MessageEntity,
  PaginatedConversationsEntity,
  SavedAnswerEntity,
} from '../entities/index.js';
import { ConversationMapper, MessageMapper } from '../mappers/index.js';

const MESSAGE_INCLUDE = {
  references: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] as Prisma.MessageReferenceOrderByWithRelationInput[],
    include: {
      documentVersion: {
        select: {
          id: true,
          documentId: true,
          versionNo: true,
          status: true,
          document: {
            select: {
              title: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.MessageInclude;

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists only the signed-in user's active conversations (#123), newest first (`updatedAt DESC, createdAt DESC, id DESC`),
   * paginated with the shared `page`/`limit` contract (`limit` capped at 100).
   */
  async findAll(actor: AuthenticatedUser, query?: ListConversationsQueryDto): Promise<PaginatedConversationsEntity> {
    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 10));
    const skip = (page - 1) * limit;

    const where: Prisma.ConversationWhereInput = {
      userId: actor.id,
      deletedAt: null,
      ...(query?.spaceId ? { spaceId: query.spaceId } : {}),
      ...(query?.q ? { title: { contains: query.q } } : {}),
    };

    const [total, conversations] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        include: {
          space: { select: { name: true } },
          _count: { select: { messages: { where: { deletedAt: null } } } },
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return new PaginatedConversationsEntity({
      data: conversations.map((c) => ConversationMapper.toEntity(c)),
      total,
      page,
      limit,
      totalPages,
    });
  }

  /**
   * Returns one conversation owned by `actor` with its chronological messages and citations (#123).
   * Returns 404 if the conversation does not exist, is soft-deleted, or belongs to another user (prevents IDOR enumeration).
   */
  async findById(id: string, actor: AuthenticatedUser): Promise<ConversationDetailEntity> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, deletedAt: null },
      include: {
        space: { select: { name: true } },
        messages: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: MESSAGE_INCLUDE,
        },
      },
    });

    if (!conversation || conversation.userId !== actor.id) {
      throw new NotFoundException(`Conversation with ID ${id} not found`);
    }

    return ConversationMapper.toDetailEntity(conversation);
  }

  /**
   * Returns the chronological messages and citations of a conversation owned by `actor` (#123).
   * Returns 404 if the conversation does not exist, is soft-deleted, or belongs to another user.
   */
  async findMessages(conversationId: string, actor: AuthenticatedUser): Promise<MessageEntity[]> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: { id: true, userId: true },
    });

    if (!conversation || conversation.userId !== actor.id) {
      throw new NotFoundException(`Conversation with ID ${conversationId} not found`);
    }

    const messages = await this.prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: MESSAGE_INCLUDE,
    });

    return messages.map((m) => MessageMapper.toEntity(m));
  }

  async create(dto: CreateConversationDto): Promise<ConversationEntity> {
    const id = randomUUID();
    return ConversationMapper.fromDtoToCreateInput(dto, id);
  }

  async addMessage(conversationId: string, dto: CreateMessageDto): Promise<MessageEntity> {
    const id = randomUUID();
    return MessageMapper.fromDtoToCreateInput(dto, id, conversationId);
  }

  async saveAnswer(dto: SaveAnswerDto): Promise<SavedAnswerEntity> {
    return new SavedAnswerEntity({
      id: randomUUID(),
      userId: dto.userId,
      messageId: dto.messageId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async reportAnswer(dto: ReportAnswerDto): Promise<AnswerReportEntity> {
    return new AnswerReportEntity({
      id: randomUUID(),
      userId: dto.userId,
      messageId: dto.messageId,
      reason: dto.reason,
      feedback: dto.feedback || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
