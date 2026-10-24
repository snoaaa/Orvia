-- Issue #12: refresh tokens are stateful, rotated on every refresh, and stored hashed only.
--
-- refresh_token is dropped instead of renamed: any value it held was an unhashed token.
-- Sessions created before this migration have no hash, so they can no longer be refreshed
-- (their users simply log in again).

-- AlterTable
ALTER TABLE `sessions` DROP COLUMN `refresh_token`,
    ADD COLUMN `refresh_token_hash` CHAR(64) NULL,
    ADD COLUMN `last_used_at` DATETIME(3) NULL,
    ADD COLUMN `ip` VARCHAR(45) NULL,
    ADD COLUMN `user_agent` VARCHAR(255) NULL;

-- CreateIndex (used by the scheduled cleanup of expired sessions)
CREATE INDEX `sessions_expires_at_idx` ON `sessions`(`expires_at`);
