import { Body, Controller, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthDevToolsGuard } from '../../auth/controllers/auth-dev.controller.js';
import { CurrentUser, RequirePermission } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import { SetVersionStatusDto } from '../dto/index.js';
import { DocumentProcessingStatusService, type StatusChangeResult } from '../services/document-processing-status.service.js';

/**
 * DEV-ONLY (#112). The processing pipeline does not exist yet, so this moves a version through its statuses
 * the way the pipeline will, to test the web and mobile screens. Hidden (404) unless AUTH_DEV_TOOLS=true and
 * not in production. Requires documents:manage in the school of the version.
 */
@ApiTags('Documents (dev tools)')
@ApiBearerAuth('bearer-jwt')
@UseGuards(AuthDevToolsGuard)
@Controller('documents/dev')
export class DocumentsDevController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statuses: DocumentProcessingStatusService,
  ) {}

  @Post('versions/:versionId/status')
  @HttpCode(200)
  @RequirePermission('documents:manage')
  @ApiOperation({
    summary: '[DEV] Simulate a processing step: set the status of a version',
    description:
      'Same rules as the pipeline: pending → ocr (optional) → segmentation → indexing → available; error from any ' +
      'step with a reason; error → pending to retry. Another order → 409. The first available version announces ' +
      'the document to its readers (sync changes).',
  })
  @ApiParam({ name: 'versionId', description: 'Document version UUID' })
  @ApiResponse({ status: 200, description: 'The change applied' })
  @ApiResponse({ status: 400, description: 'Unknown status, or error without a reason' })
  @ApiResponse({ status: 404, description: 'Unknown version, or dev tools disabled' })
  @ApiResponse({ status: 409, description: 'Not allowed in the pipeline order' })
  async setStatus(
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: SetVersionStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<StatusChangeResult> {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: versionId },
      select: { document: { select: { space: { select: { schoolId: true } } } } },
    });
    if (!version) throw new NotFoundException(`Document version ${versionId} not found`);
    assertSchoolAccess(actor, 'documents:manage', version.document.space.schoolId);
    return this.statuses.setStatus(versionId, dto.status, dto.reason);
  }
}
