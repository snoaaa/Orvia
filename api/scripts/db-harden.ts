/**
 * Makes audit_events insert-only for the application (issue #14). Run with:
 *
 *   npm run db:harden
 *
 * Needs a MySQL admin connection (DATABASE_ADMIN_URL, e.g. root), because creating
 * triggers and changing grants requires privileges the application must not have.
 * Safe to re-run; run it again after every migration that adds a table.
 *
 * MySQL with binary logging (log_bin=ON, the default since 8.0) refuses CREATE TRIGGER from an
 * account without SUPER unless log_bin_trust_function_creators = 1; this script detects that
 * case and explains the fix instead of printing the raw SQL error (see README "Audit trail").
 *
 * 1. Triggers that reject any UPDATE or DELETE on audit_events, for every user.
 * 2. Least-privilege grants for the application user taken from DATABASE_URL:
 *    - audit_events:        SELECT, INSERT          (no UPDATE / DELETE)
 *    - _prisma_migrations:  SELECT
 *    - every other table:   SELECT, INSERT, UPDATE, DELETE
 *    No DDL, TRIGGER or DROP rights, so it cannot drop the triggers or TRUNCATE the table.
 */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { loadEnv } from './load-env.js';

loadEnv();

const AUDIT_TABLE = 'audit_events';
const MIGRATIONS_TABLE = '_prisma_migrations';

// CREATE TRIGGER is not allowed as a prepared statement, so it goes through `prisma db execute`.
const TRIGGERS_SQL = 'prisma/sql/audit-events-append-only.sql';

function requireUrl(name: string): URL {
  const raw = process.env[name];
  if (!raw) {
    console.error(`Missing ${name} in api/.env (see .env.example).`);
    process.exit(1);
  }
  return new URL(raw);
}

const ident = (name: string) => `\`${name.replace(/`/g, '``')}\``;
const literal = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function main(): Promise<void> {
  const appUrl = requireUrl('DATABASE_URL');
  const adminUrl = requireUrl('DATABASE_ADMIN_URL');
  const database = appUrl.pathname.replace(/^\//, '');
  const appUser = decodeURIComponent(appUrl.username);
  const adminUser = decodeURIComponent(adminUrl.username);

  const triggers = spawnSync(`npx prisma db execute --file ${TRIGGERS_SQL} --url "${adminUrl.toString()}"`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    encoding: 'utf-8',
  });
  if (triggers.status !== 0) {
    console.error(explainTriggerFailure([triggers.stdout, triggers.stderr].join('\n'), adminUser));
    process.exit(1);
  }
  console.log('✔ Triggers installed: audit_events_block_update, audit_events_block_delete');

  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    if (appUser === adminUser) {
      console.warn(
        `⚠ DATABASE_URL uses the admin user '${appUser}'. Grants were NOT changed.\n` +
          '  The triggers still block UPDATE/DELETE, but create a dedicated application user for real insert-only rights.',
      );
      return;
    }

    const hosts = await admin.$queryRawUnsafe<{ Host: string }[]>(
      'SELECT Host FROM mysql.user WHERE User = ?',
      appUser,
    );
    if (hosts.length === 0) {
      console.error(`MySQL user '${appUser}' (from DATABASE_URL) does not exist.`);
      process.exit(1);
    }

    const tables = await admin.$queryRawUnsafe<{ name: string }[]>(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
      database,
    );

    for (const { Host } of hosts) {
      const account = `${literal(appUser)}@${literal(Host)}`;
      await admin.$executeRawUnsafe(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${account}`);
      for (const { name } of tables) {
        const rights =
          name === AUDIT_TABLE ? 'SELECT, INSERT' : name === MIGRATIONS_TABLE ? 'SELECT' : 'SELECT, INSERT, UPDATE, DELETE';
        await admin.$executeRawUnsafe(`GRANT ${rights} ON ${ident(database)}.${ident(name)} TO ${account}`);
      }
      console.log(`✔ Grants applied to ${appUser}@${Host} on ${tables.length} tables (audit_events: SELECT, INSERT only)`);
    }
  } finally {
    await admin.$disconnect();
  }
}

/** Turns the output of a failed `prisma db execute` into an actionable message. */
function explainTriggerFailure(output: string, adminUser: string): string {
  if (/SUPER privilege|binary logging is enabled|log_bin_trust_function_creators|\b1419\b/i.test(output)) {
    return [
      '✘ Could not install the audit triggers: MySQL binary logging is ON and the admin account',
      `  '${adminUser}' does not have the SUPER privilege (MySQL error 1419).`,
      '',
      '  Fix (once, as MySQL root), then run `npm run db:harden` again:',
      '    SET PERSIST log_bin_trust_function_creators = 1;   -- survives restarts (MySQL 8+)',
      '  or, until the next MySQL restart only:',
      '    SET GLOBAL log_bin_trust_function_creators = 1;',
      '',
      '  Alternatively use root in DATABASE_ADMIN_URL. See api/README.md, "Audit trail".',
    ].join('\n');
  }
  // Prisma prints a bare code ("Error: P1000") followed by the human-readable explanation.
  const reason =
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !/^Error:\s*P\d+$/.test(line)) ?? 'unknown error';
  return [
    `✘ Could not install the audit triggers from ${TRIGGERS_SQL}.`,
    `  ${reason}`,
    '  Check DATABASE_ADMIN_URL (host, user, password, database) and that the migrations ran (`npm run db:migrate`).',
  ].join('\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
