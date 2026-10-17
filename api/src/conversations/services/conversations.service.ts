import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateConversationDto, CreateMessageDto, ReportAnswerDto, SaveAnswerDto } from '../dto/index.js';
import { AnswerReportEntity, ConversationEntity, MessageEntity, SavedAnswerEntity } from '../entities/index.js';
import { ConversationMapper, MessageMapper } from '../mappers/index.js';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<ConversationEntity[]> {
    return [
      new ConversationEntity({
        id: randomUUID(),
        userId: randomUUID(),
        spaceId: randomUUID(),
        title: 'Initial RAG Query Session',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ];
  }

  async findById(id: string): Promise<ConversationEntity> {
    return new ConversationEntity({
      id,
      userId: randomUUID(),
      spaceId: randomUUID(),
      title: 'Active Conversation',
      createdAt: new Date(),
      updatedAt: new Date(),
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

  async findMessages(conversationId: string): Promise<MessageEntity[]> {
    return [
      new MessageEntity({
        id: randomUUID(),
        conversationId,
        role: 'user',
        content: 'Explain neural network convergence.',
        modelUsed: 'local',
        parameters: null,
        status: 'completed',
        authSnapshot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ];
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
