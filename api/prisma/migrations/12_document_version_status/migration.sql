-- Processing status (#112): a real enum on the version, the failure reason and when the status last changed.

-- Any value outside the pipeline vocabulary (e.g. the old default 'uploaded') restarts at 'pending'.
UPDATE `document_versions`
SET `status` = 'pending'
WHERE `status` NOT IN ('pending', 'ocr', 'segmentation', 'indexing', 'available', 'error');

-- AlterTable
ALTER TABLE `document_versions`
    MODIFY `status` ENUM('pending', 'ocr', 'segmentation', 'indexing', 'available', 'error') NOT NULL DEFAULT 'pending',
    ADD COLUMN `status_error` TEXT NULL,
    ADD COLUMN `status_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- The best known time of the last change for existing versions.
UPDATE `document_versions` SET `status_changed_at` = `updated_at`;

-- When the current run of a processing job started (reset when a failed version is processed again).
ALTER TABLE `processing_jobs` ADD COLUMN `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
UPDATE `processing_jobs` SET `started_at` = `created_at`;
