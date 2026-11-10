-- Soft delete of assignments (#49): DELETE /assignments/:id sets deleted_at instead of removing the row,
-- so the mobile sync can see the removal (updated_at moves in the same write).
ALTER TABLE `user_assignments` ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- Supports the "last school admin" count and the per-school lists of active assignments.
CREATE INDEX `user_assignments_school_id_deleted_at_idx` ON `user_assignments`(`school_id`, `deleted_at`);
