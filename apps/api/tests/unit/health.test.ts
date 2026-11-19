import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

describe('GET /api/health', () => {
  it('returns ok status and interpreter mode', async () => {
    const app = createApp({ checkDatabase: async () => true });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      database: 'ok',
      interpreterMode: 'deterministic',
    });
  });

  it('returns 503 when database check fails', async () => {
    const app = createApp({ checkDatabase: async () => false });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.database).toBe('unavailable');
  });
});
