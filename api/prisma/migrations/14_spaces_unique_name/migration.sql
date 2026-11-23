-- CreateIndex
-- A space name is unique within its school (#97).
CREATE UNIQUE INDEX `spaces_school_id_name_key` ON `spaces`(`school_id`, `name`);
