import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/auth/password.js';
import { loadConfig } from '../../src/config.js';
import { runSeed } from '../../src/scripts/seed.js';
import {
  createAdminTestPrisma,
  createAppTestPrisma,
  ensureTestMigrationsApplied,
  resetTestDatabase,
} from './helpers.js';

describe('Ask about pay API and dashboard parity', () => {
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
      PAY_INTERPRETER_MODE: 'deterministic',
    });
    app = createApp({ config, prisma: appPrisma, loginRateLimitMax: 100 });
  });

  beforeEach(async () => {
    await resetTestDatabase(adminPrisma);
    await runSeed(adminPrisma, 100);
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

  it('requires authentication and produces identical figures to the compensation dashboard', async () => {
    // Unauthenticated rejected
    await request(app)
      .post('/api/pay-questions/interpret')
      .send({ question: 'How does annual base salary spend break down by country?' })
      .expect(401);

    const agent = request.agent(app);
    await agent
      .post('/api/session')
      .send({ email: 'hr.manager@acme.example', password: 'test-hr-pass-123' })
      .expect(200);

    // 1. India Engineering median question
    const interp1 = await agent
      .post('/api/pay-questions/interpret')
      .send({ question: 'What is the median annual base salary for Engineering in India?' })
      .expect(200);

    expect(interp1.body.outcome).toBe('report_intent');
    const filters1 = interp1.body.intent.filters;

    const confirmed1 = await agent.get('/api/reports/compensation').query(filters1).expect(200);
    const directDashboard1 = await agent
      .get('/api/reports/compensation?country=IN&department=ENG&status=active')
      .expect(200);

    expect(confirmed1.body).toEqual(directDashboard1.body);
    expect(confirmed1.body.currency).toBe('INR');
    expect(confirmed1.body.conversionApplied).toBe(false);

    // 2. Spend breakdown by country
    const interp2 = await agent
      .post('/api/pay-questions/interpret')
      .send({ question: 'How does annual base salary spend break down by country?' })
      .expect(200);

    expect(interp2.body.outcome).toBe('report_intent');
    const confirmed2 = await agent
      .get('/api/reports/compensation')
      .query(interp2.body.intent.filters)
      .expect(200);
    const directDashboard2 = await agent
      .get('/api/reports/compensation?groupBy=country&status=active')
      .expect(200);

    expect(confirmed2.body).toEqual(directDashboard2.body);
    expect(confirmed2.body.currency).toBe('USD');
    expect(confirmed2.body.groups).toHaveLength(4);
  });
});
