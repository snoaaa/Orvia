/**
 * Applies Prisma migrations as the MySQL admin (DATABASE_ADMIN_URL), then re-applies
 * the audit hardening, because the application user has no DDL rights:
 *
 *   npm run db:migrate
 */
import { spawnSync } from 'node:child_process';
import { loadEnv } from './load-env.js';

loadEnv();

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error('Missing DATABASE_ADMIN_URL in api/.env (see .env.example).');
  process.exit(1);
}

const run = (cmd: string, env: NodeJS.ProcessEnv = process.env) => {
  const result = spawnSync(cmd, { stdio: 'inherit', shell: true, env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('npx prisma migrate deploy', { ...process.env, DATABASE_URL: adminUrl });
run('npx tsx scripts/db-harden.ts');
