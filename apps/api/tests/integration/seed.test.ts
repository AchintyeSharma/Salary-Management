import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { runSeed, SEED_EMPLOYEE_COUNT, SEED_VERSION } from '../../src/scripts/seed.js';
import {
  createAdminTestPrisma,
  createAppTestPrisma,
  ensureTestMigrationsApplied,
  resetTestDatabase,
} from './helpers.js';

describe('PostgreSQL migrations, 10k deterministic seed, and role separation', () => {
  let adminPrisma: PrismaClient;
  let appPrisma: PrismaClient;

  beforeAll(() => {
    ensureTestMigrationsApplied();
    adminPrisma = createAdminTestPrisma();
    appPrisma = createAppTestPrisma();
  });

  beforeEach(async () => {
    await resetTestDatabase(adminPrisma);
  });

  afterAll(async () => {
    await adminPrisma.$disconnect();
    await appPrisma.$disconnect();
  });

  it('seeds exactly 10,000 employees with matching latest revisions and makes reruns a no-op', async () => {
    const first = await runSeed(adminPrisma, SEED_EMPLOYEE_COUNT);
    expect(first.status).toBe('seeded');
    expect(first.seedVersion).toBe(SEED_VERSION);
    expect(first.employeeCount).toBe(10_000);
    expect(first.revisionCount).toBeGreaterThan(10_000);

    const empCount = await adminPrisma.employee.count();
    expect(empCount).toBe(10_000);

    // Verify all 4 countries present and inactive cohort exists
    const countries = await adminPrisma.employee.groupBy({
      by: ['countryCode'],
      _count: { _all: true },
    });
    expect(countries.map((c) => c.countryCode).sort()).toEqual(['DE', 'GB', 'IN', 'US']);

    const inactiveCount = await adminPrisma.employee.count({ where: { active: false } });
    expect(inactiveCount).toBeGreaterThan(0);

    // Assert every single employee's current_salary_minor matches their latest revision
    const mismatches = await adminPrisma.$queryRaw<[{ mismatch_count: bigint }]>`
      SELECT COUNT(*)::bigint AS mismatch_count
      FROM employees e
      JOIN (
        SELECT DISTINCT ON (employee_id) employee_id, new_salary_minor
        FROM salary_revisions
        ORDER BY employee_id, sequence DESC
      ) latest ON latest.employee_id = e.id
      WHERE e.current_salary_minor <> latest.new_salary_minor
    `;
    expect(mismatches[0].mismatch_count).toBe(0n);

    // Documented demo record check
    const priya = await adminPrisma.employee.findUnique({
      where: { employeeNumber: 'EMP-00001' },
      include: { revisions: { orderBy: { sequence: 'asc' } } },
    });
    expect(priya?.displayName).toBe('Priya Sharma');
    expect(priya?.countryCode).toBe('IN');
    expect(priya?.currentSalaryMinor).toBe(360_000_000n);
    expect(priya?.revisions).toHaveLength(3);

    // Rerun must be a clean no-op
    const second = await runSeed(adminPrisma, SEED_EMPLOYEE_COUNT);
    expect(second.status).toBe('already_seeded');
    expect(await adminPrisma.employee.count()).toBe(10_000);
  });

  it('refuses to seed an unexpected populated database without a seed marker', async () => {
    const actor = await adminPrisma.hrAccount.create({
      data: {
        email: 'manual@acme.example',
        displayName: 'Manual',
        passwordHash: 'disabled',
        active: false,
      },
    });
    await adminPrisma.employee.create({
      data: {
        employeeNumber: 'EMP-MANUAL-1',
        displayName: 'Existing Person',
        countryCode: 'US',
        departmentCode: 'ENG',
        levelCode: 'L3',
        active: true,
        salaryCurrency: 'USD',
        currentSalaryMinor: 12_000_000n,
        version: 1,
        revisions: {
          create: {
            sequence: 1,
            previousSalaryMinor: null,
            newSalaryMinor: 12_000_000n,
            currencyCode: 'USD',
            reasonCode: 'HIRE',
            actorAccountId: actor.id,
          },
        },
      },
    });

    await expect(runSeed(adminPrisma, 10)).rejects.toThrow(/Refusing to seed/i);
  });

  it('enforces append-only permissions on salary_revisions for the runtime app role', async () => {
    await runSeed(adminPrisma, 5);
    const rev = await appPrisma.salaryRevision.findFirstOrThrow();

    await expect(
      appPrisma.salaryRevision.update({
        where: { id: rev.id },
        data: { reasonCode: 'CORRECTION' },
      }),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      appPrisma.salaryRevision.delete({
        where: { id: rev.id },
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});
