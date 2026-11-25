import { Prisma } from '@prisma/client';

/**
 * Spaces are soft-deleted (#98): DELETE /documents/spaces/:id sets `deleted_at` and keeps the row. A deleted
 * space must never be listed, opened, edited or written to, so every reader of `spaces` filters with this:
 * `where: ACTIVE_SPACE`, `{ id, ...ACTIVE_SPACE }`.
 */
export const ACTIVE_SPACE = { deletedAt: null } as const satisfies Prisma.SpaceWhereInput;

/**
 * A document is visible when it is not deleted itself AND its space is not deleted: the documents of a deleted
 * space keep `deleted_at = NULL` and are hidden only through the space. Every reader of `documents` filters with
 * this, and everything that reaches a document from below goes through it too, in particular the RAG retrieval:
 * `documentVersion: { where: { document: ACTIVE_DOCUMENT } }`, chunks `{ version: { document: ACTIVE_DOCUMENT } }`.
 */
export const ACTIVE_DOCUMENT = { deletedAt: null, space: ACTIVE_SPACE } as const satisfies Prisma.DocumentWhereInput;
