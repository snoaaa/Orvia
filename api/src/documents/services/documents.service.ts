import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess, schoolIdFilter, schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateDocumentDto, CreateSpaceDto, UpdateDocumentDto } from '../dto/index.js';
import { DocumentEntity, SpaceEntity } from '../entities/index.js';
import { DocumentMapper, SpaceMapper } from '../mappers/index.js';

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllDocuments(actor: AuthenticatedUser): Promise<DocumentEntity[]> {
    const schoolId = schoolIdFilter(actor, 'documents:read');
    const docs = await this.prisma.document.findMany({
      where: schoolId ? { space: { schoolId } } : undefined,
    });
    return docs.map((d) => DocumentMapper.toEntity(d));
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
