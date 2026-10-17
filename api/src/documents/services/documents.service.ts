import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateDocumentDto, CreateSpaceDto, UpdateDocumentDto } from '../dto/index.js';
import { DocumentEntity, SpaceEntity } from '../entities/index.js';
import { DocumentMapper, SpaceMapper } from '../mappers/index.js';

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllDocuments(): Promise<DocumentEntity[]> {
    const docs = await this.prisma.document.findMany();
    return docs.map((d) => DocumentMapper.toEntity(d));
  }

  async findDocumentById(id: string): Promise<DocumentEntity> {
    const doc = await this.prisma.document.findUnique({
      where: { id },
    });
    if (!doc) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }
    return DocumentMapper.toEntity(doc);
  }

  async createDocument(dto: CreateDocumentDto): Promise<DocumentEntity> {
    const id = randomUUID();
    const data = DocumentMapper.fromDtoToCreateInput(dto, id);
    const created = await this.prisma.document.create({
      data,
    });
    return DocumentMapper.toEntity(created);
  }

  async updateDocument(id: string, dto: UpdateDocumentDto): Promise<DocumentEntity> {
    const existing = await this.findDocumentById(id);
    const existingMeta = {
      author: existing.author,
      tags: existing.tags,
    };
    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        ...(dto.title && { title: dto.title }),
        metadata: {
          ...existingMeta,
          ...(dto.author && { author: dto.author }),
          ...(dto.tags && { tags: dto.tags }),
          ...(dto.metadata),
        },
      },
    });
    return DocumentMapper.toEntity(updated);
  }

  async findAllSpaces(): Promise<SpaceEntity[]> {
    const spaces = await this.prisma.space.findMany();
    return spaces.map((s) => SpaceMapper.toEntity(s));
  }

  async createSpace(dto: CreateSpaceDto): Promise<SpaceEntity> {
    const id = randomUUID();
    const data = SpaceMapper.fromDtoToCreateInput(dto, id);
    const created = await this.prisma.space.create({
      data,
    });
    return SpaceMapper.toEntity(created);
  }
}
