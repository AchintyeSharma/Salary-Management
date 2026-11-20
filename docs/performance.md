# Performance Evidence — 10,000-Employee Seeded Dataset

Measured against the local Docker Compose single-origin stack (`compose.yaml`: Express + Prisma runtime container talking to `postgres:16.6-alpine` via the restricted `acme_app` role) populated with **10,000 synthetic employees** (9,493 active, 507 inactive) and **17,738 salary revision rows**.

## Measurement Setup

- **Command:** `npm run bench` (`apps/api/src/scripts/benchmark.ts`)
- **Target:** `http://localhost:3000`
- **Concurrency:** 5 concurrent authenticated HR sessions
- **Samples:** 100 requests per endpoint (20 sequential requests per worker) after 5 warm-up requests
- **Interpreter mode:** `deterministic` (LLM latency is out of scope for PostgreSQL benchmarks)
- **CI discipline:** Wall-clock latency assertions are intentionally excluded from CI to avoid runner-induced flakiness; targets serve as investigation thresholds.

## Measured Warm API Latencies (5 Concurrent Sessions)

| Endpoint | Samples | p50 (ms) | p95 (ms) | Max (ms) | Investigation Target (p95) |
| --- | ---: | ---: | ---: | ---: | --- |
| `GET /api/employees?country=IN&department=ENG&status=active&sortBy=employeeNumber&sortDir=asc&page=1&pageSize=25` | 100 | 8.59 | 12.68 | 20.21 | < 250 ms |
| `GET /api/employees?search=Priya&status=active&page=1&pageSize=25` | 100 | 10.17 | 16.06 | 18.72 | < 250 ms |
| `GET /api/employees?status=active&sortBy=salary&sortDir=desc&page=1&pageSize=25` | 100 | 8.04 | 10.78 | 11.06 | < 250 ms |
| `GET /api/reports/compensation?status=active` (all 9,493 active, USD FX) | 100 | 11.75 | 15.34 | 17.12 | < 500 ms |
| `GET /api/reports/compensation?groupBy=country&status=active` (USD FX + exact median) | 100 | 21.93 | 24.64 | 56.35 | < 500 ms |
| `GET /api/reports/compensation?country=IN&department=ENG&status=active` (native INR) | 100 | 4.58 | 5.90 | 6.67 | < 500 ms |

### Deterministic 10,000-Employee Seed Timings
- Initial seed (`npm run db:seed`, 10,000 employees + 17,738 revisions + `seed_markers` in one transaction): **1,978 ms**
- Idempotent rerun (`already_seeded` no-op check): **21 ms**

## PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` Evidence

### 1. Filtered Directory Page (`IN` + `ENG`, `ORDER BY employee_number ASC, id ASC LIMIT 25`)
```text
Limit  (cost=0.69..11.64 rows=25 width=53) (actual time=0.102..0.104 rows=25 loops=1)
  Buffers: shared hit=11
  ->  Incremental Sort  (cost=0.69..556.39 rows=1269 width=53) (actual time=0.101..0.102 rows=25 loops=1)
        Sort Key: employee_number, id
        Presorted Key: employee_number
        Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 28kB  Peak Memory: 28kB
        ->  Index Scan using employees_employee_number_key on employees  (actual time=0.018..0.032 rows=26 loops=1)
              Filter: (active AND (country_code = 'IN'::text) AND (department_code = 'ENG'::text))
              Rows Removed by Filter: 157
Planning Time: 0.675 ms
Execution Time: 0.139 ms
```

### 2. Substring Directory Search (`display_name ILIKE '%Priya%' OR employee_number ILIKE '%Priya%'`)
```text
Limit  (cost=3.15..75.15 rows=25 width=26) (actual time=1.045..1.047 rows=25 loops=1)
  Buffers: shared hit=29
  ->  Incremental Sort  (cost=3.15..507.16 rows=175 width=26) (actual time=1.044..1.045 rows=25 loops=1)
        Sort Key: employee_number, id
        Presorted Key: employee_number
        ->  Index Scan using employees_employee_number_key on employees  (actual time=0.009..1.033 rows=26 loops=1)
              Filter: (active AND ((display_name ~~* '%Priya%'::text) OR (employee_number ~~* '%Priya%'::text)))
              Rows Removed by Filter: 1560
Planning Time: 0.156 ms
Execution Time: 1.066 ms
```

### 3. Grouped Multi-Currency USD Report with Exact `ROW_NUMBER()` Median (`groupBy=country`, 9,493 active rows)
```text
Sort  (cost=296.94..296.95 rows=4 width=23) (actual time=12.472..12.475 rows=4 loops=1)
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=137
  ->  GroupAggregate  (actual time=9.136..12.438 rows=4 loops=1)
        Group Key: e.country_code
        ->  WindowAgg  (actual time=8.404..11.683 rows=9493 loops=1)
              ->  WindowAgg  (actual time=7.888..9.697 rows=9493 loops=1)
                    ->  Sort  (actual time=7.883..8.193 rows=9493 loops=1)
                          Sort Key: e.country_code, ((round(((e.current_salary_minor)::numeric * fx.rate_to_usd), 0))::bigint)
                          Sort Method: quicksort  Memory: 755kB
                          ->  Hash Join  (actual time=0.044..4.310 rows=9493 loops=1)
                                ->  Seq Scan on employees e  (actual time=0.002..0.604 rows=9493 loops=1)
                                      Filter: active
                                      Rows Removed by Filter: 507
                                      Buffers: shared hit=132
                                ->  Hash  (actual time=0.024..0.025 rows=4 loops=1)
                                      ->  Bitmap Heap Scan on fx_rates fx  (actual time=0.018..0.019 rows=4 loops=1)
Planning Time: 0.391 ms
Execution Time: 12.696 ms
```

## Index Decision Summary

The entire 10,000-employee table occupies only **132 PostgreSQL 8 KB heap pages (~1.05 MB)** and stays resident in shared buffers. With only the essential schema constraints (`employees_employee_number_key`, `(employee_id, sequence)`, `(employee_id, actor_account_id, request_key)`), every directory and reporting endpoint runs **15–20× faster** than the investigation thresholds. We therefore intentionally deferred speculative secondary composite and `pg_trgm` GIN indexes until hosted measurements or larger datasets (100k+ employees) justify the write overhead.
