-- Publication rules (#109): each rule names one target (school, role, class, group or user) of the document's school.

-- AlterTable
ALTER TABLE `document_access`
    ADD COLUMN `target_type` VARCHAR(16) NULL,
    ADD COLUMN `target_id` VARCHAR(191) NULL,
    ADD COLUMN `user_id` VARCHAR(191) NULL;

-- Nothing wrote rules before #109, but convert any existing row: the most specific column set is the target.
UPDATE `document_access` da
    LEFT JOIN `groups` g ON g.`id` = da.`group_id`
SET da.`target_type` = CASE
        WHEN da.`group_id` IS NOT NULL THEN IF(g.`type` = 'class', 'class', 'group')
        WHEN da.`role_id` IS NOT NULL THEN 'role'
        ELSE 'school'
    END,
    da.`target_id` = COALESCE(da.`group_id`, da.`role_id`, da.`school_id`);

-- A row without any target granted nothing; drop it, and keep one row per target.
DELETE FROM `document_access` WHERE `target_id` IS NULL;
DELETE a FROM `document_access` a
    JOIN `document_access` b
      ON b.`document_id` = a.`document_id` AND b.`target_type` = a.`target_type` AND b.`target_id` = a.`target_id`
     AND b.`id` < a.`id`;

-- Every rule carries the document's school, so retrieval can filter by school without joining spaces.
UPDATE `document_access` da
    JOIN `documents` d ON d.`id` = da.`document_id`
    JOIN `spaces` s ON s.`id` = d.`space_id`
SET da.`school_id` = s.`school_id`;
DELETE FROM `document_access` WHERE `school_id` IS NULL;

ALTER TABLE `document_access`
    MODIFY `target_type` VARCHAR(16) NOT NULL,
    MODIFY `target_id` VARCHAR(191) NOT NULL,
    MODIFY `school_id` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `document_access_document_id_target_type_target_id_key` ON `document_access`(`document_id`, `target_type`, `target_id`);

-- CreateIndex
CREATE INDEX `document_access_user_id_idx` ON `document_access`(`user_id`);

-- AddForeignKey
ALTER TABLE `document_access` ADD CONSTRAINT `document_access_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
