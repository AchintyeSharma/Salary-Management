import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth/password.js';
import { loadConfig } from '../../src/config.js';
import { SYNTHETIC_FX_SNAPSHOT_ID } from '../../src/scripts/seed.js';
import {
  createAdminTestPrisma,
  createAppTestPrisma,
  ensureTestMigrationsApplied,
  resetTestDatabase,
} from './helpers.js';

describe('Read-only raise-cost preview API, exact rounding fixtures, parity, and zero-write guarantee', () => {
  let adminPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    ensureTestMigrationsApplied();
    adminPrisma = createAdminTestPrisma();
    appPrisma = createAppTestPrisma();
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_ORIGIN: 'http://localhost:3000',
      COOKIE_SECURE: 'false',
      SESSION_TTL_HOURS: '8',
    });
    app = createApp({ config, prisma: appPrisma, loginRateLimitMax: 100 });
  });

  beforeEach(async () => {
    await resetTestDatabase(adminPrisma);
    await adminPrisma.hrAccount.create({
      data: {
        email: 'hr.manager@acme.example',
        displayName: 'ACME HR Manager',
        passwordHash: hashPassword('test-hr-pass-123'),
        active: true,
      },
    });
    await adminPrisma.fxSnapshot.create({
      data: {
        id: SYNTHETIC_FX_SNAPSHOT_ID,
        asOfDate: new Date('2026-11-18T00:00:00.000Z'),
        sourceLabel: 'Synthetic assessment FX rates',
        isActive: true,
        rates: {
          create: [
            { currencyCode: 'USD', rateToUsd: '1.00000000' },
            { currencyCode: 'INR', rateToUsd: '0.01250000' },
            { currencyCode: 'GBP', rateToUsd: '1.28000000' },
            { currencyCode: 'EUR', rateToUsd: '1.08000000' },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await adminPrisma.$disconnect();
    await appPrisma.$disconnect();
  });

  async function signedInAgent() {
    const agent = request.agent(app);
    await agent
      .post('/api/session')
      .send({ email: 'hr.manager@acme.example', password: 'test-hr-pass-123' })
      .expect(200);
    return agent;
  }

  it('reproduces all three docs/design.md native and mixed-cohort USD fixtures and excludes inactive employees', async () => {
    const agent = await signedInAgent();

    // Fixture 1: INR 4,000,000 + 5% -> INR 4,200,000, diff INR 200,000
    await agent
      .post('/api/employees')
      .send({
        employeeNumber: 'EMP-PREV-1',
        displayName: 'India Four Million',
        countryCode: 'IN',
        departmentCode: 'ENG',
        levelCode: 'L4',
        openingSalary: '4000000',
      })
      .expect(201);

    // Inactive employee in same cohort MUST be excluded
    const inactiveEmp = (
      await agent
        .post('/api/employees')
        .send({
          employeeNumber: 'EMP-PREV-INACT',
          displayName: 'India Inactive',
          countryCode: 'IN',
          departmentCode: 'ENG',
          levelCode: 'L4',
          openingSalary: '2000000',
        })
        .expect(201)
    ).body;
    await agent
      .patch(`/api/employees/${inactiveEmp.id}`)
      .send({ expectedVersion: 1, active: false })
      .expect(200);

    // Fixture 2: Native 100.10 + 5% -> 105.11, diff 5.01
    await agent
      .post('/api/employees')
      .send({
        employeeNumber: 'EMP-PREV-2',
        displayName: 'US Rounding',
        countryCode: 'US',
        departmentCode: 'FIN',
        levelCode: 'L1',
        openingSalary: '100.10',
      })
      .expect(201);

    // Fixture 3: Mixed-cohort USD conversion of INR 4.25 @ 0.0125 -> cur USD 0.05, proj INR 4.46 -> USD 0.06, diff USD 0.01
    await agent
      .post('/api/employees')
      .send({
        employeeNumber: 'EMP-PREV-3',
        displayName: 'India Small Coin',
        countryCode: 'IN',
        departmentCode: 'OPS',
        levelCode: 'L1',
        openingSalary: '4.25',
      })
      .expect(201);

    // Assert Fixture 1 (native India ENG)
    const f1 = await agent
      .post('/api/reports/raise-cost-preview')
      .send({ country: 'IN', department: 'ENG', raisePercent: '5' })
      .expect(200);
    expect(f1.body.currency).toBe('INR');
    expect(f1.body.conversionApplied).toBe(false);
    expect(f1.body.fxBasis).toBeNull();
    expect(f1.body.headcount).toBe(1);
    expect(f1.body.currentAnnualSpend).toBe('4000000.00');
    expect(f1.body.projectedAnnualSpend).toBe('4200000.00');
    expect(f1.body.differenceAnnualSpend).toBe('200000.00');
    expect(f1.body.directoryPath).toBe('/employees?country=IN&department=ENG&status=active');

    // Assert Fixture 2 (native US FIN)
    const f2 = await agent
      .post('/api/reports/raise-cost-preview')
      .send({ country: 'US', department: 'FIN', raisePercent: '5' })
      .expect(200);
    expect(f2.body.currency).toBe('USD');
    expect(f2.body.conversionApplied).toBe(false);
    expect(f2.body.currentAnnualSpend).toBe('100.10');
    expect(f2.body.projectedAnnualSpend).toBe('105.11');
    expect(f2.body.differenceAnnualSpend).toBe('5.01');

    // Assert Fixture 3 (multi-country USD for OPS cohort — single INR 4.25 row converted to USD)
    const f3 = await agent
      .post('/api/reports/raise-cost-preview')
      .send({ department: 'OPS', raisePercent: '5' })
      .expect(200);
    expect(f3.body.currency).toBe('USD');
    expect(f3.body.conversionApplied).toBe(true);
    expect(f3.body.fxBasis.snapshotId).toBe(SYNTHETIC_FX_SNAPSHOT_ID);
    expect(f3.body.headcount).toBe(1);
    expect(f3.body.currentAnnualSpend).toBe('0.05');
    expect(f3.body.projectedAnnualSpend).toBe('0.06');
    expect(f3.body.differenceAnnualSpend).toBe('0.01');

    // Verify dashboard current-spend parity and directory filter parity across all active employees
    const allPreview = await agent
      .post('/api/reports/raise-cost-preview')
      .send({ raisePercent: '5' })
      .expect(200);
    const dashboardReport = await agent.get('/api/reports/compensation?status=active').expect(200);
    expect(allPreview.body.headcount).toBe(dashboardReport.body.summary.headcount);
    expect(allPreview.body.currentAnnualSpend).toBe(
      dashboardReport.body.summary.totalAnnualBaseSalary,
    );

    const dirQuery = allPreview.body.directoryPath.replace('/employees', '/api/employees');
    const matchingDir = await agent.get(dirQuery).expect(200);
    expect(matchingDir.body.pagination.totalCount).toBe(allPreview.body.headcount);
  });

  it('handles empty cohort, rejects invalid percentages, fails explicitly on missing FX, and creates zero DB writes', async () => {
    const agent = await signedInAgent();

    await agent
      .post('/api/employees')
      .send({
        employeeNumber: 'EMP-PREV-ZERO',
        displayName: 'Zero Write Check',
        countryCode: 'IN',
        departmentCode: 'ENG',
        levelCode: 'L3',
        openingSalary: '3000000',
      })
      .expect(201);

    // Snapshot DB state before running preview twice
    const beforeEmployees = await adminPrisma.employee.findMany({ orderBy: { id: 'asc' } });
    const beforeRevisions = await adminPrisma.salaryRevision.findMany({ orderBy: { id: 'asc' } });

    // Run preview twice
    await agent
      .post('/api/reports/raise-cost-preview')
      .send({ country: 'IN', department: 'ENG', raisePercent: '7.5' })
      .expect(200);
    await agent
      .post('/api/reports/raise-cost-preview')
      .send({ raisePercent: '7.5' })
      .expect(200);

    const afterEmployees = await adminPrisma.employee.findMany({ orderBy: { id: 'asc' } });
    const afterRevisions = await adminPrisma.salaryRevision.findMany({ orderBy: { id: 'asc' } });
    expect(afterEmployees).toEqual(beforeEmployees);
    expect(afterRevisions).toEqual(beforeRevisions);

    // Empty cohort
    const empty = await agent
      .post('/api/reports/raise-cost-preview')
      .send({ country: 'DE', department: 'HR', raisePercent: '5' })
      .expect(200);
    expect(empty.body.headcount).toBe(0);
    expect(empty.body.currentAnnualSpend).toBe('0.00');
    expect(empty.body.projectedAnnualSpend).toBe('0.00');
    expect(empty.body.differenceAnnualSpend).toBe('0.00');

    // Invalid percentages rejected
    for (const badPct of ['0', '-5', '5.125', '100.01', 'abc']) {
      await agent
        .post('/api/reports/raise-cost-preview')
        .send({ raisePercent: badPct })
        .expect(400);
    }

    // Missing FX rate fails multi-country preview explicitly
    await adminPrisma.fxRate.delete({
      where: {
        snapshotId_currencyCode: {
          snapshotId: SYNTHETIC_FX_SNAPSHOT_ID,
          currencyCode: 'INR',
        },
      },
    });
    const missingFx = await agent
      .post('/api/reports/raise-cost-preview')
      .send({ raisePercent: '5' });
    expect(missingFx.status).toBe(422);
    expect(missingFx.body.error.code).toBe('FX_RATE_MISSING');
  });
});
