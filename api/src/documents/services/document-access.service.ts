import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditEvents } from '../../audit/builders/audit-events.builder.js';
import type { RecordAuditEventInput } from '../../audit/dto/record-audit-event.input.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { type AuditRequestContext, SYSTEM_AUDIT_CONTEXT } from '../../audit/utils/audit-request-context.util.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import { ACTIVE_ASSIGNMENT } from '../../auth/utils/active-assignment.util.js';
import { assertSchoolAccess } from '../../auth/utils/school-scope.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AddDocumentAccessDto, DocumentAccessTargetDto, ReplaceDocumentAccessDto } from '../dto/index.js';
import { DocumentAccessRuleEntity } from '../entities/index.js';
import { audienceChange } from '../utils/document-audience.util.js';
import type { DocumentAccessTargetType } from '../utils/document-visibility.util.js';

/** A validated target, with the foreign key column that holds its id. */
interface ResolvedTarget {
  targetType: DocumentAccessTargetType;
  targetId: string;
  roleId?: string | null;
  groupId?: string | null;
  userId?: string | null;
}

/** A stored rule, as read inside the change transaction. */
interface StoredRule extends ResolvedTarget {
  id: string;
}

/** What a change does to the rules of a document, decided from its current rules. */
interface RulesChange {
  add: ResolvedTarget[];
  remove: StoredRule[];
}

/** What a change did: the rules added and removed. */
interface AppliedChange {
  added: ResolvedTarget[];
  removed: StoredRule[];
}

/** Sync change types written for the mobile app (#110). */
export const DOCUMENT_SYNC = { entityType: 'document', lost: 'delete', gained: 'insert' } as const;

const RULE_INCLUDE = {
  school: { select: { name: true } },
  role: { select: { name: true } },
  group: { select: { name: true } },
  user: { select: { fullName: true } },
} satisfies Prisma.DocumentAccessInclude;

const RULE_COLUMNS = {
  id: true,
  targetType: true,
  targetId: true,
  roleId: true,
  groupId: true,
  userId: true,
} satisfies Prisma.DocumentAccessSelect;

const key = (rule: { targetType: string; targetId: string }) => `${rule.targetType}:${rule.targetId}`;

