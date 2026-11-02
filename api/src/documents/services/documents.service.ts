import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess, schoolIdFilter, schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateDocumentDto, CreateSpaceDto, ListDocumentsQueryDto, UpdateDocumentDto } from '../dto/index.js';
import { DocumentEntity, PaginatedDocumentsEntity, SpaceEntity } from '../entities/index.js';
import { DocumentMapper, SpaceMapper } from '../mappers/index.js';

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Platform-wide readers see every document; others only the documents of spaces in their schools.
   * Paginated with the shared `page`/`limit` contract (`limit` capped at 100) and ordered
   * `created_at DESC, id DESC`, so pages stay stable when two documents share a timestamp.
   */
  async findAllDocuments(
    actor: AuthenticatedUser,
    query?: ListDocumentsQueryDto,
  ): Promise<PaginatedDocumentsEntity> {
    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 10));
    const skip = (page - 1) * limit;

    const schoolId = schoolIdFilter(actor, 'documents:read');
    const where: Prisma.DocumentWhereInput = schoolId ? { space: { schoolId } } : {};

    const [total, docs] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return new PaginatedDocumentsEntity({
      data: docs.map((d) => DocumentMapper.toEntity(d)),
      total,
      page,
      limit,
      totalPages,
    });
  }

  async findDocumentById(id: string, actor: AuthenticatedUser): Promise<DocumentEntity> {
    return DocumentMapper.toEntity(await this.findDocumentInScope(id, actor, 'documents:read'));
  }

  /** Loads a document and throws 403 unless `actor` has `permission` in the school of its space. */
  private async findDocumentInScope(id: string, actor: AuthenticatedUser, permission: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: { space: { select: { schoolId: true } } },
    });
    if (!doc) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }
    assertSchoolAccess(actor, permission, doc.space.schoolId);
    return doc;
  }

  async createDocument(dto: CreateDocumentDto, actor: AuthenticatedUser): Promise<DocumentEntity> {
    const space = await this.prisma.space.findUnique({ where: { id: dto.spaceId }, select: { schoolId: true } });
    if (!space) {
      throw new NotFoundException(`Space with ID ${dto.spaceId} not found`);
    }
    assertSchoolAccess(actor, 'documents:create', space.schoolId);
    const id = randomUUID();
    const data = DocumentMapper.fromDtoToCreateInput(dto, id);
    const created = await this.prisma.document.create({
      data,
    });
    return DocumentMapper.toEntity(created);
  }

  async updateDocument(id: string, dto: UpdateDocumentDto, actor: AuthenticatedUser): Promise<DocumentEntity> {
    await this.findDocumentInScope(id, actor, 'documents:update');
    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.author !== undefined && { author: dto.author }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
      },
    });
    return DocumentMapper.toEntity(updated);
  }

  async findAllSpaces(actor: AuthenticatedUser): Promise<SpaceEntity[]> {
    const schoolId = schoolIdFilter(actor, 'spaces:read');
    const spaces = await this.prisma.space.findMany({ where: schoolId ? { schoolId } : undefined });
    return spaces.map((s) => SpaceMapper.toEntity(s));
  }

  /** School-scoped users must create the space in one of their schools. */
  async createSpace(dto: CreateSpaceDto, actor: AuthenticatedUser): Promise<SpaceEntity> {
    if (dto.schoolId) {
      assertSchoolAccess(actor, 'spaces:create', dto.schoolId);
    } else if (schoolsWithPermission(actor, 'spaces:create') !== 'all') {
      throw new BadRequestException('schoolId is required: you can only create spaces in your own school');
    }
    const id = randomUUID();
    let schoolId = dto.schoolId;
    if (!schoolId) {
      const existingSchool = await this.prisma.school.findFirst();
      if (existingSchool) {
        schoolId = existingSchool.id;
      } else {
        const defaultSchool = await this.prisma.school.create({
          data: {
            id: randomUUID(),
            name: 'Default Institution',
            allowedDomains: '*',
          },
        });
        schoolId = defaultSchool.id;
      }
    }

    const data = SpaceMapper.fromDtoToCreateInput(dto, id, schoolId);
    const created = await this.prisma.space.create({
      data,
    });
    return SpaceMapper.toEntity(created);
  }
}
