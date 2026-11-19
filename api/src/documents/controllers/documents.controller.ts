import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import {
  AddDocumentAccessDto,
  CreateDocumentDto,
  CreateSpaceDto,
  ListDocumentsQueryDto,
  ListSpacesQueryDto,
  ReplaceDocumentAccessDto,
  UpdateDocumentDto,
  UploadDocumentDto,
} from '../dto/index.js';
import {
  DocumentAccessRuleEntity,
  DocumentEntity,
  DocumentVersionItemEntity,
  PaginatedDocumentsEntity,
  PaginatedSpacesEntity,
  SpaceEntity,
  ValidatedFileEntity,
} from '../entities/index.js';
import type { UploadedFile as IUploadedFile } from '../interfaces/index.js';
import { DocumentAccessService } from '../services/document-access.service.js';
import { DocumentsService } from '../services/documents.service.js';
import { RangeNotSatisfiableException } from '../utils/http-range.util.js';
import { auditContextFromRequest } from '../../audit/utils/audit-request-context.util.js';

@ApiTags('Documents')
@ApiBearerAuth('bearer-jwt')
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'Missing permission, suspended account, or another school' })
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly documentAccessService: DocumentAccessService,
  ) {}

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
  @RequirePermission('documents:manage')
  @ApiOperation({ summary: 'Create a new document space in one of your schools' })
  @ApiResponse({ status: 201, description: 'Space created', type: SpaceEntity })
  async createSpace(@Body() dto: CreateSpaceDto, @CurrentUser() actor: AuthenticatedUser): Promise<SpaceEntity> {
    return this.documentsService.createSpace(dto, actor);
  }

  @Get('spaces/:id')
  @RequirePermission('spaces:read')
  @ApiOperation({
    summary: 'Get document space by ID (scoped to school) (§4.5, #89)',
    description: 'Retrieves space details. Caller must hold spaces:read in the space school, otherwise 403.',
  })
  @ApiParam({ name: 'id', description: 'Space UUID' })
  @ApiResponse({ status: 200, description: 'Space retrieved successfully', type: SpaceEntity })
  @ApiResponse({ status: 403, description: 'Forbidden: caller lacks access to space school' })
  @ApiResponse({ status: 404, description: 'Space not found' })
  async getSpaceById(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser): Promise<SpaceEntity> {
    return this.documentsService.findSpaceById(id, actor);
  }

  @Get(':id')
  @RequirePermission('documents:read')
  @ApiOperation({
    summary: 'Get document details by ID',
    description:
      'Document managers of the school see any document. Other readers only see a document published to them ' +
      '(#109, see POST /documents/{id}/access); a document without publication rules is a draft.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiResponse({ status: 200, description: 'Document retrieved', type: DocumentEntity })
  @ApiResponse({ status: 403, description: 'Another school, or the document is not published to you' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getDocumentById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser): Promise<DocumentEntity> {
    return this.documentsService.findDocumentById(id, actor);
  }

  @Get(':id/access')
  @RequirePermission('documents:manage')
  @ApiOperation({
    summary: 'List who a document is published to (#109)',
    description: 'The publication rules of the document, oldest first, with the name of each target.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiResponse({ status: 200, description: 'Publication rules', type: [DocumentAccessRuleEntity] })
  @ApiResponse({ status: 400, description: 'Invalid document id' })
  @ApiResponse({ status: 404, description: 'Document not found or deleted' })
  async listDocumentAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DocumentAccessRuleEntity[]> {
    return this.documentAccessService.listRules(id, actor);
  }

  @Post(':id/access')
  @RequirePermission('documents:manage')
  @ApiOperation({
    summary: 'Publish a document to a school, role, class, group or user (#109)',
    description:
      "Adds publication rules. Every target must belong to the document's school: the school itself, a school role " +
      '(not a platform role), a class or group of the school, or a user with a role in the school (e.g. a parent or ' +
      'guest shared explicitly). Targets the document already has are skipped. A document without any rule is a ' +
      'draft that only document managers see. Platform admins can publish any document; others only documents of ' +
      'the schools where they hold documents:manage. Records a document_published audit event. ' +
      'Answers with all the rules of the document.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiBody({ type: AddDocumentAccessDto })
  @ApiResponse({ status: 201, description: 'All the publication rules of the document', type: [DocumentAccessRuleEntity] })
  @ApiResponse({ status: 400, description: "Invalid body, or a target outside the document's school" })
  @ApiResponse({ status: 404, description: 'Document not found or deleted' })
  async addDocumentAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddDocumentAccessDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DocumentAccessRuleEntity[]> {
    return this.documentAccessService.addRules(id, dto, actor, auditContextFromRequest(req));
  }

  @Put(':id/access')
  @RequirePermission('documents:manage')
  @ApiOperation({
    summary: "Replace a document's access rules (#110)",
    description:
      'Sets the complete list of publication rules: targets not in the list are removed, new ones added, the others ' +
      'kept. An empty list turns the document back into a draft. Same target checks as POST. Applies at once: ' +
      'readers who lose the document get 403 on their next request, and the next mobile sync removes it from their ' +
      'offline data (a sync_changes row, and their offline selections of it are deleted). Records ' +
      'document_access_changed unless nothing changed. Answers with the new rules.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiBody({ type: ReplaceDocumentAccessDto })
  @ApiResponse({ status: 200, description: 'The new publication rules', type: [DocumentAccessRuleEntity] })
  @ApiResponse({ status: 400, description: "Invalid body, or a target outside the document's school" })
  @ApiResponse({ status: 404, description: 'Document not found or deleted' })
  async replaceDocumentAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceDocumentAccessDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DocumentAccessRuleEntity[]> {
    return this.documentAccessService.replaceRules(id, dto, actor, auditContextFromRequest(req));
  }

  @Delete(':id/access/:ruleId')
  @RequirePermission('documents:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove one access rule of a document (#110)',
    description:
      'Readers reached only through this rule lose the document at once, and the next mobile sync removes it from ' +
      'their offline data. Removing the last rule makes the document a draft. Records document_access_changed.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiParam({ name: 'ruleId', description: 'Access rule UUID (from GET /documents/{id}/access)' })
  @ApiResponse({ status: 204, description: 'Rule removed' })
  @ApiResponse({ status: 400, description: 'Invalid id' })
  @ApiResponse({ status: 404, description: 'Document not found, or not a rule of this document' })
  async removeDocumentAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.documentAccessService.removeRule(id, ruleId, actor, auditContextFromRequest(req));
  }

  @Post()
  @RequirePermission('documents:manage')
  @ApiOperation({ summary: 'Create and register a new document' })
  @ApiResponse({ status: 201, description: 'Document registered', type: DocumentEntity })
  async createDocument(@Body() dto: CreateDocumentDto, @CurrentUser() actor: AuthenticatedUser): Promise<DocumentEntity> {
    return this.documentsService.createDocument(dto, actor);
  }

  @Patch(':id')
  @RequirePermission('documents:manage')
  @ApiOperation({
    summary: 'Edit document metadata (§4.1, #105)',
    description:
      'Updates the title, author, date, and/or tags of an existing document. ' +
      'Enforces school-scoped permissions and writes an immutable hash-chained audit event.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiResponse({ status: 200, description: 'Document metadata updated successfully', type: DocumentEntity })
  @ApiResponse({ status: 400, description: 'Invalid payload, empty title, or malformed date' })
  @ApiResponse({ status: 403, description: 'Forbidden: caller lacks documents:update in this school' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async updateDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DocumentEntity> {
    const auditContext = auditContextFromRequest(req);
    return this.documentsService.updateDocument(id, dto, actor, auditContext);
  }

  @Delete(':id')
  @RequirePermission('documents:manage')
  @ApiOperation({
    summary: 'Delete a document (soft delete) (§4.1, §9, #108)',
    description:
      'Logically deletes a document so it is no longer retrievable, searchable, or downloadable. ' +
      'Existing citations in chat answers reflect the source as unavailable. ' +
      'Restricted to platform administrators, school administrators, and staff holding documents:delete. ' +
      'Records an immutable hash-chained audit event.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiResponse({ status: 200, description: 'Document soft-deleted' })
  @ApiResponse({ status: 403, description: 'Forbidden: caller lacks documents:delete in this school' })
  @ApiResponse({ status: 404, description: 'Document not found or already deleted' })
  async deleteDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<{ success: boolean; id: string; message: string }> {
    const auditContext = auditContextFromRequest(req);
    return this.documentsService.deleteDocument(id, actor, auditContext);
  }

  @Post(':id/replace')
  @RequirePermission('documents:manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Replace document with a new version (§4.1, §4.3, §5.2, #106)',
    description:
      'Uploads a replacement file for an existing document, creating a new incremented version (v2, v3, ...) ' +
      'with status pending and enqueues format-specific processing. Keeps previous versions intact for citations.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Replacement document or image file',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Document replaced with a new version', type: DocumentEntity })
  @ApiResponse({ status: 400, description: 'Missing file, unsupported format, or infected payload' })
  @ApiResponse({ status: 403, description: 'Forbidden: caller lacks documents:update in this school' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  @ApiResponse({ status: 413, description: 'File exceeds maximum size' })
  async replaceDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: IUploadedFile,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DocumentEntity> {
    const auditContext = auditContextFromRequest(req);
    return this.documentsService.replaceDocumentVersion(id, file, actor, auditContext);
  }

  @Post(':id/versions')
  @RequirePermission('documents:manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload a new version for a document (REST alias for replace, #106)',
    description: 'Alias for POST /documents/:id/replace.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'New document version file',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'New version created', type: DocumentEntity })
  async createDocumentVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: IUploadedFile,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DocumentEntity> {
    const auditContext = auditContextFromRequest(req);
    return this.documentsService.replaceDocumentVersion(id, file, actor, auditContext);
  }

  @Post('spaces/:spaceId/validate-file')
  @RequirePermission('documents:manage')
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
  @RequirePermission('documents:manage')
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
    @Req() req: Request,
  ): Promise<DocumentEntity> {
    const auditContext = auditContextFromRequest(req);
    return this.documentsService.uploadPdf(spaceId, file, dto, actor, auditContext);
  }

  @Post('spaces/:spaceId/upload-image')
  @RequirePermission('documents:manage')
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
    @Req() req: Request,
  ): Promise<DocumentEntity> {
    const auditContext = auditContextFromRequest(req);
    return this.documentsService.uploadImage(spaceId, file, dto, actor, auditContext);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Download current version of a document (§4.3, §7, #104)',
    description:
      'Downloads the latest version of an authorized document with Content-Disposition: attachment. ' +
      'Supports HTTP range requests for resumable downloads.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiQuery({ name: 'disposition', enum: ['attachment', 'inline'], required: false })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 206, description: 'Partial content (range request)' })
  @ApiResponse({ status: 403, description: 'Forbidden: caller lacks access to this document' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async downloadCurrentDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('disposition') disposition: 'attachment' | 'inline' | undefined,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.pipeDocumentStream({
      documentId: id,
      versionRef: 'latest',
      actor,
      rangeHeader: req.headers.range,
      disposition: disposition ?? 'attachment',
      res,
    });
  }

  @Get(':id/stream')
  @ApiOperation({
    summary: 'Stream current version of a document for viewer (§4.3, §7, #104)',
    description:
      'Streams the latest version of an authorized document with Content-Disposition: inline. ' +
      'Supports HTTP 206 range requests for page-by-page PDF / media rendering.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 206, description: 'Partial content (range request)' })
  @ApiResponse({ status: 403, description: 'Forbidden: caller lacks access to this document' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async streamCurrentDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.pipeDocumentStream({
      documentId: id,
      versionRef: 'latest',
      actor,
      rangeHeader: req.headers.range,
      disposition: 'inline',
      res,
    });
  }

  @Get(':id/versions')
  @RequirePermission('documents:manage')
  @ApiOperation({
    summary: 'List version history of a document (§4.5, #107)',
    description:
      'Returns the full version history of a document, ordered newest first. ' +
      'Includes version number, creation date, uploader, file size in bytes, checksum, and status. ' +
      'Accessible to platform admins, school admins, and staff with document-management rights in the space school. ' +
      'Mobile users without document-management rights cannot call this endpoint.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiResponse({
    status: 200,
    description: 'Version history ordered newest first',
    type: [DocumentVersionItemEntity],
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden: caller lacks document-management rights in this school or is a mobile user',
  })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async listDocumentVersions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<DocumentVersionItemEntity[]> {
    return this.documentsService.listDocumentVersions(id, actor);
  }

  @Get(':id/versions/:version/download')
  @ApiOperation({
    summary: 'Download a specific version of a document (§4.3, §7, #104)',
    description:
      'Downloads a specific version (by version number, UUID, or "latest") with Content-Disposition: attachment. ' +
      'Managers may download any historical version; non-managers may download current versions or versions cited in their conversations.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiParam({ name: 'version', description: 'Version number (e.g. 1) or version UUID or "latest"' })
  @ApiQuery({ name: 'disposition', enum: ['attachment', 'inline'], required: false })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 206, description: 'Partial content (range request)' })
  @ApiResponse({ status: 403, description: 'Forbidden: caller lacks access to this version' })
  @ApiResponse({ status: 404, description: 'Document or version not found' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async downloadDocumentVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version') version: string,
    @Query('disposition') disposition: 'attachment' | 'inline' | undefined,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.pipeDocumentStream({
      documentId: id,
      versionRef: version,
      actor,
      rangeHeader: req.headers.range,
      disposition: disposition ?? 'attachment',
      res,
    });
  }

  @Get(':id/versions/:version/stream')
  @ApiOperation({
    summary: 'Stream a specific version of a document for viewer (§4.3, §7, #104)',
    description:
      'Streams a specific version (by version number, UUID, or "latest") with Content-Disposition: inline and HTTP 206 range request support.',
  })
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiParam({ name: 'version', description: 'Version number (e.g. 1) or version UUID or "latest"' })
  @ApiResponse({ status: 200, description: 'File content' })
  @ApiResponse({ status: 206, description: 'Partial content (range request)' })
  @ApiResponse({ status: 403, description: 'Forbidden: caller lacks access to this version' })
  @ApiResponse({ status: 404, description: 'Document or version not found' })
  @ApiResponse({ status: 416, description: 'Range not satisfiable' })
  async streamDocumentVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version') version: string,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.pipeDocumentStream({
      documentId: id,
      versionRef: version,
      actor,
      rangeHeader: req.headers.range,
      disposition: 'inline',
      res,
    });
  }

  private async pipeDocumentStream(options: {
    documentId: string;
    versionRef: string;
    actor: AuthenticatedUser;
    rangeHeader?: string;
    disposition: 'attachment' | 'inline';
    res: Response;
  }): Promise<void> {
    const { res, ...serviceOpts } = options;
    try {
      const { stream, statusCode, headers } =
        await this.documentsService.getDocumentVersionStream(serviceOpts);

      res.status(statusCode);
      for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
      }

      res.on('close', () => {
        stream.destroy();
      });

      stream.on('error', (err) => {
        if (!res.headersSent) {
          res.status(HttpStatus.INTERNAL_SERVER_ERROR).end();
        }
        stream.destroy(err);
      });

      stream.pipe(res);
    } catch (err) {
      if (err instanceof RangeNotSatisfiableException) {
        res.setHeader('Content-Range', `bytes */${err.totalSize}`);
        res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).json({
          statusCode: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
          message: 'Requested range not satisfiable',
        });
        return;
      }
      throw err;
    }
  }
}
