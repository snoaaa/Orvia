import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { type AuditRequestContext, SYSTEM_AUDIT_CONTEXT } from '../../audit/utils/audit-request-context.util.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { ACTIVE_ASSIGNMENT } from '../../auth/utils/active-assignment.util.js';
import { assertSchoolAccess } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AddDocumentAccessDto, DocumentAccessTargetDto } from '../dto/index.js';
import { DocumentAccessRuleEntity } from '../entities/index.js';
import type { DocumentAccessTargetType } from '../utils/document-visibility.util.js';

/** A validated target, with the foreign key column that holds its id. */
interface ResolvedTarget {
  type: DocumentAccessTargetType;
  targetId: string;
  roleId?: string;
  groupId?: string;
  userId?: string;
}

const RULE_INCLUDE = {
  school: { select: { name: true } },
  role: { select: { name: true } },
  group: { select: { name: true } },
  user: { select: { fullName: true } },
} satisfies Prisma.DocumentAccessInclude;

/**
 * Publication rules of a document (#109): who, inside the document's school, may see it.
 * Who sees what is decided by src/documents/utils/document-visibility.util.ts.
 */
@Injectable()
export class DocumentAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The rules of a document, oldest first. */
  async listRules(documentId: string, actor: AuthenticatedUser): Promise<DocumentAccessRuleEntity[]> {
    const doc = await this.findManagedDocument(documentId, actor);
    return this.loadRules(doc.id);
  }

  /**
   * Publishes a document to more targets. Every target must belong to the document's school (400 otherwise);
   * targets the document already has are skipped. Records `document_published` with the targets added.
   * The new rules and the audit event are written in one transaction: both are stored, or neither.
   * Answers with all the rules of the document.
   */
  async addRules(
    documentId: string,
    dto: AddDocumentAccessDto,
    actor: AuthenticatedUser,
    auditContext?: AuditRequestContext,
  ): Promise<DocumentAccessRuleEntity[]> {
    const doc = await this.findManagedDocument(documentId, actor);
    const schoolId = doc.space.schoolId;
    const targets = await this.resolveTargets(schoolId, dto.rules);

    await this.prisma.$transaction(async (tx) => {
      // Lock the document, so a simultaneous publication waits and then sees the rules added here.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM documents WHERE id = ${doc.id} AND deleted_at IS NULL FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException(`Document with ID ${doc.id} not found`);

      const existing = await tx.documentAccess.findMany({
        where: { documentId: doc.id },
        select: { targetType: true, targetId: true },
      });
      const known = new Set(existing.map((r) => `${r.targetType}:${r.targetId}`));
      const added = targets.filter((t) => !known.has(`${t.type}:${t.targetId}`));
      if (added.length === 0) return;

      await tx.documentAccess.createMany({
        data: added.map(({ type, ...columns }) => ({ documentId: doc.id, schoolId, targetType: type, ...columns })),
      });
      await this.audit.record(
        AuditEvents.documentPublished(
          {
            documentId: doc.id,
            spaceId: doc.spaceId,
            schoolId,
            rules: added.map(({ type, targetId }) => ({ type, targetId })),
            actor: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
          },
          auditContext ?? SYSTEM_AUDIT_CONTEXT,
        ),
        tx,
      );
    });

    return this.loadRules(doc.id);
  }

  /** Loads a live document; 404 if missing or deleted, 403 unless `actor` manages documents in its school. */
  private async findManagedDocument(id: string, actor: AuthenticatedUser) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { id: true, spaceId: true, deletedAt: true, space: { select: { schoolId: true } } },
    });
    if (!doc || doc.deletedAt) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }
    assertSchoolAccess(actor, 'documents:manage', doc.space.schoolId);
    return doc;
  }

  /**
   * Checks every target against the document's school and returns them without duplicates.
   * A class sent as `group` is stored as `class`, so the same group is never published to twice.
   */
  private async resolveTargets(schoolId: string, rules: DocumentAccessTargetDto[]): Promise<ResolvedTarget[]> {
    const idsOf = (...types: DocumentAccessTargetType[]) => [
      ...new Set(rules.filter((r) => types.includes(r.type)).map((r) => r.id)),
    ];
    const roleIds = idsOf('role');
    const groupIds = idsOf('class', 'group');
    const userIds = idsOf('user');

    const [roles, groups, users] = await Promise.all([
      roleIds.length ? this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, scope: true } }) : [],
      groupIds.length
        ? this.prisma.group.findMany({
            where: { id: { in: groupIds }, schoolId, deletedAt: null },
            select: { id: true, type: true },
          })
        : [],
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds }, assignments: { some: { schoolId, ...ACTIVE_ASSIGNMENT } } },
            select: { id: true },
          })
        : [],
    ]);
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const userSet = new Set(users.map((u) => u.id));

    const resolved = new Map<string, ResolvedTarget>();
    for (const rule of rules) {
      const target = this.resolveTarget(schoolId, rule, roleById, groupById, userSet);
      resolved.set(`${target.type}:${target.targetId}`, target);
    }
    return [...resolved.values()];
  }

  private resolveTarget(
    schoolId: string,
    rule: DocumentAccessTargetDto,
    roleById: Map<string, { id: string; scope: string }>,
    groupById: Map<string, { id: string; type: string }>,
    userSet: Set<string>,
  ): ResolvedTarget {
    switch (rule.type) {
      case 'school':
        if (rule.id !== schoolId) {
          throw new BadRequestException(`School ${rule.id} is not the school of this document`);
        }
        return { type: 'school', targetId: schoolId };
      case 'role': {
        const role = roleById.get(rule.id);
        if (!role) throw new BadRequestException(`Role ${rule.id} not found`);
        if (role.scope === 'platform') {
          throw new BadRequestException(`Role ${rule.id} is a platform role; publish to a role of the school`);
        }
        return { type: 'role', targetId: role.id, roleId: role.id };
      }
      case 'class':
      case 'group': {
        const group = groupById.get(rule.id);
        if (!group) throw new BadRequestException(`Group ${rule.id} is not a group of the document's school`);
        if (rule.type === 'class' && group.type !== 'class') {
          throw new BadRequestException(`Group ${rule.id} is not a class; publish to it as a group`);
        }
        return { type: group.type === 'class' ? 'class' : 'group', targetId: group.id, groupId: group.id };
      }
      case 'user':
        if (!userSet.has(rule.id)) {
          throw new BadRequestException(`User ${rule.id} has no role in the document's school`);
        }
        return { type: 'user', targetId: rule.id, userId: rule.id };
    }
  }

  private async loadRules(documentId: string): Promise<DocumentAccessRuleEntity[]> {
    const rows = await this.prisma.documentAccess.findMany({
      where: { documentId },
      include: RULE_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(
      (row) =>
        new DocumentAccessRuleEntity({
          id: row.id,
          documentId: row.documentId,
          type: row.targetType as DocumentAccessTargetType,
          targetId: row.targetId,
          targetName: ruleTargetName(row),
          createdAt: row.createdAt,
        }),
    );
  }
}

function ruleTargetName(row: Prisma.DocumentAccessGetPayload<{ include: typeof RULE_INCLUDE }>): string | null {
  switch (row.targetType) {
    case 'school':
      return row.school.name;
    case 'role':
      return row.role?.name ?? null;
    case 'class':
    case 'group':
      return row.group?.name ?? null;
    case 'user':
      return row.user?.fullName ?? null;
    default:
      return null;
  }
}
