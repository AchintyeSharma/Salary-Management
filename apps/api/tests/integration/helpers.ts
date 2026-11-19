import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../../src/db/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, '../..');

export const TEST_ADMIN_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://acme_admin:local_admin_dev_pass@localhost:5432/acme_test?schema=public';

export const TEST_APP_URL =
  process.env.TEST_APP_DATABASE_URL ??
  'postgresql://acme_app:local_app_dev_pass@localhost:5432/acme_test?schema=public';

let migrated = false;

export function ensureTestMigrationsApplied(): void {
  if (migrated) return;
  execSync('npx prisma migrate deploy', {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_ADMIN_URL },
    stdio: 'pipe',
  });
  migrated = true;
}

export function createAdminTestPrisma(): PrismaClient {
  return createPrismaClient(TEST_ADMIN_URL);
}

export function createAppTestPrisma(): PrismaClient {
  return createPrismaClient(TEST_APP_URL);
}

export async function resetTestDatabase(adminPrisma: PrismaClient): Promise<void> {
  await adminPrisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "salary_revisions",
      "hr_sessions",
      "employees",
      "fx_rates",
      "fx_snapshots",
      "hr_accounts",
      "seed_markers"
    RESTART IDENTITY CASCADE;
  `);
}
