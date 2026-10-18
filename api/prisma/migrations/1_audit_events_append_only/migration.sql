-- Issue #14: make audit_events an append-only, hash-chained table.
--
-- Rows must never change after insertion, so:
--   * the foreign keys are dropped (ON DELETE SET NULL would silently UPDATE audit rows),
--   * updated_at is dropped,
--   * seq gives a stable insertion order for verifying the chain,
--   * prev_hash / hash are unique so the chain cannot fork.
--
-- The UPDATE/DELETE blocking triggers and the insert-only grants need MySQL admin
-- rights, so they are installed separately by `npm run db:harden`.

-- DropForeignKey
ALTER TABLE `audit_events` DROP FOREIGN KEY `audit_events_actor_id_fkey`;

-- DropForeignKey
ALTER TABLE `audit_events` DROP FOREIGN KEY `audit_events_school_id_fkey`;

-- AlterTable (AUTO_INCREMENT must be declared as a key in the same statement)
ALTER TABLE `audit_events` DROP COLUMN `updated_at`,
    ADD COLUMN `seq` BIGINT NOT NULL AUTO_INCREMENT,
    ADD UNIQUE INDEX `audit_events_seq_key`(`seq`),
    MODIFY `category` VARCHAR(32) NOT NULL,
    MODIFY `action` VARCHAR(64) NOT NULL,
    MODIFY `actor_role` VARCHAR(191) NULL,
    MODIFY `entity_type` VARCHAR(191) NULL,
    MODIFY `entity_id` VARCHAR(191) NULL,
    MODIFY `ip` VARCHAR(45) NULL,
    MODIFY `prev_hash` CHAR(64) NOT NULL,
    MODIFY `hash` CHAR(64) NOT NULL,
    ALTER COLUMN `created_at` DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX `audit_events_prev_hash_key` ON `audit_events`(`prev_hash`);

-- CreateIndex
CREATE UNIQUE INDEX `audit_events_hash_key` ON `audit_events`(`hash`);

-- CreateIndex
CREATE INDEX `audit_events_category_action_idx` ON `audit_events`(`category`, `action`);

-- CreateIndex
CREATE INDEX `audit_events_created_at_idx` ON `audit_events`(`created_at`);

-- CreateTable: single-row head of the chain, locked by writers to serialize appends
CREATE TABLE `audit_chain_head` (
    `id` INTEGER NOT NULL,
    `hash` CHAR(64) NOT NULL,
    `event_seq` BIGINT NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `audit_chain_head` (`id`, `hash`, `event_seq`, `updated_at`)
VALUES (1, '0000000000000000000000000000000000000000000000000000000000000000', 0, CURRENT_TIMESTAMP(3));
