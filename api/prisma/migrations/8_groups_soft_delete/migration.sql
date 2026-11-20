-- AlterTable
-- A deleted group is kept with its deletion date (#35).
ALTER TABLE `groups` ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- CreateIndex
-- Group lists filter on the school and skip deleted groups.
CREATE INDEX `groups_school_id_deleted_at_idx` ON `groups`(`school_id`, `deleted_at`);
