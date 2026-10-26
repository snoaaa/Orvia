import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SYSTEM_AUDIT_CONTEXT, type AuditRequestContext } from '../../audit/utils/audit-request-context.util.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { assertSchoolAccess, schoolsWithPermission } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { InviteUserDto } from '../dto/invite-user.dto.js';
import { UserEntity } from '../entities/user.entity.js';
import { UserMapper } from '../mappers/user.mapper.js';
import { DomainValidationService } from './domain-validation.service.js';

/** Default role assigned to invited users when none is specified. */
const DEFAULT_INVITE_ROLE = 'STUDENT';

/**
 * Handles the POST /users/invite endpoint (Issue #9).
 *
 * Business rules:
 *  1. Only authorized admins can call this (permission: users:invite).
 *  2. School-scoped admins must invite into one of their own schools (school access check).
 *  3. The invited user's email domain is validated against the school's allowed domains
 *     (school_domains). Schools with no configured domains skip domain validation.
 *  4. Invited users have no password (authProvider = 'google', status = INVITED).
 *  5. Duplicate emails are rejected with 409.
 *  6. Platform-scoped roles can only be assigned by platform admins.
 */
@Injectable()
export class InviteUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly domainValidation: DomainValidationService,
  ) {}

  async invite(
    dto: InviteUserDto,
    actor: AuthenticatedUser,
    auditContext: AuditRequestContext = SYSTEM_AUDIT_CONTEXT,
  ): Promise<UserEntity> {
    // ── 1. School access check ─────────────────────────────────────────────
    if (dto.schoolId) {
      assertSchoolAccess(actor, 'users:invite', dto.schoolId);
    } else if (schoolsWithPermission(actor, 'users:invite') !== 'all') {
      throw new BadRequestException(
        'schoolId is required: school admins must invite users into their own school',
      );
    }

    // ── 2. Resolve role (if schoolId provided) ─────────────────────────────
    const role = dto.schoolId ? await this.resolveRole(dto.schoolId, dto.role, actor) : null;
    if (!dto.schoolId && dto.role) {
      throw new BadRequestException('role requires schoolId');
    }

    // ── 3. Normalize and deduplicate email ────────────────────────────────
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new ConflictException(`A user with email '${dto.email}' already exists`);
    }

    // ── 4. Domain validation (Issue #9 + shared with Issue #11) ──────────
    if (dto.schoolId) {
      const emailDomain = this.domainValidation.extractDomain(normalizedEmail);
      if (emailDomain) {
        const domainResult = await this.domainValidation.validateDomainForSchool(emailDomain, dto.schoolId);
        // null = school has no configured domains → no restriction applies (pass through).
        // false = school has domains configured but this one is not among them → reject.
        if (domainResult.allowed === false) {
          throw new BadRequestException(
            `The email domain '${emailDomain}' is not in the allowed domains for this school. ` +
              `Check the school's configured domains in school_domains.`,
          );
        }
      }
    }

    // ── 5. Create user and assignment in a single transaction ─────────────
    const id = randomUUID();
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id,
          email: normalizedEmail,
          fullName: dto.fullName.trim(),
          authProvider: 'google', // Invited users authenticate via Google OAuth.
          passwordHash: null,     // No password for invited (non-admin) users.
          status: 'INVITED',
        },
      });

      if (dto.schoolId && role) {
        await tx.userAssignment.create({
          data: { userId: user.id, schoolId: dto.schoolId, roleId: role.id },
        });
      }

      return user;
    });

    await this.audit.record(
      AuditEvents.userInvited(
        {
          invitedUserId: created.id,
          email: created.email,
          schoolId: dto.schoolId ?? null,
          invitedBy: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
        },
        auditContext,
      ),
    );

    return UserMapper.toEntity(created);
  }

  /**
   * Resolves and validates the role name. Defaults to STUDENT.
   * Only platform admins can assign platform-scoped roles.
   */
  private async resolveRole(schoolId: string, roleName: string | undefined, actor: AuthenticatedUser) {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) throw new NotFoundException(`School with ID ${schoolId} not found`);

    const name = (roleName ?? DEFAULT_INVITE_ROLE).trim().toUpperCase();
    const role = await this.prisma.role.findUnique({ where: { name } });
    if (!role) throw new BadRequestException(`Unknown role '${name}'`);

    if (role.scope === 'platform' && schoolsWithPermission(actor, 'users:assign_role') !== 'all') {
      throw new ForbiddenException(`Only a platform administrator can assign the ${role.name} role`);
    }

    return role;
  }
}
