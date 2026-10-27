-- Migration: 4_add_google_sub_to_users
-- Adds the google_sub column (nullable, unique) to the users table for Google OAuth 2.0 linking (Issue #10).
-- Existing users are not affected (column is nullable).

ALTER TABLE `users`
  ADD COLUMN `google_sub` VARCHAR(191) NULL AFTER `password_hash`,
  ADD UNIQUE INDEX `users_google_sub_key` (`google_sub`);
