import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import { isDocumentVisibleTo } from '../../documents/utils/document-visibility.util.js';
import type {
  CreateConversationDto,
  CreateMessageDto,
  ListConversationsQueryDto,
  ListReportsQueryDto,
  ListSavedAnswersQueryDto,
  ReportAnswerDto,
  SaveAnswerDto,
  UpdateConversationDto,
} from '../dto/index.js';
import {
  AnswerReportEntity,
  ConversationDetailEntity,
  ConversationEntity,
  MessageCitationEntity,
  MessageEntity,
  MessageGenerationStatusEntity,
  normalizeGenerationStatus,
  PaginatedAnswerReportsEntity,
  PaginatedConversationsEntity,
  PaginatedSavedAnswersEntity,
  SavedAnswerEntity,
  ShareAnswerResultEntity,
  SharedAnswerViewEntity,
} from '../entities/index.js';
import { ConversationMapper, MessageMapper } from '../mappers/index.js';
import { signShareToken, verifyShareToken } from '../utils/share-token.util.js';

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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  private getShareSecret(): string {
    return (
      this.configService?.get<string>('JWT_ACCESS_SECRET') ??
      process.env.JWT_ACCESS_SECRET ??
      'wamdp-dev-only-secret-change-me'
    );
  }

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

  /**
   * Renames a conversation owned by `actor` (#124).
   * Uses a conditional `updateMany` so a concurrent soft delete wins instead of resurrecting or modifying a deleted row.
   */
  async rename(id: string, dto: UpdateConversationDto, actor: AuthenticatedUser): Promise<ConversationEntity> {
    const existing = await this.prisma.conversation.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!existing || existing.userId !== actor.id) {
      throw new NotFoundException(`Conversation with ID ${id} not found`);
    }

    const { count } = await this.prisma.conversation.updateMany({
      where: { id, userId: actor.id, deletedAt: null },
      data: { title: dto.title },
    });
    if (count === 0) {
      throw new NotFoundException(`Conversation with ID ${id} not found`);
    }

    const updated = await this.prisma.conversation.findFirst({
      where: { id, userId: actor.id, deletedAt: null },
      include: {
        space: { select: { name: true } },
        _count: { select: { messages: { where: { deletedAt: null } } } },
      },
    });
    if (!updated) {
      throw new NotFoundException(`Conversation with ID ${id} not found`);
    }

    return ConversationMapper.toEntity(updated);
  }

  /**
   * Soft-deletes a conversation owned by `actor` (#124).
   * Conditional on `deletedAt: null` so concurrent or repeated deletes return 404 cleanly.
   */
  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.prisma.conversation.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!existing || existing.userId !== actor.id) {
      throw new NotFoundException(`Conversation with ID ${id} not found`);
    }

    const deletedAt = new Date();
    const { count } = await this.prisma.conversation.updateMany({
      where: { id, userId: actor.id, deletedAt: null },
      data: { deletedAt, updatedAt: deletedAt },
    });
    if (count === 0) {
      throw new NotFoundException(`Conversation with ID ${id} not found`);
    }
  }

  /**
   * Returns the generation status of a message owned by `actor` (#122) for polling.
   * Only returns the full answer with citations once status is `done`; returns 404 for unknown,
   * soft-deleted, or another user's conversation/message.
   */
  async getMessageStatus(
    conversationId: string,
    messageId: string,
    actor: AuthenticatedUser,
  ): Promise<MessageGenerationStatusEntity> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        conversationId,
        deletedAt: null,
        conversation: { deletedAt: null },
      },
      include: {
        conversation: { select: { userId: true } },
        ragMetric: { select: { errorCode: true } },
        ...MESSAGE_INCLUDE,
      },
    });

    if (!message || message.conversation.userId !== actor.id) {
      throw new NotFoundException(`Message with ID ${messageId} not found`);
    }

    const status = normalizeGenerationStatus(message.status);
    const ready = status === 'done';

    return new MessageGenerationStatusEntity({
      messageId: message.id,
      conversationId: message.conversationId,
      status,
      ready,
      modelUsed: message.modelUsed,
      errorCode: status === 'failed' ? (message.ragMetric?.errorCode ?? null) : null,
      updatedAt: message.updatedAt,
      answer: ready ? MessageMapper.toEntity(message) : null,
    });
  }

  async create(dto: CreateConversationDto): Promise<ConversationEntity> {
    const id = randomUUID();
    return ConversationMapper.fromDtoToCreateInput(dto, id);
  }

  async addMessage(conversationId: string, dto: CreateMessageDto): Promise<MessageEntity> {
    const id = randomUUID();
    return MessageMapper.fromDtoToCreateInput(dto, id, conversationId);
  }

  /**
   * Bookmarks a completed assistant answer owned by `actor` (#125). Idempotent if already saved.
   */
  async saveAnswer(dto: SaveAnswerDto, actor: AuthenticatedUser): Promise<SavedAnswerEntity> {
    const message = await this.prisma.message.findFirst({
      where: { id: dto.messageId, deletedAt: null, conversation: { deletedAt: null } },
      include: {
        conversation: { select: { id: true, userId: true, title: true } },
        ...MESSAGE_INCLUDE,
      },
    });
    if (!message || message.conversation.userId !== actor.id) {
      throw new NotFoundException(`Message with ID ${dto.messageId} not found`);
    }
    if (message.role !== 'assistant' || normalizeGenerationStatus(message.status) !== 'done') {
      throw new BadRequestException('Only completed assistant answers can be saved');
    }

    const existing = await this.prisma.savedAnswer.findFirst({
      where: { userId: actor.id, messageId: dto.messageId },
    });
    const record =
      existing ??
      (await this.prisma.savedAnswer.create({
        data: { userId: actor.id, messageId: dto.messageId },
      }));

    return new SavedAnswerEntity({
      id: record.id,
      userId: record.userId,
      messageId: record.messageId,
      conversationId: message.conversation.id,
      conversationTitle: message.conversation.title,
      message: MessageMapper.toEntity(message),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  /** Lists the caller's saved answers, newest first (#125). */
  async findSavedAnswers(
    actor: AuthenticatedUser,
    query?: ListSavedAnswersQueryDto,
  ): Promise<PaginatedSavedAnswersEntity> {
    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 10));
    const skip = (page - 1) * limit;

    const where: Prisma.SavedAnswerWhereInput = {
      userId: actor.id,
      message: { deletedAt: null, conversation: { deletedAt: null } },
    };

    const [total, items] = await Promise.all([
      this.prisma.savedAnswer.count({ where }),
      this.prisma.savedAnswer.findMany({
        where,
        include: {
          message: {
            include: {
              conversation: { select: { id: true, title: true } },
              ...MESSAGE_INCLUDE,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    return new PaginatedSavedAnswersEntity({
      data: items.map(
        (item) =>
          new SavedAnswerEntity({
            id: item.id,
            userId: item.userId,
            messageId: item.messageId,
            conversationId: item.message.conversation.id,
            conversationTitle: item.message.conversation.title,
            message: MessageMapper.toEntity(item.message),
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          }),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  }

  /** Removes a saved answer owned by `actor` (#125). */
  async removeSavedAnswer(id: string, actor: AuthenticatedUser): Promise<void> {
    const { count } = await this.prisma.savedAnswer.deleteMany({
      where: { id, userId: actor.id },
    });
    if (count === 0) {
      throw new NotFoundException(`Saved answer with ID ${id} not found`);
    }
  }

  /** Generates a signed share link and text for a completed assistant answer owned by `actor` (#125). */
  async createShareLink(
    conversationId: string,
    messageId: string,
    actor: AuthenticatedUser,
  ): Promise<ShareAnswerResultEntity> {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId, deletedAt: null, conversation: { deletedAt: null } },
      include: { conversation: { select: { userId: true } } },
    });
    if (!message || message.conversation.userId !== actor.id) {
      throw new NotFoundException(`Message with ID ${messageId} not found`);
    }
    if (message.role !== 'assistant' || normalizeGenerationStatus(message.status) !== 'done') {
      throw new BadRequestException('Only completed assistant answers can be shared');
    }

    const { token, expiresAt } = signShareToken(
      { messageId, conversationId, sharedBy: actor.id },
      this.getShareSecret(),
    );
    const sharePath = `/conversations/shared/${token}`;
    const shareText = `${message.content}\n\nLink: ${sharePath}`;

    return new ShareAnswerResultEntity({
      messageId,
      shareToken: token,
      sharePath,
      shareText,
      expiresAt,
    });
  }

  /**
   * Resolves a shared answer for `receiver` (#125), stripping any citation whose source document
   * the receiver is not permitted to see (via `isDocumentVisibleTo`).
   */
  async getSharedAnswer(token: string, receiver: AuthenticatedUser): Promise<SharedAnswerViewEntity> {
    const payload = verifyShareToken(token, this.getShareSecret());
    if (!payload) {
      throw new NotFoundException('Shared answer not found or expired');
    }

    const message = await this.prisma.message.findFirst({
      where: {
        id: payload.mid,
        conversationId: payload.cid,
        deletedAt: null,
        conversation: { deletedAt: null },
      },
      include: MESSAGE_INCLUDE,
    });
    if (!message) {
      throw new NotFoundException('Shared answer not found or expired');
    }

    const visibilityCache = new Map<string, boolean>();
    const citations: MessageCitationEntity[] = [];
    let redactedCitationsCount = 0;

    for (const ref of message.references) {
      const docId = ref.documentVersion.documentId;
      let visible = visibilityCache.get(docId);
      if (visible === undefined) {
        visible = await isDocumentVisibleTo(this.prisma, receiver, docId);
        visibilityCache.set(docId, visible);
      }
      if (visible) {
        citations.push(MessageMapper.toCitationEntity(ref));
      } else {
        redactedCitationsCount++;
      }
    }

    return new SharedAnswerViewEntity({
      messageId: message.id,
      content: message.content,
      modelUsed: message.modelUsed,
      citations,
      redactedCitationsCount,
      createdAt: message.createdAt,
    });
  }

  /** Submits a moderation/accuracy report on an assistant answer owned by `actor` (#125). */
  async reportAnswer(dto: ReportAnswerDto, actor: AuthenticatedUser): Promise<AnswerReportEntity> {
    const message = await this.prisma.message.findFirst({
      where: { id: dto.messageId, deletedAt: null, conversation: { deletedAt: null } },
      include: {
        conversation: {
          select: {
            id: true,
            userId: true,
            space: { select: { schoolId: true } },
          },
        },
      },
    });
    if (!message || message.conversation.userId !== actor.id) {
      throw new NotFoundException(`Message with ID ${dto.messageId} not found`);
    }
    if (message.role !== 'assistant') {
      throw new BadRequestException('Only assistant answers can be reported');
    }

    const created = await this.prisma.answerReport.create({
      data: {
        messageId: dto.messageId,
        userId: actor.id,
        reason: dto.reason,
        feedback: dto.feedback || null,
      },
    });

    return new AnswerReportEntity({
      id: created.id,
      userId: created.userId,
      messageId: created.messageId,
      reason: created.reason,
      feedback: created.feedback,
      conversationId: message.conversation.id,
      schoolId: message.conversation.space.schoolId,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
  }

  /**
   * Lists answer reports for admins (#125):
   * - Platform admins see reports across all schools (optionally filtered by `schoolId`).
   * - School admins see only reports belonging to their assigned school(s).
   */
  async findReports(
    actor: AuthenticatedUser,
    query?: ListReportsQueryDto,
  ): Promise<PaginatedAnswerReportsEntity> {
    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 10));
    const skip = (page - 1) * limit;

    const scope = schoolsWithPermission(actor, 'metrics:view');
    if (scope !== 'all') {
      if (scope.length === 0 || (query?.schoolId && !scope.includes(query.schoolId))) {
        return new PaginatedAnswerReportsEntity({ data: [], total: 0, page, limit, totalPages: 1 });
      }
    }

    const schoolFilter: Prisma.SpaceWhereInput | undefined =
      scope === 'all'
        ? query?.schoolId
          ? { schoolId: query.schoolId }
          : undefined
        : { schoolId: query?.schoolId ? query.schoolId : { in: scope } };

    const where: Prisma.AnswerReportWhereInput = {
      ...(query?.reason ? { reason: query.reason } : {}),
      message: {
        deletedAt: null,
        conversation: {
          deletedAt: null,
          ...(schoolFilter ? { space: schoolFilter } : {}),
        },
      },
    };

    const [total, reports] = await Promise.all([
      this.prisma.answerReport.count({ where }),
      this.prisma.answerReport.findMany({
        where,
        include: {
          message: {
            select: {
              content: true,
              conversation: { select: { id: true, space: { select: { schoolId: true } } } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    return new PaginatedAnswerReportsEntity({
      data: reports.map(
        (r) =>
          new AnswerReportEntity({
            id: r.id,
            messageId: r.messageId,
            userId: r.userId,
            reason: r.reason,
            feedback: r.feedback,
            conversationId: r.message.conversation.id,
            schoolId: r.message.conversation.space.schoolId,
            messageContent: r.message.content,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          }),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  }
}
