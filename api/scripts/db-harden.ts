/**
 * Makes audit_events insert-only for the application (issue #14). Run with:
 *
 *   npm run db:harden
 *
 * Needs a MySQL admin connection (DATABASE_ADMIN_URL, e.g. root), because creating
 * triggers and changing grants requires privileges the application must not have.
 * Safe to re-run; run it again after every migration that adds a table.
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
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: true,
  });
  if (triggers.status !== 0) {
    console.error(`Could not install the triggers from ${TRIGGERS_SQL}.`);
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
