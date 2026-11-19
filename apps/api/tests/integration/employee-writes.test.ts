import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth/password.js';
import { loadConfig } from '../../src/config.js';
import {
  createEmployeeWithOpeningSalary,
  recordSalaryRevision,
} from '../../src/employees/writes.js';
import {
  createAdminTestPrisma,
  createAppTestPrisma,
  ensureTestMigrationsApplied,
  resetTestDatabase,
} from './helpers.js';

describe('Employee writes, shared version concurrency, idempotency, and rollback', () => {
  let adminPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  let app: ReturnType<typeof createApp>;
  let hrAccountId: number;

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
    const hr = await adminPrisma.hrAccount.create({
      data: {
        email: 'hr.manager@acme.example',
        displayName: 'ACME HR Manager',
        passwordHash: hashPassword('test-hr-pass-123'),
        active: true,
      },
    });
    hrAccountId = hr.id;
  });

  afterAll(async () => {
    await adminPrisma.$disconnect();
    await appPrisma.$disconnect();
  });

  async function signedInAgent() {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/session')
      .send({ email: 'hr.manager@acme.example', password: 'test-hr-pass-123' });
    expect(res.status).toBe(200);
    return agent;
  }

  it('creates an employee with opening revision atomically and rejects duplicate numbers', async () => {
    const agent = await signedInAgent();

    const createRes = await agent.post('/api/employees').send({
      employeeNumber: 'EMP-90001',
      displayName: 'Aarav Mehta',
      countryCode: 'IN',
      departmentCode: 'ENG',
      levelCode: 'L3',
      openingSalary: '2500000.50',
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.salaryCurrency).toBe('INR');
    expect(createRes.body.currentSalary).toBe('2500000.50');
    expect(createRes.body.version).toBe(1);
    expect(createRes.body.revisions).toHaveLength(1);
    expect(createRes.body.revisions[0].sequence).toBe(1);
    expect(createRes.body.revisions[0].previousSalary).toBeNull();
    expect(createRes.body.revisions[0].reasonCode).toBe('HIRE');

    const dupRes = await agent.post('/api/employees').send({
      employeeNumber: 'EMP-90001',
      displayName: 'Duplicate Person',
      countryCode: 'US',
      departmentCode: 'FIN',
      levelCode: 'L2',
      openingSalary: '90000',
    });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('EMPLOYEE_NUMBER_EXISTS');
  });

  it('rolls back completely after a forced write failure on create or salary revision', async () => {
    // 1. Forced failure during create employee -> zero employee rows left behind
    await expect(
      createEmployeeWithOpeningSalary(
        appPrisma,
        {
          employeeNumber: 'EMP-ROLLBACK-1',
          displayName: 'Rollback Test',
          countryCode: 'US',
          departmentCode: 'ENG',
          levelCode: 'L3',
          openingSalary: '120000',
        },
        hrAccountId,
        {
          beforeCreateOpeningRevision: () => {
            throw new Error('FORCED_CREATE_FAILURE');
          },
        },
      ),
    ).rejects.toThrow('FORCED_CREATE_FAILURE');
    expect(await adminPrisma.employee.count()).toBe(0);
    expect(await adminPrisma.salaryRevision.count()).toBe(0);

    // 2. Forced failure after revision insert before employee update -> zero revision appended, salary unchanged
    const created = await createEmployeeWithOpeningSalary(
      appPrisma,
      {
        employeeNumber: 'EMP-ROLLBACK-2',
        displayName: 'Rollback Salary',
        countryCode: 'US',
        departmentCode: 'ENG',
        levelCode: 'L3',
        openingSalary: '120000',
      },
      hrAccountId,
    );

    await expect(
      recordSalaryRevision(
        appPrisma,
        created.id,
        {
          expectedVersion: 1,
          newSalary: '135000',
          reasonCode: 'MERIT',
          requestKey: 'req_rollback_001',
        },
        hrAccountId,
        {
          beforeUpdateEmployeeAfterRevision: () => {
            throw new Error('FORCED_REVISION_FAILURE');
          },
        },
      ),
    ).rejects.toThrow('FORCED_REVISION_FAILURE');

    const afterFail = await adminPrisma.employee.findUniqueOrThrow({
      where: { id: created.id },
      include: { revisions: true },
    });
    expect(afterFail.currentSalaryMinor).toBe(12_000_000n);
    expect(afterFail.version).toBe(1);
    expect(afterFail.revisions).toHaveLength(1);
  });

  it('preserves salary ledger on profile corrections and leaves version unchanged on no-op PATCH', async () => {
    const agent = await signedInAgent();
    const created = (
      await agent.post('/api/employees').send({
        employeeNumber: 'EMP-90002',
        displayName: 'Claire Bennett',
        countryCode: 'GB',
        departmentCode: 'PROD',
        levelCode: 'L3',
        openingSalary: '80000',
      })
    ).body;

    // No-op PATCH at current version leaves version untouched
    const noopRes = await agent.patch(`/api/employees/${created.id}`).send({
      expectedVersion: 1,
      departmentCode: 'PROD',
    });
    expect(noopRes.status).toBe(200);
    expect(noopRes.body.version).toBe(1);
    expect(noopRes.body.revisions).toHaveLength(1);

    // Profile correction increments version without touching salary ledger
    const patchRes = await agent.patch(`/api/employees/${created.id}`).send({
      expectedVersion: 1,
      displayName: 'Claire Bennett-Smith',
      departmentCode: 'ENG',
      levelCode: 'L4',
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.version).toBe(2);
    expect(patchRes.body.displayName).toBe('Claire Bennett-Smith');
    expect(patchRes.body.departmentCode).toBe('ENG');
    expect(patchRes.body.levelCode).toBe('L4');
    expect(patchRes.body.currentSalary).toBe('80000.00');
    expect(patchRes.body.revisions).toHaveLength(1);
    expect(patchRes.body.revisions[0].sequence).toBe(1);
  });

  it('handles two concurrent salary updates from the same version (1 wins, 1 conflicts)', async () => {
    const agent = await signedInAgent();
    const created = (
      await agent.post('/api/employees').send({
        employeeNumber: 'EMP-90003',
        displayName: 'Concurrent Person',
        countryCode: 'US',
        departmentCode: 'ENG',
        levelCode: 'L4',
        openingSalary: '150000',
      })
    ).body;

    const [r1, r2] = await Promise.all([
      agent.post(`/api/employees/${created.id}/salary-revisions`).send({
        expectedVersion: 1,
        newSalary: '160000',
        reasonCode: 'MERIT',
        requestKey: 'req_concurrent_a',
      }),
      agent.post(`/api/employees/${created.id}/salary-revisions`).send({
        expectedVersion: 1,
        newSalary: '165000',
        reasonCode: 'PROMOTION',
        requestKey: 'req_concurrent_b',
      }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = r1.status === 201 ? r1 : r2;
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.code).toBe('VERSION_CONFLICT');
    expect(loser.body.error.details.currentEmployee.version).toBe(2);

    const detail = (await agent.get(`/api/employees/${created.id}`)).body;
    expect(detail.version).toBe(2);
    expect(detail.revisions).toHaveLength(2);
    expect(detail.currentSalary).toBe(winner.body.revision.newSalary);
  });

  it('enforces safe idempotent retry even after deactivation, and rejects changed payload on reused key', async () => {
    const agent = await signedInAgent();
    const created = (
      await agent.post('/api/employees').send({
        employeeNumber: 'EMP-90004',
        displayName: 'Idempotency Person',
        countryCode: 'DE',
        departmentCode: 'ENG',
        levelCode: 'L4',
        openingSalary: '100000',
      })
    ).body;

    // First revision succeeds
    const first = await agent.post(`/api/employees/${created.id}/salary-revisions`).send({
      expectedVersion: 1,
      newSalary: '110000',
      reasonCode: 'MERIT',
      requestKey: 'req_idem_0001',
    });
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);

    // Deactivate employee (advances version to 3)
    const deact = await agent.patch(`/api/employees/${created.id}`).send({
      expectedVersion: 2,
      active: false,
    });
    expect(deact.status).toBe(200);
    expect(deact.body.version).toBe(3);

    // Identical retry of req_idem_0001 returns original revision even after deactivation and version advance!
    const replay = await agent.post(`/api/employees/${created.id}/salary-revisions`).send({
      expectedVersion: 1,
      newSalary: '110000',
      reasonCode: 'MERIT',
      requestKey: 'req_idem_0001',
    });
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.revision.id).toBe(first.body.revision.id);
    expect(replay.body.employee.revisions).toHaveLength(2);

    // Reusing the same key with a different amount returns 409 REQUEST_KEY_CONFLICT
    const mismatch = await agent.post(`/api/employees/${created.id}/salary-revisions`).send({
      expectedVersion: 1,
      newSalary: '115000',
      reasonCode: 'MERIT',
      requestKey: 'req_idem_0001',
    });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('REQUEST_KEY_CONFLICT');
  });

  it('blocks stale salary edit after deactivation, blocks fresh edit while inactive, and keeps sequence independent across reactivation', async () => {
    const agent = await signedInAgent();
    const created = (
      await agent.post('/api/employees').send({
        employeeNumber: 'EMP-90005',
        displayName: 'Lifecycle Person',
        countryCode: 'US',
        departmentCode: 'SALES',
        levelCode: 'L3',
        openingSalary: '95000',
      })
    ).body;

    // Profile edit (v1 -> v2)
    await agent
      .patch(`/api/employees/${created.id}`)
      .send({ expectedVersion: 1, levelCode: 'L4' })
      .expect(200);

    // Deactivation wins from v2 -> v3
    await agent
      .patch(`/api/employees/${created.id}`)
      .send({ expectedVersion: 2, active: false })
      .expect(200);

    // Stale salary edit from v2 fails with 409 VERSION_CONFLICT without appending a revision
    const staleRev = await agent.post(`/api/employees/${created.id}/salary-revisions`).send({
      expectedVersion: 2,
      newSalary: '105000',
      reasonCode: 'MERIT',
      requestKey: 'req_stale_after_deact',
    });
    expect(staleRev.status).toBe(409);
    expect(staleRev.body.error.code).toBe('VERSION_CONFLICT');

    // Fresh salary edit at v3 while inactive fails with 409 EMPLOYEE_INACTIVE
    const inactiveRev = await agent.post(`/api/employees/${created.id}/salary-revisions`).send({
      expectedVersion: 3,
      newSalary: '105000',
      reasonCode: 'MERIT',
      requestKey: 'req_while_inactive',
    });
    expect(inactiveRev.status).toBe(409);
    expect(inactiveRev.body.error.code).toBe('EMPLOYEE_INACTIVE');

    // Reactivate (v3 -> v4) preserves salary and history
    const reactivated = await agent
      .patch(`/api/employees/${created.id}`)
      .send({ expectedVersion: 3, active: true })
      .expect(200);
    expect(reactivated.body.version).toBe(4);
    expect(reactivated.body.active).toBe(true);
    expect(reactivated.body.revisions).toHaveLength(1);

    // Record salary revision at v4 -> employee version becomes 5, while ledger sequence is 2!
    const revAfterReactivate = await agent
      .post(`/api/employees/${created.id}/salary-revisions`)
      .send({
        expectedVersion: 4,
        newSalary: '110000',
        reasonCode: 'PROMOTION',
        requestKey: 'req_after_reactivate',
      });
    expect(revAfterReactivate.status).toBe(201);
    expect(revAfterReactivate.body.employee.version).toBe(5);
    expect(revAfterReactivate.body.revision.sequence).toBe(2);
    expect(revAfterReactivate.body.employee.revisions).toHaveLength(2);

    // Stale deactivation from v4 fails after salary revision won (v5)
    const staleDeact = await agent
      .patch(`/api/employees/${created.id}`)
      .send({ expectedVersion: 4, active: false });
    expect(staleDeact.status).toBe(409);
    expect(staleDeact.body.error.code).toBe('VERSION_CONFLICT');
  });
});
