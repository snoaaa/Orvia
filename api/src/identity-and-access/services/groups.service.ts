import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess, schoolIdFilter } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CreateGroupDto } from '../dto/index.js';
import { GroupEntity } from '../entities/index.js';

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

  /** GET /groups/:id (§4.5, §4.7, #89): 403 outside caller's schools. */
  async findGroupById(id: string, actor: AuthenticatedUser): Promise<GroupEntity> {
    const group = await this.prisma.group.findUnique({
      where: { id },
    });
    if (!group) {
      throw new NotFoundException(`Group with ID ${id} not found`);
    }
    assertSchoolAccess(actor, 'groups:read', group.schoolId);
    return new GroupEntity(group);
  }

  /** GET /groups (§4.5, §4.7, #89): list groups filtered at query level by caller's schools. */
  async findAllGroups(actor: AuthenticatedUser, schoolId?: string): Promise<GroupEntity[]> {
    if (schoolId) {
      assertSchoolAccess(actor, 'groups:read', schoolId);
    }
    const allowed = schoolIdFilter(actor, 'groups:read');
    const where: Prisma.GroupWhereInput = schoolId
      ? { schoolId }
      : allowed
        ? { schoolId: allowed }
        : {};
    const groups = await this.prisma.group.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return groups.map((g) => new GroupEntity(g));
  }
}
