-- Chat answer contract (#119): the "not enough evidence" flag of an answer and the citation markers.

-- AlterTable
ALTER TABLE `messages` ADD COLUMN `not_enough_evidence` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `message_references` ADD COLUMN `marker` INTEGER NULL;

-- Existing references are numbered 1, 2, 3... per message, in the order they were listed so far.
UPDATE `message_references` mr
    JOIN (
        SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `message_id` ORDER BY `created_at`, `id`) AS `position`
        FROM `message_references`
    ) numbered ON numbered.`id` = mr.`id`
SET mr.`marker` = numbered.`position`;

ALTER TABLE `message_references` MODIFY `marker` INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `message_references_message_id_marker_key` ON `message_references`(`message_id`, `marker`);
