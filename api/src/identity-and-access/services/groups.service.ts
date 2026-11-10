import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess, schoolIdFilter } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateGroupDto, ListGroupsQueryDto, UpdateGroupDto } from '../dto/index.js';
import { GroupDetailEntity, GroupEntity, PaginatedGroupsEntity } from '../entities/index.js';

/** What every group read loads: the school name and the number of members. */
const detailInclude = {
  school: { select: { name: true, status: true } },
  _count: { select: { members: true } },
} satisfies Prisma.GroupInclude;

type GroupWithDetail = Prisma.GroupGetPayload<{ include: typeof detailInclude }>;

/** Groups (classes, departments, teams) of a school (Sections 4.5 and 4.7). */
@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** POST /groups (#33): 403 outside the admin's schools, 409 if the school already has this name. */
  async createGroup(dto: CreateGroupDto, actor: AuthenticatedUser): Promise<GroupEntity> {
    assertSchoolAccess(actor, 'groups:create', dto.schoolId);

    const school = await this.prisma.school.findUnique({ where: { id: dto.schoolId }, select: { status: true } });
    if (!school) {
      throw new NotFoundException(`School with ID ${dto.schoolId} not found`);
    }
    if (school.status === 'deactivated') {
      throw new BadRequestException('Cannot create a group in a deactivated school');
    }

    try {
      const group = await this.prisma.group.create({
        data: { schoolId: dto.schoolId, name: dto.name, type: dto.type ?? 'class' },
      });
      return new GroupEntity(group);
    } catch (error) {
      // The unique index decides, so two simultaneous requests cannot both succeed.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`A group named '${dto.name}' already exists in this school`);
      }
      throw error;
    }
  }

  /** GET /groups (#34): scoped to the admin's schools; filtering on another school is 403. */
  async listGroups(actor: AuthenticatedUser, query: ListGroupsQueryDto = {}): Promise<PaginatedGroupsEntity> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? (sortBy === 'createdAt' ? 'desc' : 'asc');
    if (query.schoolId) {
      assertSchoolAccess(actor, 'groups:read', query.schoolId);
    }

    const scope = schoolIdFilter(actor, 'groups:read');
    const where: Prisma.GroupWhereInput = {
      ...(query.schoolId ? { schoolId: query.schoolId } : scope ? { schoolId: scope } : {}),
      ...(query.type && { type: query.type }),
      // MySQL's default collation (utf8mb4_unicode_ci) makes `contains` case-insensitive.
      ...(query.search && { name: { contains: query.search } }),
    };

    const [total, groups] = await Promise.all([
      this.prisma.group.count({ where }),
      this.prisma.group.findMany({
        where,
        // Secondary sort on id keeps pagination stable when values are equal.
        orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: detailInclude,
      }),
    ]);

    return new PaginatedGroupsEntity({
      data: groups.map((g) => this.toDetail(g)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    });
  }

  /** GET /groups/:id (#34): 404 if unknown, 403 outside the admin's schools. */
  async getGroup(id: string, actor: AuthenticatedUser): Promise<GroupDetailEntity> {
    const group = await this.findGroup(id);
    assertSchoolAccess(actor, 'groups:read', group.schoolId);
    return this.toDetail(group);
  }

  /** PATCH /groups/:id (#34): name and type only; nothing is written when nothing changes. */
  async updateGroup(id: string, dto: UpdateGroupDto, actor: AuthenticatedUser): Promise<GroupDetailEntity> {
    if (dto.name === undefined && dto.type === undefined) {
      throw new BadRequestException('Nothing to update: provide name or type');
    }
    const group = await this.findGroup(id);
    assertSchoolAccess(actor, 'groups:update', group.schoolId);
    if (group.school.status === 'deactivated') {
      throw new BadRequestException('Cannot update a group of a deactivated school');
    }
    if ((dto.name ?? group.name) === group.name && (dto.type ?? group.type) === group.type) {
      return this.toDetail(group);
    }

    try {
      const updated = await this.prisma.group.update({
        where: { id },
        data: { ...(dto.name !== undefined && { name: dto.name }), ...(dto.type !== undefined && { type: dto.type }) },
        include: detailInclude,
      });
      return this.toDetail(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`A group named '${dto.name}' already exists in this school`);
      }
      throw error;
    }
  }

  private async findGroup(id: string): Promise<GroupWithDetail> {
    const group = await this.prisma.group.findUnique({ where: { id }, include: detailInclude });
    if (!group) {
      throw new NotFoundException(`Group with ID ${id} not found`);
    }
    return group;
  }

  private toDetail(group: GroupWithDetail): GroupDetailEntity {
    return new GroupDetailEntity({
      id: group.id,
      schoolId: group.schoolId,
      schoolName: group.school.name,
      name: group.name,
      type: group.type,
      memberCount: group._count.members,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    });
  }
}
