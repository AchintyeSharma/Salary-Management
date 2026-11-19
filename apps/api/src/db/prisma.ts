import { PrismaClient } from '@prisma/client';

let singleton: PrismaClient | null = null;

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient(
    databaseUrl
      ? {
          datasources: {
            db: {
              url: databaseUrl,
            },
          },
        }
      : undefined,
  );
}

export function getPrismaClient(): PrismaClient {
  if (!singleton) {
    singleton = createPrismaClient();
  }
  return singleton;
}

export async function checkDatabaseConnection(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
