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

describe('Compensation reporting exact SQL rules, FX basis, and deactivate/reactivate parity', () => {
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

  it('reproduces docs/design.md multi-country USD, native India, and grouped breakdown fixtures', async () => {
    const agent = await signedInAgent();

    await agent
      .post('/api/employees')
      .send({
        employeeNumber: 'EMP-FIX-1',
        displayName: 'US One',
        countryCode: 'US',
        departmentCode: 'ENG',
        levelCode: 'L3',
        openingSalary: '60000',
      })
      .expect(201);

    await agent
      .post('/api/employees')
      .send({
        employeeNumber: 'EMP-FIX-2',
        displayName: 'US Two',
        countryCode: 'US',
        departmentCode: 'ENG',
        levelCode: 'L4',
        openingSalary: '80000',
      })
      .expect(201);

    const indiaEmp = (
      await agent
        .post('/api/employees')
        .send({
          employeeNumber: 'EMP-FIX-3',
          displayName: 'India One',
          countryCode: 'IN',
          departmentCode: 'ENG',
          levelCode: 'L3',
          openingSalary: '4000000',
        })
        .expect(201)
    ).body;

    // Org-wide USD overview: USD 60k + USD 80k + INR 4M @ 0.0125 (= USD 50k) => total USD 190k, median USD 60k
    const orgReport = await agent.get('/api/reports/compensation').expect(200);
    expect(orgReport.body.currency).toBe('USD');
    expect(orgReport.body.conversionApplied).toBe(true);
    expect(orgReport.body.fxBasis.snapshotId).toBe(SYNTHETIC_FX_SNAPSHOT_ID);
    expect(orgReport.body.summary).toEqual({
      headcount: 3,
      totalAnnualBaseSalary: '190000.00',
      medianAnnualBaseSalary: '60000.00',
    });

    // India-only overview reports native INR with NO conversion
    const indiaReport = await agent.get('/api/reports/compensation?country=IN').expect(200);
    expect(indiaReport.body.currency).toBe('INR');
    expect(indiaReport.body.conversionApplied).toBe(false);
    expect(indiaReport.body.fxBasis).toBeNull();
    expect(indiaReport.body.summary).toEqual({
      headcount: 1,
      totalAnnualBaseSalary: '4000000.00',
      medianAnnualBaseSalary: '4000000.00',
    });

    // Grouped by country uses USD for both rows
    const byCountry = await agent.get('/api/reports/compensation?groupBy=country').expect(200);
    expect(byCountry.body.currency).toBe('USD');
    expect(byCountry.body.groups).toEqual([
      {
        key: 'US',
        label: 'United States',
        headcount: 2,
        totalAnnualBaseSalary: '140000.00',
        medianAnnualBaseSalary: '70000.00',
      },
      {
        key: 'IN',
        label: 'India',
        headcount: 1,
        totalAnnualBaseSalary: '50000.00',
        medianAnnualBaseSalary: '50000.00',
      },
    ]);

    // Deactivating India employee immediately removes them from active report
    await agent
      .patch(`/api/employees/${indiaEmp.id}`)
      .send({ expectedVersion: 1, active: false })
      .expect(200);

    const afterDeact = await agent.get('/api/reports/compensation').expect(200);
    expect(afterDeact.body.summary).toEqual({
      headcount: 2,
      totalAnnualBaseSalary: '140000.00',
      medianAnnualBaseSalary: '70000.00',
    });

    // Reactivating restores exact original numbers
    await agent
      .patch(`/api/employees/${indiaEmp.id}`)
      .send({ expectedVersion: 2, active: true })
      .expect(200);

    const afterReact = await agent.get('/api/reports/compensation').expect(200);
    expect(afterReact.body.summary).toEqual({
      headcount: 3,
      totalAnnualBaseSalary: '190000.00',
      medianAnnualBaseSalary: '60000.00',
    });
  });

  it('rounds even-cohort median half-up (USD 100.00 & 100.01 -> 100.01) and returns null median for empty cohort', async () => {
    const agent = await signedInAgent();

    await agent
      .post('/api/employees')
      .send({
        employeeNumber: 'EMP-EVEN-1',
        displayName: 'Even One',
        countryCode: 'US',
        departmentCode: 'FIN',
        levelCode: 'L1',
        openingSalary: '100.00',
      })
      .expect(201);

    await agent
      .post('/api/employees')
      .send({
        employeeNumber: 'EMP-EVEN-2',
        displayName: 'Even Two',
        countryCode: 'US',
        departmentCode: 'FIN',
        levelCode: 'L1',
        openingSalary: '100.01',
      })
      .expect(201);

    const evenReport = await agent
      .get('/api/reports/compensation?country=US&department=FIN')
      .expect(200);
    expect(evenReport.body.summary).toEqual({
      headcount: 2,
      totalAnnualBaseSalary: '200.01',
      medianAnnualBaseSalary: '100.01',
    });

    const emptyReport = await agent
      .get('/api/reports/compensation?country=DE&department=HR')
      .expect(200);
    expect(emptyReport.body.summary).toEqual({
      headcount: 0,
      totalAnnualBaseSalary: '0.00',
      medianAnnualBaseSalary: null,
    });
  });

  it('fails USD reporting explicitly when an FX rate is missing from the active snapshot', async () => {
    const agent = await signedInAgent();

    await agent
      .post('/api/employees')
      .send({
        employeeNumber: 'EMP-FX-1',
        displayName: 'India Missing FX',
        countryCode: 'IN',
        departmentCode: 'ENG',
        levelCode: 'L3',
        openingSalary: '3000000',
      })
      .expect(201);

    await adminPrisma.fxRate.delete({
      where: {
        snapshotId_currencyCode: {
          snapshotId: SYNTHETIC_FX_SNAPSHOT_ID,
          currencyCode: 'INR',
        },
      },
    });

    // Multi-country USD report fails explicitly
    const usdErr = await agent.get('/api/reports/compensation');
    expect(usdErr.status).toBe(422);
    expect(usdErr.body.error.code).toBe('FX_RATE_MISSING');

    // Single-country native INR report still succeeds because conversion is not needed
    const nativeOk = await agent.get('/api/reports/compensation?country=IN');
    expect(nativeOk.status).toBe(200);
    expect(nativeOk.body.currency).toBe('INR');
  });
});
