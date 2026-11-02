import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateDocumentDto, CreateSpaceDto, ListDocumentsQueryDto, UpdateDocumentDto } from '../dto/index.js';
import { DocumentEntity, PaginatedDocumentsEntity, SpaceEntity } from '../entities/index.js';
import { DocumentsService } from '../services/documents.service.js';

@ApiTags('Documents')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission, suspended account, or another school' })
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @RequirePermission('documents:read')
  @ApiOperation({
    summary: 'List documents of your schools, paginated, newest first',
    description:
      'Same page/limit contract as the other lists: page defaults to 1, limit to 10 and is capped at 100. ' +
      'Returns { data, total, page, limit, totalPages }.',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (minimum 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (1-100)' })
  @ApiResponse({ status: 200, description: 'Paginated list of documents', type: PaginatedDocumentsEntity })
  async getDocuments(
    @Query() query: ListDocumentsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedDocumentsEntity> {
    return this.documentsService.findAllDocuments(actor, query);
  }

  @Get('spaces')
  @RequirePermission('spaces:read')
  @ApiOperation({ summary: 'List document spaces of your schools' })
  @ApiResponse({ status: 200, description: 'List of spaces', type: [SpaceEntity] })
  async getSpaces(@CurrentUser() actor: AuthenticatedUser): Promise<SpaceEntity[]> {
    return this.documentsService.findAllSpaces(actor);
  }

  @Post('spaces')
  @RequirePermission('spaces:create')
  @ApiOperation({ summary: 'Create a new document space in one of your schools' })
  @ApiResponse({ status: 201, description: 'Space created', type: SpaceEntity })
  async createSpace(@Body() dto: CreateSpaceDto, @CurrentUser() actor: AuthenticatedUser): Promise<SpaceEntity> {
    return this.documentsService.createSpace(dto, actor);
  }

  @Get(':id')
  @RequirePermission('documents:read')
  @ApiOperation({ summary: 'Get document details by ID' })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiResponse({ status: 200, description: 'Document retrieved', type: DocumentEntity })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getDocumentById(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<DocumentEntity> {
    return this.documentsService.findDocumentById(id, actor);
  }

  @Post()
  @RequirePermission('documents:create')
  @ApiOperation({ summary: 'Create and register a new document' })
  @ApiResponse({ status: 201, description: 'Document registered', type: DocumentEntity })
  async createDocument(@Body() dto: CreateDocumentDto, @CurrentUser() actor: AuthenticatedUser): Promise<DocumentEntity> {
    return this.documentsService.createDocument(dto, actor);
  }

  @Patch(':id')
  @RequirePermission('documents:update')
  @ApiOperation({ summary: 'Update document metadata' })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiResponse({ status: 200, description: 'Document updated', type: DocumentEntity })
  async updateDocument(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DocumentEntity> {
    return this.documentsService.updateDocument(id, dto, actor);
  }
}
