-- AlterTable
-- The comma-separated copy of the school domains can exceed 191 characters (#32).
-- MySQL only accepts a default on TEXT as an expression, hence ('') instead of ''.
ALTER TABLE `schools` MODIFY `allowed_domains` TEXT NOT NULL DEFAULT ('');
