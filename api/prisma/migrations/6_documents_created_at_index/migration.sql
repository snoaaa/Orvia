-- CreateIndex
-- Supports the paginated document list: ORDER BY created_at DESC, id DESC.
CREATE INDEX `documents_created_at_id_idx` ON `documents`(`created_at`, `id`);
