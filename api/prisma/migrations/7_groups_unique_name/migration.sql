-- CreateIndex
-- A group name is unique within its school (#33).
CREATE UNIQUE INDEX `groups_school_id_name_key` ON `groups`(`school_id`, `name`);
