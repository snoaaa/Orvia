import { Prisma } from '@prisma/client';

/**
 * Assignments are soft-deleted (#49): DELETE /assignments/:id sets `deleted_at` and keeps the row for the
 * mobile sync. A removed assignment must never give access, so every reader of `user_assignments` filters with
 * this: `where: ACTIVE_ASSIGNMENT`, `{ some: { ...ACTIVE_ASSIGNMENT, ... } }`, `_count: { where: ... }`.
 * Only a sync that must report removals reads the rows without it.
 */
export const ACTIVE_ASSIGNMENT = { deletedAt: null } as const satisfies Prisma.UserAssignmentWhereInput;
