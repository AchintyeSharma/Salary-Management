import 'dotenv/config';
import { createPrismaClient } from '../db/prisma.js';

const BASE_URL = (process.env.BENCH_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const EMAIL = process.env.HR_DEMO_EMAIL ?? 'hr.manager@acme.example';
const PASSWORD = process.env.HR_DEMO_PASSWORD ?? 'acme-local-demo-pass';
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? '5');
const ITERATIONS_PER_WORKER = Number(process.env.BENCH_ITERATIONS ?? '20');
const WARMUP_REQUESTS = 5;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[idx]!.toFixed(2));
}

async function signInSession(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Sign-in failed (${res.status})`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('No session cookie returned');
  }
  return setCookie.split(';')[0]!;
}

async function benchmarkEndpoint(
  name: string,
  path: string,
  cookies: string[],
): Promise<{ name: string; path: string; samples: number; p50Ms: number; p95Ms: number; maxMs: number }> {
  // Warm-up
  for (let i = 0; i < WARMUP_REQUESTS; i++) {
    const res = await fetch(`${BASE_URL}${path}`, { headers: { Cookie: cookies[0]! } });
    if (!res.ok) throw new Error(`Warmup failed for ${path}: ${res.status}`);
    await res.text();
  }

  const timings: number[] = [];
  await Promise.all(
    cookies.map(async (cookie) => {
      for (let i = 0; i < ITERATIONS_PER_WORKER; i++) {
        const start = performance.now();
        const res = await fetch(`${BASE_URL}${path}`, { headers: { Cookie: cookie } });
        if (!res.ok) throw new Error(`Request failed for ${path}: ${res.status}`);
        await res.text();
        timings.push(performance.now() - start);
      }
    }),
  );

  timings.sort((a, b) => a - b);
  return {
    name,
    path,
    samples: timings.length,
    p50Ms: percentile(timings, 50),
    p95Ms: percentile(timings, 95),
    maxMs: Number(timings[timings.length - 1]!.toFixed(2)),
  };
}

async function main() {
  const cookies: string[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    cookies.push(await signInSession());
  }

  const endpoints = [
    {
      name: 'Directory filtered (IN + ENG, page 1)',
      path: '/api/employees?country=IN&department=ENG&status=active&sortBy=employeeNumber&sortDir=asc&page=1&pageSize=25',
    },
    {
      name: 'Directory search (name substring)',
      path: '/api/employees?search=Priya&status=active&page=1&pageSize=25',
    },
    {
      name: 'Directory sorted by salary (page 1)',
      path: '/api/employees?status=active&sortBy=salary&sortDir=desc&page=1&pageSize=25',
    },
    {
      name: 'Report overview (all active, USD FX)',
      path: '/api/reports/compensation?status=active',
    },
    {
      name: 'Report grouped by country (USD FX)',
      path: '/api/reports/compensation?groupBy=country&status=active',
    },
    {
      name: 'Report native cohort (IN + ENG)',
      path: '/api/reports/compensation?country=IN&department=ENG&status=active',
    },
  ];

  const results = [];
  for (const ep of endpoints) {
    results.push(await benchmarkEndpoint(ep.name, ep.path, cookies));
  }

  // Clean up benchmark sessions
  await Promise.all(
    cookies.map((cookie) =>
      fetch(`${BASE_URL}/api/session`, {
        method: 'DELETE',
        headers: { Cookie: cookie, Origin: BASE_URL },
      }),
    ),
  );

  // Capture EXPLAIN (ANALYZE, BUFFERS) directly from PostgreSQL
  const dbUrl =
    process.env.MIGRATION_DATABASE_URL ??
    'postgresql://acme_admin:local_admin_dev_pass@localhost:5432/acme_salary?schema=public';
  const prisma = createPrismaClient(dbUrl);
  const explainPlans: Record<string, string[]> = {};

  try {
    const queries: Record<string, string> = {
      directory_filtered_page: `
        EXPLAIN (ANALYZE, BUFFERS)
        SELECT id, employee_number, display_name, country_code, department_code, level_code, active, salary_currency, current_salary_minor, version
        FROM employees
        WHERE active = true AND country_code = 'IN' AND department_code = 'ENG'
        ORDER BY employee_number ASC, id ASC
        LIMIT 25 OFFSET 0
      `,
      directory_search: `
        EXPLAIN (ANALYZE, BUFFERS)
        SELECT id, employee_number, display_name
        FROM employees
        WHERE active = true AND (display_name ILIKE '%Priya%' OR employee_number ILIKE '%Priya%')
        ORDER BY employee_number ASC, id ASC
        LIMIT 25 OFFSET 0
      `,
      report_grouped_by_country: `
        EXPLAIN (ANALYZE, BUFFERS)
        WITH base AS (
          SELECT
            e.country_code AS group_key,
            ROUND(e.current_salary_minor::numeric * fx.rate_to_usd, 0)::bigint AS effective_minor
          FROM employees e
          INNER JOIN fx_rates fx ON fx.snapshot_id = 'fx-2026-11-18-synthetic' AND fx.currency_code = e.salary_currency
          WHERE e.active = true
        ),
        ranked AS (
          SELECT
            group_key,
            effective_minor,
            ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY effective_minor ASC) AS rn,
            COUNT(*) OVER (PARTITION BY group_key) AS cnt
          FROM base
        )
        SELECT
          group_key,
          MAX(cnt)::int AS headcount,
          SUM(effective_minor)::bigint AS total_minor,
          ROUND(AVG(effective_minor::numeric) FILTER (WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)), 0)::bigint AS median_minor
        FROM ranked
        GROUP BY group_key
        ORDER BY total_minor DESC, group_key ASC
      `,
    };

    for (const [label, sql] of Object.entries(queries)) {
      const rows = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(sql);
      explainPlans[label] = rows.map((r) => r['QUERY PLAN']);
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    JSON.stringify(
      {
        environment: {
          baseUrl: BASE_URL,
          concurrency: CONCURRENCY,
          iterationsPerWorker: ITERATIONS_PER_WORKER,
          warmupRequests: WARMUP_REQUESTS,
        },
        timings: results,
        explainPlans,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
