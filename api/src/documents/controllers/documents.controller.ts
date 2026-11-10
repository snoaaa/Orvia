import { Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { CreateDocumentDto, CreateSpaceDto, ListDocumentsQueryDto, ListSpacesQueryDto, UpdateDocumentDto, UploadDocumentDto } from '../dto/index.js';
import { DocumentEntity, PaginatedDocumentsEntity, PaginatedSpacesEntity, SpaceEntity, ValidatedFileEntity } from '../entities/index.js';
import type { UploadedFile as IUploadedFile } from '../interfaces/index.js';
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
  @ApiOperation({
    summary: 'List document spaces of your schools, paginated and alphabetical',
    description:
      'Same page/limit contract as the other lists: page defaults to 1, limit to 10 and is capped at 100. ' +
      'Returns { data, total, page, limit, totalPages }.',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (minimum 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (1-100)' })
  @ApiResponse({ status: 200, description: 'Paginated list of spaces', type: PaginatedSpacesEntity })
  async getSpaces(
    @Query() query: ListSpacesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedSpacesEntity> {
    return this.documentsService.findAllSpaces(actor, query);
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

  @Post('spaces/:spaceId/validate-file')
  @RequirePermission('documents:create')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Validate an uploaded file for ingestion (§5.2, #100)',
    description:
      'Pre-ingestion validation: checks MIME type via magic bytes (PDF, JPEG, PNG, HEIC), ' +
      'enforces configured max file size, scans for malware (EICAR & ClamAV), ' +
      'computes SHA-256 content checksum, and ensures no duplicate checksum exists in the target space.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'spaceId', description: 'Target space UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document or image file (PDF, JPEG, PNG, HEIC)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 200, description: 'File validated successfully', type: ValidatedFileEntity })
  @ApiResponse({ status: 400, description: 'Non-allowed type, infected file, or invalid payload' })
  @ApiResponse({ status: 404, description: 'Space not found' })
  @ApiResponse({ status: 409, description: 'Duplicate file in space' })
  @ApiResponse({ status: 413, description: 'Oversized file' })
  async validateFile(
    @Param('spaceId') spaceId: string,
    @UploadedFile() file: IUploadedFile,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ValidatedFileEntity> {
    return this.documentsService.validateUploadedFile(spaceId, file, actor);
  }

  @Post('spaces/:spaceId/upload')
  @RequirePermission('documents:create')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload a document to a space (§4.1, §6 Scalabilité, §9, #102, #150)',
    description:
      'Uploads a document (PDF, Word DOCX/DOC, PowerPoint PPTX/PPT, Excel XLSX/XLS, OpenDocument ODT/ODS/ODP, Text TXT/MD/CSV) ' +
      'into a space, creating the document and its first version with status pending, ' +
      'then pushes a format-specific processing job to the async queue. Enforces school access, format validation, ' +
      'size limit, antivirus scanning, and duplicate detection.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'spaceId', description: 'Target space UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document file (PDF, Office, OpenDocument, or Text)',
        },
        title: {
          type: 'string',
          description: 'Document title (optional, defaults to filename)',
        },
        author: {
          type: 'string',
          description: 'Author or lecturer name (optional)',
        },
        tags: {
          type: 'string',
          description: 'Comma-separated tags (optional)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Document uploaded and queued for processing', type: DocumentEntity })
  @ApiResponse({ status: 400, description: 'Invalid format, image uploaded to document endpoint, infected, or invalid payload' })
  @ApiResponse({ status: 403, description: 'Insufficient rights or another school' })
  @ApiResponse({ status: 404, description: 'Space not found' })
  @ApiResponse({ status: 409, description: 'Duplicate file in space' })
  @ApiResponse({ status: 413, description: 'File exceeds maximum size' })
  async uploadPdf(
    @Param('spaceId') spaceId: string,
    @UploadedFile() file: IUploadedFile,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DocumentEntity> {
    return this.documentsService.uploadPdf(spaceId, file, dto, actor);
  }

  @Post('spaces/:spaceId/upload-image')
  @RequirePermission('documents:create')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload an image (JPEG, PNG, HEIC) to a space (§4.1, §9, #103)',
    description:
      'Uploads an image into a space for downstream OCR processing. Validates file format (magic bytes), ' +
      'enforces size limit, runs malware scan, converts HEIC to JPEG if needed, creates document and version 1 ' +
      'with status pending, and queues OCR processing.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'spaceId', description: 'Target space UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Image file (JPEG, PNG, or HEIC)',
        },
        title: {
          type: 'string',
          description: 'Document title (optional, defaults to filename)',
        },
        author: {
          type: 'string',
          description: 'Author or photographer name (optional)',
        },
        tags: {
          type: 'string',
          description: 'Comma-separated tags (optional)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Image uploaded and queued for OCR', type: DocumentEntity })
  @ApiResponse({ status: 400, description: 'Unsupported format, infected, or invalid payload' })
  @ApiResponse({ status: 403, description: 'Insufficient rights or another school' })
  @ApiResponse({ status: 404, description: 'Space not found' })
  @ApiResponse({ status: 409, description: 'Duplicate file in space' })
  @ApiResponse({ status: 413, description: 'File exceeds maximum size' })
  async uploadImage(
    @Param('spaceId') spaceId: string,
    @UploadedFile() file: IUploadedFile,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DocumentEntity> {
    return this.documentsService.uploadImage(spaceId, file, dto, actor);
  }
}
