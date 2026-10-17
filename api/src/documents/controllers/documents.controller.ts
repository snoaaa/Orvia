import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateDocumentDto, CreateSpaceDto, UpdateDocumentDto } from '../dto/index.js';
import { DocumentEntity, SpaceEntity } from '../entities/index.js';
import { DocumentsService } from '../services/documents.service.js';

@ApiTags('Documents')
@ApiBearerAuth('bearer-jwt')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all documents' })
  @ApiResponse({ status: 200, description: 'List of documents', type: [DocumentEntity] })
  async getDocuments(): Promise<DocumentEntity[]> {
    return this.documentsService.findAllDocuments();
  }

  @Get('spaces')
  @ApiOperation({ summary: 'List all document spaces' })
  @ApiResponse({ status: 200, description: 'List of spaces', type: [SpaceEntity] })
  async getSpaces(): Promise<SpaceEntity[]> {
    return this.documentsService.findAllSpaces();
  }

  @Post('spaces')
  @ApiOperation({ summary: 'Create a new document space' })
  @ApiResponse({ status: 201, description: 'Space created', type: SpaceEntity })
  async createSpace(@Body() dto: CreateSpaceDto): Promise<SpaceEntity> {
    return this.documentsService.createSpace(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document details by ID' })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiResponse({ status: 200, description: 'Document retrieved', type: DocumentEntity })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getDocumentById(@Param('id') id: string): Promise<DocumentEntity> {
    return this.documentsService.findDocumentById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create and register a new document' })
  @ApiResponse({ status: 201, description: 'Document registered', type: DocumentEntity })
  async createDocument(@Body() dto: CreateDocumentDto): Promise<DocumentEntity> {
    return this.documentsService.createDocument(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update document metadata' })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiResponse({ status: 200, description: 'Document updated', type: DocumentEntity })
  async updateDocument(@Param('id') id: string, @Body() dto: UpdateDocumentDto): Promise<DocumentEntity> {
    return this.documentsService.updateDocument(id, dto);
  }
}
