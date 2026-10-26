-- Review of #12: tolerate a refresh token being reused within a few seconds of its rotation
-- (automatic retry after a network hiccup) instead of revoking the session.
-- The hash replaced by the last rotation and the rotation time are kept for that check.

-- AlterTable
ALTER TABLE `sessions` ADD COLUMN `previous_refresh_token_hash` CHAR(64) NULL,
    ADD COLUMN `refresh_rotated_at` DATETIME(3) NULL;
