import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import {
  CreateConversationDto,
  CreateMessageDto,
  ListConversationsQueryDto,
  ReportAnswerDto,
  SaveAnswerDto,
  UpdateConversationDto,
} from '../dto/index.js';
import {
  AnswerReportEntity,
  ConversationDetailEntity,
  ConversationEntity,
  MessageEntity,
  MessageGenerationStatusEntity,
  PaginatedConversationsEntity,
  SavedAnswerEntity,
} from '../entities/index.js';
import { ConversationsService } from '../services/conversations.service.js';

@ApiTags('Conversations')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission or suspended account' })
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @RequirePermission('conversations:read')
  @ApiOperation({
    summary: 'List your conversations, newest first and paginated (#123)',
    description:
      'Returns only conversations owned by the authenticated user (even for admins; monitoring uses dedicated routes). ' +
      'Ordered newest first (updatedAt DESC, createdAt DESC, id DESC). Supports optional spaceId and title search (q).',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (minimum 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (1-100)' })
  @ApiQuery({ name: 'spaceId', required: false, description: 'Filter by space UUID' })
  @ApiQuery({ name: 'q', required: false, description: 'Search in conversation title' })
  @ApiResponse({ status: 200, description: 'Paginated list of user conversations', type: PaginatedConversationsEntity })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  async getConversations(
    @Query() query: ListConversationsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedConversationsEntity> {
    return this.conversationsService.findAll(actor, query);
  }

  @Post()
  @RequirePermission('conversations:create')
  @ApiOperation({ summary: 'Start a new conversation thread' })
  @ApiResponse({ status: 201, description: 'Conversation started', type: ConversationEntity })
  async createConversation(@Body() dto: CreateConversationDto): Promise<ConversationEntity> {
    return this.conversationsService.create(dto);
  }

  @Get(':id')
  @RequirePermission('conversations:read')
  @ApiOperation({
    summary: 'Get conversation details with chronological messages and citations (#123)',
    description:
      'Returns the conversation only if owned by the authenticated user. Returns 404 for unknown, deleted, or another user’s conversation.',
  })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiResponse({ status: 200, description: 'Conversation details with messages and citations', type: ConversationDetailEntity })
  @ApiResponse({ status: 400, description: 'Invalid conversation UUID' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getConversationById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConversationDetailEntity> {
    return this.conversationsService.findById(id, actor);
  }

  @Get(':id/messages')
  @RequirePermission('conversations:read')
  @ApiOperation({
    summary: 'Get messages and citations for a conversation (#123)',
    description:
      'Returns the chronological messages and citations only if the conversation is owned by the authenticated user.',
  })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiResponse({ status: 200, description: 'Messages list', type: [MessageEntity] })
  @ApiResponse({ status: 400, description: 'Invalid conversation UUID' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getMessages(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MessageEntity[]> {
    return this.conversationsService.findMessages(id, actor);
  }

  @Get(':id/messages/:messageId/status')
  @RequirePermission('conversations:read')
  @ApiOperation({
    summary: 'Poll the generation status of a message (#122)',
    description:
      'Returns pending, generating, done, or failed for a message in a conversation owned by the caller. ' +
      'Includes the full answer and citations once status is done.',
  })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiParam({ name: 'messageId', description: 'Message UUID' })
  @ApiResponse({ status: 200, description: 'Generation status', type: MessageGenerationStatusEntity })
  @ApiResponse({ status: 400, description: 'Invalid conversation or message UUID' })
  @ApiResponse({ status: 404, description: 'Conversation or message not found' })
  async getMessageStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('messageId', new ParseUUIDPipe()) messageId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<MessageGenerationStatusEntity> {
    return this.conversationsService.getMessageStatus(id, messageId, actor);
  }

  @Patch(':id')
  @RequirePermission('conversations:update')
  @ApiOperation({
    summary: 'Rename a conversation (#124)',
    description:
      'Updates the title of a conversation owned by the authenticated user. Returns 404 for unknown, deleted, or another user’s conversation.',
  })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiResponse({ status: 200, description: 'Conversation renamed', type: ConversationEntity })
  @ApiResponse({ status: 400, description: 'Invalid UUID or title' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async renameConversation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateConversationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ConversationEntity> {
    return this.conversationsService.rename(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('conversations:delete')
  @ApiOperation({
    summary: 'Soft-delete a conversation (#124)',
    description:
      'Soft-deletes a conversation owned by the authenticated user so it disappears from their history. Returns 404 for unknown, already-deleted, or another user’s conversation.',
  })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiResponse({ status: 204, description: 'Conversation soft-deleted' })
  @ApiResponse({ status: 400, description: 'Invalid conversation UUID' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async deleteConversation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.conversationsService.remove(id, actor);
  }

  @Post(':id/messages')
  @RequirePermission('messages:send')
  @ApiOperation({ summary: 'Post a new message or query to conversation' })
  @ApiParam({ name: 'id', description: 'Conversation UUID' })
  @ApiResponse({ status: 201, description: 'Message created', type: MessageEntity })
  async addMessage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateMessageDto,
  ): Promise<MessageEntity> {
    return this.conversationsService.addMessage(id, dto);
  }

  @Post('saved-answers')
  @RequirePermission('answers:save')
  @ApiOperation({ summary: 'Bookmark or save an assistant answer' })
  @ApiResponse({ status: 201, description: 'Answer saved', type: SavedAnswerEntity })
  async saveAnswer(@Body() dto: SaveAnswerDto): Promise<SavedAnswerEntity> {
    return this.conversationsService.saveAnswer(dto);
  }

  @Post('reports')
  @RequirePermission('answers:report')
  @ApiOperation({ summary: 'Report a hallucinated or incorrect answer' })
  @ApiResponse({ status: 201, description: 'Report logged', type: AnswerReportEntity })
  async reportAnswer(@Body() dto: ReportAnswerDto): Promise<AnswerReportEntity> {
    return this.conversationsService.reportAnswer(dto);
  }
}
