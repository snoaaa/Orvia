-- Soft delete of spaces (#98): DELETE /documents/spaces/:id sets deleted_at (and renames the row so the
-- name can be reused in the school) instead of removing it. The documents of the space are not touched:
-- they are hidden through the space.
-- Only needs the `spaces` table of 0_init, so it is safe wherever Prisma's lexical order runs it.
ALTER TABLE `spaces` ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- Space lists filter on the school and skip deleted spaces.
CREATE INDEX `spaces_school_id_deleted_at_idx` ON `spaces`(`school_id`, `deleted_at`);
