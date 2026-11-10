import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess, schoolIdFilter } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AddGroupMembersDto, CreateGroupDto, ListGroupsQueryDto, UpdateGroupDto } from '../dto/index.js';
import { AddGroupMembersResultEntity, GroupDetailEntity, GroupEntity, PaginatedGroupsEntity } from '../entities/index.js';

/** What every group read loads: the school name and the number of members. */
const detailInclude = {
  school: { select: { name: true, status: true } },
  _count: { select: { members: true } },
} satisfies Prisma.GroupInclude;

type GroupWithDetail = Prisma.GroupGetPayload<{ include: typeof detailInclude }>;

/** Column size of `groups.name` (VARCHAR(191)). */
const GROUP_NAME_MAX_LENGTH = 191;

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
      deletedAt: null,
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

  /**
   * DELETE /groups/:id (#35): soft delete. In one transaction the group gets `deleted_at` and a renamed
   * `name` (so the name can be reused in the school), loses its memberships and the document access it
   * granted, and assignments pointing to it keep their school role without the group.
   */
  async deleteGroup(id: string, actor: AuthenticatedUser): Promise<void> {
    const group = await this.findGroup(id);
    assertSchoolAccess(actor, 'groups:delete', group.schoolId);
    if (group.school.status === 'deactivated') {
      throw new BadRequestException('Cannot delete a group of a deactivated school');
    }

    const deletedAt = new Date();
    const suffix = ` [deleted ${deletedAt.toISOString()}]`;
    const name = group.name.slice(0, GROUP_NAME_MAX_LENGTH - suffix.length) + suffix;

    await this.prisma.$transaction(async (tx) => {
      // Conditional on deleted_at: of two simultaneous deletes, only one goes through.
      const { count } = await tx.group.updateMany({ where: { id, deletedAt: null }, data: { deletedAt, name } });
      if (count === 0) {
        throw new NotFoundException(`Group with ID ${id} not found`);
      }
      await tx.groupMember.deleteMany({ where: { groupId: id } });
      await tx.documentAccess.deleteMany({ where: { groupId: id } });
      await tx.userAssignment.updateMany({ where: { groupId: id }, data: { groupId: null } });
    });
  }

  /**
   * POST /groups/:id/members (#36): all or nothing. Every user must have an assignment in the group's school
   * (an unknown id gets the same 400, so ids of other schools are not revealed); users already in the group
   * are skipped. The group's `updated_at` moves when someone is added, for the mobile sync.
   */
  async addMembers(id: string, dto: AddGroupMembersDto, actor: AuthenticatedUser): Promise<AddGroupMembersResultEntity> {
    const group = await this.findGroup(id);
    assertSchoolAccess(actor, 'groups:manage_members', group.schoolId);
    if (group.school.status === 'deactivated') {
      throw new BadRequestException('Cannot change the members of a group of a deactivated school');
    }

    const userIds = [...new Set(dto.userIds)];
    const eligible = await this.prisma.user.findMany({
      where: { id: { in: userIds }, assignments: { some: { schoolId: group.schoolId } } },
      select: { id: true },
    });
    const eligibleIds = new Set(eligible.map((u) => u.id));
    const rejected = userIds.filter((userId) => !eligibleIds.has(userId));
    if (rejected.length > 0) {
      throw new BadRequestException(`These users do not belong to the school of the group: ${rejected.join(', ')}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.groupMember.findMany({ where: { groupId: id, userId: { in: userIds } }, select: { userId: true } });
      const existingIds = new Set(existing.map((m) => m.userId));
      const added = userIds.filter((userId) => !existingIds.has(userId));
      if (added.length > 0) {
        // skipDuplicates relies on the (group_id, user_id) unique index, so a simultaneous request cannot duplicate.
        await tx.groupMember.createMany({ data: added.map((userId) => ({ groupId: id, userId })), skipDuplicates: true });
        await tx.group.update({ where: { id }, data: { updatedAt: new Date() } });
      }
      return new AddGroupMembersResultEntity({
        added,
        alreadyMembers: userIds.filter((userId) => existingIds.has(userId)),
        memberCount: await tx.groupMember.count({ where: { groupId: id } }),
      });
    });
  }

  /** Loads a group that is not deleted, or throws 404. */
  private async findGroup(id: string): Promise<GroupWithDetail> {
    const group = await this.prisma.group.findFirst({ where: { id, deletedAt: null }, include: detailInclude });
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
