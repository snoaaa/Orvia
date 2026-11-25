import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SYSTEM_AUDIT_CONTEXT, type AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
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
 *
 * Each addition and removal is audited (#50) with the school, the domain and the whole allowed-domain set
 * before and after, inside the same transaction under a lock on the school row so concurrent edits never race.
 */
@Injectable()
export class SchoolDomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
  async addDomain(
    schoolId: string,
    dto: AddSchoolDomainDto,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<SchoolDomainEntity> {
    assertSchoolAccess(actor, 'schools:update', schoolId);
    // Also normalized here, for callers that do not go through the validation pipe.
    const domain = normalizeDomain(dto.domain);
    if (!isValidDomain(domain)) {
      throw new BadRequestException(`'${domain}' ${INVALID_DOMAIN_MESSAGE}`);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const school = await this.lockSchool(tx, schoolId);
        const covering = await tx.schoolDomain.findFirst({
          where: { schoolId, domain: { in: [domain, ...parentDomains(domain)] } },
        });
        if (covering?.domain === domain) {
          throw new ConflictException(`Domain '${domain}' is already allowed for this school`);
        }
        if (covering) {
          throw new ConflictException(`Domain '${domain}' is already covered by '${covering.domain}' for this school`);
        }
        await assertDomainsAvailable(tx, [domain], schoolId);

        const domainsBefore = await this.domainsOf(schoolId, tx);
        const row = await tx.schoolDomain.create({ data: { schoolId, domain } });
        await this.syncAllowedDomains(tx, schoolId);
        const domainsAfter = await this.domainsOf(schoolId, tx);

        await this.audit.record(
          AuditEvents.schoolDomainAdded(
            {
              schoolId,
              school: school.name,
              domain,
              domainsBefore,
              domainsAfter,
              addedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
            },
            auditContext,
          ),
          tx,
        );

        return this.toEntity(row);
      });
    } catch (error) {
      // The unique index on school_domains.domain decides between simultaneous cross-school requests.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Domain '${domain}' is already assigned to a school`);
      }
      throw error;
    }
  }

  /** DELETE /schools/:id/domains/:domainId: 404 if the domain is not one of this school's. */
  async removeDomain(
    schoolId: string,
    domainId: string,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<void> {
    assertSchoolAccess(actor, 'schools:update', schoolId);

    await this.prisma.$transaction(async (tx) => {
      const school = await this.lockSchool(tx, schoolId);
      const row = await tx.schoolDomain.findFirst({ where: { id: domainId, schoolId } });
      if (!row) {
        throw new NotFoundException(`Domain with ID ${domainId} not found for this school`);
      }

      const domainsBefore = await this.domainsOf(schoolId, tx);
      const { count } = await tx.schoolDomain.deleteMany({ where: { id: domainId, schoolId } });
      if (count === 0) {
        throw new NotFoundException(`Domain with ID ${domainId} not found for this school`);
      }
      await this.syncAllowedDomains(tx, schoolId);
      const domainsAfter = await this.domainsOf(schoolId, tx);

      await this.audit.record(
        AuditEvents.schoolDomainRemoved(
          {
            schoolId,
            school: school.name,
            domain: row.domain,
            domainsBefore,
            domainsAfter,
            removedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
          },
          auditContext,
        ),
        tx,
      );
    });
  }

  private async findSchool(
    schoolId: string,
    db: Pick<Prisma.TransactionClient, 'school'> = this.prisma,
  ): Promise<{ id: string; name: string }> {
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true },
    });
    if (!school) {
      throw new NotFoundException(`School with ID '${schoolId}' not found`);
    }
    return school;
  }

  /** Acquires the school row lock before domain reads/writes so concurrent modifications queue cleanly. */
  private async lockSchool(tx: Prisma.TransactionClient, schoolId: string): Promise<{ id: string; name: string }> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM schools WHERE id = ${schoolId} FOR UPDATE`;
    if (locked.length === 0) {
      throw new NotFoundException(`School with ID '${schoolId}' not found`);
    }
    return this.findSchool(schoolId, tx);
  }

  /** The school's allowed domains, sorted: the before/after value of a domain audit row (#50). */
  private async domainsOf(schoolId: string, db: Pick<Prisma.TransactionClient, 'schoolDomain'>): Promise<string[]> {
    const rows = await db.schoolDomain.findMany({
      where: { schoolId },
      select: { domain: true },
      orderBy: { domain: 'asc' },
    });
    return rows.map((r) => r.domain);
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
