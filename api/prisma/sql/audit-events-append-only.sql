-- Issue #14: reject any UPDATE or DELETE on audit_events, whoever the MySQL user is.
-- Installed by `npm run db:harden` with the admin connection (DATABASE_ADMIN_URL):
-- creating triggers needs privileges the application user must not have.
-- Re-runnable.

DROP TRIGGER IF EXISTS `audit_events_block_update`;
CREATE TRIGGER `audit_events_block_update` BEFORE UPDATE ON `audit_events`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only: UPDATE is not allowed';

DROP TRIGGER IF EXISTS `audit_events_block_delete`;
CREATE TRIGGER `audit_events_block_delete` BEFORE DELETE ON `audit_events`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only: DELETE is not allowed';
