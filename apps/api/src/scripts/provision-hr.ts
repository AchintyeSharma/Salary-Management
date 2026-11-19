import 'dotenv/config';
import { hashPassword } from '../auth/password.js';
import { createPrismaClient } from '../db/prisma.js';

async function main() {
  const dbUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const email = process.env.HR_DEMO_EMAIL?.trim().toLowerCase();
  const displayName = process.env.HR_DEMO_NAME?.trim() || 'ACME HR Manager';
  const password = process.env.HR_DEMO_PASSWORD;

  if (!dbUrl) {
    throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL must be set.');
  }
  if (!email || !password || password.length < 8) {
    throw new Error('HR_DEMO_EMAIL and HR_DEMO_PASSWORD (min 8 chars) must be set.');
  }

  const prisma = createPrismaClient(dbUrl);
  try {
    const account = await prisma.hrAccount.upsert({
      where: { email },
      update: {
        displayName,
        passwordHash: hashPassword(password),
        active: true,
      },
      create: {
        email,
        displayName,
        passwordHash: hashPassword(password),
        active: true,
      },
    });
    console.log(
      JSON.stringify({
        event: 'hr_account_provisioned',
        accountId: account.id,
        email: account.email,
        active: account.active,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('HR provisioning failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
