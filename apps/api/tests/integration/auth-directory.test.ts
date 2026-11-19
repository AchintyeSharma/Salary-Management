import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth/password.js';
import { loadConfig } from '../../src/config.js';
import { runSeed, SYSTEM_SEED_EMAIL } from '../../src/scripts/seed.js';
import {
  createAdminTestPrisma,
  createAppTestPrisma,
  ensureTestMigrationsApplied,
  resetTestDatabase,
} from './helpers.js';

describe('HR authentication and employee directory API', () => {
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
    await runSeed(adminPrisma, 60);
    await adminPrisma.hrAccount.create({
      data: {
        email: 'hr.manager@acme.example',
        displayName: 'ACME HR Manager',
        passwordHash: hashPassword('test-hr-pass-123'),
        active: true,
      },
    });
  });

  afterAll(async () => {
    await adminPrisma.$disconnect();
    await appPrisma.$disconnect();
  });

  it('blocks unauthenticated requests and rejects disabled system accounts', async () => {
    expect((await request(app).get('/api/session')).status).toBe(401);
    expect((await request(app).get('/api/lookups')).status).toBe(401);
    expect((await request(app).get('/api/employees')).status).toBe(401);

    const sysLogin = await request(app)
      .post('/api/session')
      .send({ email: SYSTEM_SEED_EMAIL, password: 'any-password' });
    expect(sysLogin.status).toBe(401);
  });

  it('signs in with HttpOnly cookie, enforces origin check, and revokes session on logout', async () => {
    const agent = request.agent(app);

    // Cross-origin login rejected
    const badOrigin = await agent
      .post('/api/session')
      .set('Origin', 'https://evil.example')
      .send({ email: 'hr.manager@acme.example', password: 'test-hr-pass-123' });
    expect(badOrigin.status).toBe(403);

    const loginRes = await agent
      .post('/api/session')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'hr.manager@acme.example', password: 'test-hr-pass-123' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.account.email).toBe('hr.manager@acme.example');
    const setCookie = loginRes.headers['set-cookie']?.[0] ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const meRes = await agent.get('/api/session');
    expect(meRes.status).toBe(200);
    expect(meRes.body.account.displayName).toBe('ACME HR Manager');

    const logoutRes = await agent
      .delete('/api/session')
      .set('Origin', 'http://localhost:3000');
    expect(logoutRes.status).toBe(204);

    // Revoked session is rejected even if cookie is replayed manually
    const replayRes = await request(app).get('/api/session').set('Cookie', setCookie.split(';')[0]!);
    expect(replayRes.status).toBe(401);
  });

  it('filters, searches, stably paginates, and serves employee detail with revision history', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/session')
      .send({ email: 'hr.manager@acme.example', password: 'test-hr-pass-123' });

    // Lookups
    const lookupsRes = await agent.get('/api/lookups');
    expect(lookupsRes.status).toBe(200);
    expect(lookupsRes.body.countries).toHaveLength(4);
    expect(lookupsRes.body.fxSnapshot.rates.INR).toBe('0.0125');

    // Search by employee number & name
    const byNum = await agent.get('/api/employees?search=EMP-00001');
    expect(byNum.status).toBe(200);
    expect(byNum.body.items).toHaveLength(1);
    expect(byNum.body.items[0].displayName).toBe('Priya Sharma');

    // Inactive employee hidden under default active filter, visible under status=inactive
    const hiddenInactive = await agent.get('/api/employees?search=EMP-00005');
    expect(hiddenInactive.body.items).toHaveLength(0);
    const visibleInactive = await agent.get('/api/employees?search=EMP-00005&status=inactive');
    expect(visibleInactive.body.items).toHaveLength(1);
    expect(visibleInactive.body.items[0].active).toBe(false);

    // Stable tie-breaker pagination on a low-cardinality sort column (country)
    const p1 = await agent.get('/api/employees?status=all&sortBy=country&sortDir=asc&page=1&pageSize=20');
    const p2 = await agent.get('/api/employees?status=all&sortBy=country&sortDir=asc&page=2&pageSize=20');
    const p3 = await agent.get('/api/employees?status=all&sortBy=country&sortDir=asc&page=3&pageSize=20');
    expect(p1.status).toBe(200);
    const allIds = [
      ...p1.body.items.map((i: { id: number }) => i.id),
      ...p2.body.items.map((i: { id: number }) => i.id),
      ...p3.body.items.map((i: { id: number }) => i.id),
    ];
    expect(allIds).toHaveLength(60);
    expect(new Set(allIds).size).toBe(60);

    // Invalid sort column rejected
    const badSort = await agent.get('/api/employees?sortBy=passwordHash');
    expect(badSort.status).toBe(400);

    // Employee detail with chronological history
    const priyaId = byNum.body.items[0].id;
    const detail = await agent.get(`/api/employees/${priyaId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.currentSalary).toBe('3600000.00');
    expect(detail.body.version).toBe(3);
    expect(detail.body.revisions).toHaveLength(3);
    expect(detail.body.revisions[0].sequence).toBe(3);
    expect(detail.body.revisions[2].sequence).toBe(1);
    expect(detail.body.revisions[2].previousSalary).toBeNull();
  });
});