/**
 * Publication rules of a document (#109, #110): who, inside the document's school, may see it.
 * Who sees what is decided by src/documents/utils/document-visibility.util.ts, from the rules on every request,
 * so a change applies to the next request at once. Every change also tells the mobile app which readers lost
 * or gained the document (sync_changes) and drops the lost document from their devices' offline selections.
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
   * Publishes a document to more targets (#109). Every target must belong to the document's school (400
   * otherwise); targets the document already has are skipped. Records `document_published` with the targets
   * added, in the same transaction as the new rules. Answers with all the rules of the document.
   */
  async addRules(
    documentId: string,
    dto: AddDocumentAccessDto,
    actor: AuthenticatedUser,
    auditContext?: AuditRequestContext,
  ): Promise<DocumentAccessRuleEntity[]> {
    const doc = await this.findManagedDocument(documentId, actor);
    const targets = await this.resolveTargets(doc.space.schoolId, dto.rules);
    await this.changeRules(
      doc.id,
      doc.space.schoolId,
      (current) => {
        const existing = new Set(current.map(key));
        return { add: targets.filter((t) => !existing.has(key(t))), remove: [] };
      },
      ({ added }) =>
        AuditEvents.documentPublished(
          {
            documentId: doc.id,
            spaceId: doc.spaceId,
            schoolId: doc.space.schoolId,
            rules: added.map(({ targetType, targetId }) => ({ type: targetType, targetId })),
            actor: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
          },
          auditContext ?? SYSTEM_AUDIT_CONTEXT,
        ),
    );
    return this.loadRules(doc.id);
  }

  /**
   * Replaces all the rules of a document (#110): targets not in `dto.rules` are removed, new ones added,
   * the others kept as they are. An empty list turns the document back into a draft. Same target checks
   * as {@link addRules}. Records `document_access_changed` unless nothing changed.
   */
  async replaceRules(
    documentId: string,
    dto: ReplaceDocumentAccessDto,
    actor: AuthenticatedUser,
    auditContext?: AuditRequestContext,
  ): Promise<DocumentAccessRuleEntity[]> {
    const doc = await this.findManagedDocument(documentId, actor);
    const targets = await this.resolveTargets(doc.space.schoolId, dto.rules);
    const wanted = new Set(targets.map(key));
    await this.changeRules(
      doc.id,
      doc.space.schoolId,
      (current) => {
        const existing = new Set(current.map(key));
        return {
          add: targets.filter((t) => !existing.has(key(t))),
          remove: current.filter((rule) => !wanted.has(key(rule))),
        };
      },
      (change) => accessChangedEvent(doc, change, actor, auditContext),
    );
    return this.loadRules(doc.id);
  }

  /** Removes one rule of a document (#110); 404 if it is not a rule of this document. */
  async removeRule(
    documentId: string,
    ruleId: string,
    actor: AuthenticatedUser,
    auditContext?: AuditRequestContext,
  ): Promise<void> {
    const doc = await this.findManagedDocument(documentId, actor);
    await this.changeRules(
      doc.id,
      doc.space.schoolId,
      (current) => {
        const rule = current.find((r) => r.id === ruleId);
        if (!rule) throw new NotFoundException(`Access rule ${ruleId} not found on document ${documentId}`);
        return { add: [], remove: [rule] };
      },
      (change) => accessChangedEvent(doc, change, actor, auditContext),
    );
  }

  /**
   * Applies a change to the rules of a document, one change at a time per document: the document row is
   * locked, so the audience before and after the change is exact even when two admins save together.
   * Readers who lose the document get a `delete` sync change and lose it from their offline selections;
   * readers who gain it get an `insert` sync change. Managers are never affected.
   * The audit event of the change (`auditOf`) is written in the same transaction; nothing is recorded
   * when nothing changed.
   */
  private async changeRules(
    documentId: string,
    schoolId: string,
    decide: (current: StoredRule[]) => RulesChange,
    auditOf: (change: AppliedChange) => RecordAuditEventInput,
  ): Promise<AppliedChange> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM documents WHERE id = ${documentId} AND deleted_at IS NULL FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException(`Document with ID ${documentId} not found`);

      const current = (await tx.documentAccess.findMany({
        where: { documentId },
        select: RULE_COLUMNS,
      })) as StoredRule[];
      const { add, remove } = decide(current);
      if (add.length === 0 && remove.length === 0) return { added: [], removed: [] };

      const removedIds = new Set(remove.map((r) => r.id));
      const after = [...current.filter((r) => !removedIds.has(r.id)), ...add];
      // Readers only see a document with an available version (#111). Until then nobody gains or loses it;
      // its first available version announces it (DocumentProcessingStatusService, #112).
      const readable = (await tx.documentVersion.count({ where: { documentId, status: 'available' } })) > 0;
      const { lost, gained } = readable
        ? await audienceChange(tx, schoolId, current, after)
        : { lost: [] as string[], gained: [] as string[] };

      if (remove.length > 0) await tx.documentAccess.deleteMany({ where: { id: { in: [...removedIds] } } });
      if (add.length > 0) {
        // Rules added together share one creation time; lists sort them by (created_at, id).
        await tx.documentAccess.createMany({ data: add.map((t) => ({ documentId, schoolId, ...t })) });
      }

      const sync = (userIds: string[], operation: string) =>
        userIds.map((userId) => ({ userId, entityType: DOCUMENT_SYNC.entityType, entityId: documentId, operation }));
      const changes = [...sync(lost, DOCUMENT_SYNC.lost), ...sync(gained, DOCUMENT_SYNC.gained)];
      if (changes.length > 0) await tx.syncChange.createMany({ data: changes });
      if (lost.length > 0) {
        await tx.offlineSelection.deleteMany({ where: { documentId, device: { userId: { in: lost } } } });
      }
      const applied = { added: add, removed: remove };
      await this.audit.record(auditOf(applied), tx);
      return applied;
    });
  }

  /** Loads a live document; 404 if missing or deleted, 403 unless `actor` manages documents in its school. */
  private async findManagedDocument(id: string, actor: AuthenticatedUser) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        spaceId: true,
        deletedAt: true,
        space: { select: { schoolId: true, deletedAt: true } },
      },
    });
    if (!doc || doc.deletedAt || doc.space.deletedAt) {
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
      resolved.set(key(target), target);
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
        return { targetType: 'school', targetId: schoolId };
      case 'role': {
        const role = roleById.get(rule.id);
        if (!role) throw new BadRequestException(`Role ${rule.id} not found`);
        if (role.scope === 'platform') {
          throw new BadRequestException(`Role ${rule.id} is a platform role; publish to a role of the school`);
        }
        return { targetType: 'role', targetId: role.id, roleId: role.id };
      }
      case 'class':
      case 'group': {
        const group = groupById.get(rule.id);
        if (!group) throw new BadRequestException(`Group ${rule.id} is not a group of the document's school`);
        if (rule.type === 'class' && group.type !== 'class') {
          throw new BadRequestException(`Group ${rule.id} is not a class; publish to it as a group`);
        }
        return { targetType: group.type === 'class' ? 'class' : 'group', targetId: group.id, groupId: group.id };
      }
      case 'user':
        if (!userSet.has(rule.id)) {
          throw new BadRequestException(`User ${rule.id} has no role in the document's school`);
        }
        return { targetType: 'user', targetId: rule.id, userId: rule.id };
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

/** The `document_access_changed` event of a change made by `actor`. */
function accessChangedEvent(
  doc: { id: string; spaceId: string; space: { schoolId: string } },
  change: AppliedChange,
  actor: AuthenticatedUser,
  auditContext?: AuditRequestContext,
): RecordAuditEventInput {
  const describe = (rules: ResolvedTarget[]) => rules.map(({ targetType, targetId }) => ({ type: targetType, targetId }));
  return AuditEvents.documentAccessChanged(
    {
      documentId: doc.id,
      spaceId: doc.spaceId,
      schoolId: doc.space.schoolId,
      added: describe(change.added),
      removed: describe(change.removed),
      actor: { userId: actor.id, role: actor.role, schoolId: actor.schoolId },
    },
    auditContext ?? SYSTEM_AUDIT_CONTEXT,
  );
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
