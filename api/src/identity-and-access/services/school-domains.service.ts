import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AddSchoolDomainDto } from '../dto/index.js';
import { SchoolDomainEntity } from '../entities/index.js';
import {
  assertDomainsAvailable,
  INVALID_DOMAIN_MESSAGE,
  isValidDomain,
  normalizeDomain,
  parentDomains,
} from '../utils/school-domain.util.js';

/**
 * Allowed email domains of a school (#32, Section 4.6). Invitations and Google login read `school_domains`
 * on every request, so a change applies to the next one. A school without domains restricts nothing.
 */
@Injectable()
export class SchoolDomainsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /schools/:id/domains: the domains with the ids needed to remove them. */
  async listDomains(schoolId: string, actor: AuthenticatedUser): Promise<SchoolDomainEntity[]> {
    assertSchoolAccess(actor, 'schools:read', schoolId);
    await this.findSchool(schoolId);
    const rows = await this.prisma.schoolDomain.findMany({ where: { schoolId }, orderBy: { domain: 'asc' } });
    return rows.map((row) => this.toEntity(row));
  }

  /**
   * POST /schools/:id/domains: 409 if this school already has it or one of its parents (it would be redundant),
   * or if another school has it, a parent or a subdomain. Adding a broader parent to this school is allowed.
   */
  async addDomain(schoolId: string, dto: AddSchoolDomainDto, actor: AuthenticatedUser): Promise<SchoolDomainEntity> {
    assertSchoolAccess(actor, 'schools:update', schoolId);
    await this.findSchool(schoolId);
    // Also normalized here, for callers that do not go through the validation pipe.
    const domain = normalizeDomain(dto.domain);
    if (!isValidDomain(domain)) {
      throw new BadRequestException(`'${domain}' ${INVALID_DOMAIN_MESSAGE}`);
    }

    const covering = await this.prisma.schoolDomain.findFirst({
      where: { schoolId, domain: { in: [domain, ...parentDomains(domain)] } },
    });
    if (covering?.domain === domain) {
      throw new ConflictException(`Domain '${domain}' is already allowed for this school`);
    }
    if (covering) {
      throw new ConflictException(`Domain '${domain}' is already covered by '${covering.domain}' for this school`);
    }
    await assertDomainsAvailable(this.prisma, [domain], schoolId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.schoolDomain.create({ data: { schoolId, domain } });
        await this.syncAllowedDomains(tx, schoolId);
        return this.toEntity(row);
      });
    } catch (error) {
      // The unique index on school_domains.domain decides between simultaneous requests.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Domain '${domain}' is already assigned to a school`);
      }
      throw error;
    }
  }

  /** DELETE /schools/:id/domains/:domainId: 404 if the domain is not one of this school's. */
  async removeDomain(schoolId: string, domainId: string, actor: AuthenticatedUser): Promise<void> {
    assertSchoolAccess(actor, 'schools:update', schoolId);
    await this.findSchool(schoolId);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.schoolDomain.deleteMany({ where: { id: domainId, schoolId } });
      if (count === 0) {
        throw new NotFoundException(`Domain with ID ${domainId} not found for this school`);
      }
      await this.syncAllowedDomains(tx, schoolId);
    });
  }

  private async findSchool(schoolId: string): Promise<void> {
    if (!(await this.prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } }))) {
      throw new NotFoundException(`School with ID '${schoolId}' not found`);
    }
  }

  /** Keeps the `schools.allowed_domains` text copy (shown by GET /schools) equal to the domain rows. */
  private async syncAllowedDomains(tx: Prisma.TransactionClient, schoolId: string): Promise<void> {
    const rows = await tx.schoolDomain.findMany({
      where: { schoolId },
      orderBy: [{ createdAt: 'asc' }, { domain: 'asc' }],
      select: { domain: true },
    });
    await tx.school.update({ where: { id: schoolId }, data: { allowedDomains: rows.map((r) => r.domain).join(',') } });
  }

  private toEntity(row: { id: string; schoolId: string; domain: string; createdAt: Date }): SchoolDomainEntity {
    return new SchoolDomainEntity({ id: row.id, schoolId: row.schoolId, domain: row.domain, createdAt: row.createdAt });
  }
}
