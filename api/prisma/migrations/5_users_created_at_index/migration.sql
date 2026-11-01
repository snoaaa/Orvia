-- CreateIndex
-- Supports the paginated user list: ORDER BY created_at DESC, id DESC.
CREATE INDEX `users_created_at_id_idx` ON `users`(`created_at`, `id`);
