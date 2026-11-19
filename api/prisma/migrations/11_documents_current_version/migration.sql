-- Document list (#111): each document points to its latest version, and tags are stored in one clean form.

-- AlterTable
ALTER TABLE `documents` ADD COLUMN `current_version_id` VARCHAR(191) NULL;

-- The current version of an existing document is its highest version number.
UPDATE `documents` d
    JOIN (
        SELECT v.`document_id`, v.`id`
        FROM `document_versions` v
        JOIN (
            SELECT `document_id`, MAX(`version_no`) AS `version_no`
            FROM `document_versions`
            GROUP BY `document_id`
        ) latest ON latest.`document_id` = v.`document_id` AND latest.`version_no` = v.`version_no`
    ) cur ON cur.`document_id` = d.`id`
SET d.`current_version_id` = cur.`id`;

-- Tags are a comma-separated list: no spaces around commas, no empty tags ("a , ,b," becomes "a,b"),
-- so the list can filter on whole tags.
UPDATE `documents`
SET `tags` = TRIM(BOTH ',' FROM REGEXP_REPLACE(REGEXP_REPLACE(TRIM(`tags`), '[[:space:]]*,[[:space:]]*', ','), ',{2,}', ','))
WHERE `tags` <> '';

-- CreateIndex
CREATE UNIQUE INDEX `documents_current_version_id_key` ON `documents`(`current_version_id`);

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_current_version_id_fkey` FOREIGN KEY (`current_version_id`) REFERENCES `document_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
