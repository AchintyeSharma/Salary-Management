import 'dotenv/config';
import { execSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, '../..');
const schemaPath = path.resolve(apiRoot, 'prisma/schema.prisma');

const migrationUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!migrationUrl) {
  console.error('MIGRATION_DATABASE_URL or DATABASE_URL must be set.');
  process.exit(1);
}

try {
  execSync(`npx prisma migrate deploy --schema="${schemaPath}"`, {
    stdio: 'inherit',
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL: migrationUrl,
    },
  });
} catch (error) {
  console.error('Migration failed');
  process.exit(1);
}
