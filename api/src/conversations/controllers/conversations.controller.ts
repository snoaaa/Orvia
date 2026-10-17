import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateConversationDto, CreateMessageDto, ReportAnswerDto, SaveAnswerDto } from '../dto/index.js';
import { AnswerReportEntity, ConversationEntity, MessageEntity, SavedAnswerEntity } from '../entities/index.js';
import { ConversationsService } from '../services/conversations.service.js';

@ApiTags('Conversations')
@ApiBearerAuth('bearer-jwt')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'List user conversations' })
  @ApiResponse({ status: 200, description: 'List of conversations', type: [ConversationEntity] })
  async getConversations(): Promise<ConversationEntity[]> {
    return this.conversationsService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Start a new conversation thread' })
  @ApiResponse({ status: 201, description: 'Conversation started', type: ConversationEntity })
  async createConversation(@Body() dto: CreateConversationDto): Promise<ConversationEntity> {
    return this.conversationsService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation details by ID' })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiResponse({ status: 200, description: 'Conversation details', type: ConversationEntity })
  async getConversationById(@Param('id') id: string): Promise<ConversationEntity> {
    return this.conversationsService.findById(id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiResponse({ status: 200, description: 'Messages list', type: [MessageEntity] })
  async getMessages(@Param('id') id: string): Promise<MessageEntity[]> {
    return this.conversationsService.findMessages(id);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Post a new message or query to conversation' })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiResponse({ status: 201, description: 'Message created', type: MessageEntity })
  async addMessage(@Param('id') id: string, @Body() dto: CreateMessageDto): Promise<MessageEntity> {
    return this.conversationsService.addMessage(id, dto);
  }

  @Post('saved-answers')
  @ApiOperation({ summary: 'Bookmark or save an assistant answer' })
  @ApiResponse({ status: 201, description: 'Answer saved', type: SavedAnswerEntity })
  async saveAnswer(@Body() dto: SaveAnswerDto): Promise<SavedAnswerEntity> {
    return this.conversationsService.saveAnswer(dto);
  }

  @Post('reports')
  @ApiOperation({ summary: 'Report a hallucinated or incorrect answer' })
  @ApiResponse({ status: 201, description: 'Report logged', type: AnswerReportEntity })
  async reportAnswer(@Body() dto: ReportAnswerDto): Promise<AnswerReportEntity> {
    return this.conversationsService.reportAnswer(dto);
  }
}
