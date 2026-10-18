import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateDocumentDto, CreateSpaceDto, UpdateDocumentDto } from '../dto/index.js';
import { DocumentEntity, SpaceEntity } from '../entities/index.js';
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
  @ApiOperation({ summary: 'List documents of your schools' })
  @ApiResponse({ status: 200, description: 'List of documents', type: [DocumentEntity] })
  async getDocuments(@CurrentUser() actor: AuthenticatedUser): Promise<DocumentEntity[]> {
    return this.documentsService.findAllDocuments(actor);
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
