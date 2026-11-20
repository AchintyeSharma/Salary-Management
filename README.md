# ACME Salary Management

Web application for ACME’s HR Manager to maintain annual gross base salaries for **10,000 employees across multiple countries** (US, India, UK, Germany) and answer recurring compensation questions without reconciling spreadsheets.

## Documentation & Artifacts

- **One-page requirements:** [docs/requirements.md](docs/requirements.md)
- **Technical design, ER diagram & exact money rules:** [docs/design.md](docs/design.md)
- **Implementation plan & milestones:** [ImplementationPlan.md](ImplementationPlan.md)
- **Measured 10k performance & PostgreSQL query plans:** [docs/performance.md](docs/performance.md)
- **Agentic AI workflow & review log:** [docs/ai-workflow.md](docs/ai-workflow.md)

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Material UI Core, React Router, TanStack Query
- **Backend:** Node.js 22, Express, TypeScript (strict), Zod
- **Database:** PostgreSQL 16 + Prisma ORM (schema-first migrations, typed CRUD, parameterized SQL for row locks and exact `BIGINT`/`NUMERIC` reporting)
- **Ask about pay:** Deterministic intent interpreter (zero external API keys required for local dev or CI) with a narrow `PayQuestionInterpreter` boundary for optional live LLM integration
- **Packaging:** Single-origin Docker image (Express serves built React bundle + `/api`) + Docker Compose (`compose.yaml`)

## Reproducible Local Setup (Docker Compose)

1. Copy the environment template if you want custom local credentials (defaults work out of the box with Compose):
   ```bash
   cp .env.example .env
   ```
2. Build and start PostgreSQL 16 and the single-origin application container:
   ```bash
   docker compose up -d --build
   ```
3. Run reviewed Prisma migrations, deterministic 10,000-employee seed, and one-time HR demo account provisioning:
   ```bash
   # Privileged migration credentials used for schema deployment, seeding, and account provisioning:
   export MIGRATION_DATABASE_URL="postgresql://acme_admin:local_admin_dev_pass@localhost:5432/acme_salary?schema=public"
   # Restricted application role used by the runtime web service:
   export DATABASE_URL="postgresql://acme_app:local_app_dev_pass@localhost:5432/acme_salary?schema=public"

   npm run db:migrate
   npm run db:seed

   export HR_DEMO_EMAIL="hr.manager@acme.example"
   export HR_DEMO_NAME="ACME HR Manager"
   export HR_DEMO_PASSWORD="acme-local-demo-pass"
   npm run hr:provision
   ```
   Or execute directly inside the running container (where compiled production scripts under `apps/api/dist` are used):
   ```bash
   docker compose exec app npm run db:migrate
   docker compose exec app npm run db:seed
   docker compose exec -e HR_DEMO_EMAIL="hr.manager@acme.example" -e HR_DEMO_PASSWORD="acme-local-demo-pass" app npm run hr:provision
   ```
4. Open **http://localhost:3000** and sign in with your provisioned HR demo credentials.
5. Verify container restart persistence:
   ```bash
   docker compose restart app
   curl http://localhost:3000/api/health
   ```

### Documented Demo Employees (Deterministic Seed)
- `EMP-00001` — **Priya Sharma** (India, Engineering, L4, Active, opening INR 2,800,000 → 3,150,000 → 3,600,000)
- `EMP-00002` — **Jordan Taylor** (US, Engineering, L4, Active, USD 172,500)
- `EMP-00003` — **Hannah Clarke** (UK, Product, L3, Active, GBP 81,000)
- `EMP-00004` — **Lukas Weber** (Germany, Engineering, L5, Active, EUR 152,000)
- `EMP-00005` — **Maya Patel** (India, Sales, L2, Inactive, INR 1,680,000)

## Verification Commands

```bash
# Typechecking and production build across all workspaces
npm run typecheck
npm run build

# Fast deterministic unit, synthetic question eval, and React Testing Library suites
npm run test:unit

# Real PostgreSQL 16 integration tests (uses separate acme_test DB + restricted acme_app role)
npm run test:integration

# Full Playwright browser workflow against live http://localhost:3000 (10,000-employee seed)
npm run test:e2e

# Warm 5-concurrent-session latency benchmark + PostgreSQL EXPLAIN (ANALYZE, BUFFERS)
npm run bench
```

## Hosting & Release Readiness (Milestone 8 Gate)

- **Deployment blueprint:** [render.yaml](render.yaml) (single-origin Docker web service + Managed PostgreSQL 16 + `/api/health` readiness check).
- **Hosted release steps:**
  1. Connect the repository to Render Blueprints (or deploy `Dockerfile` to Railway/Fly.io with a PostgreSQL 16 database).
  2. Configure secret environment variables outside Git: `APP_ORIGIN` (`https://<host>`), `COOKIE_SECURE=true`, `MIGRATION_DATABASE_URL`, `DATABASE_URL`, `HR_DEMO_EMAIL`, and `HR_DEMO_PASSWORD`.
  3. Run one-time setup on the host: `npm run db:migrate`, `npm run db:seed`, and `npm run hr:provision`.
  4. Verify the hosted core smoke workflow:
     ```bash
     E2E_BASE_URL=https://<your-hosted-url> HR_DEMO_EMAIL=... HR_DEMO_PASSWORD=... npm run test:e2e
     ```
- **Current Milestone Status:**
  - **Local implementation & verification:** Milestones 1–9 (including the read-only raise-cost preview and Ask about pay preview confirmation) are implemented and verified locally against Docker Compose PostgreSQL 16 (50 automated unit/eval/integration/UI tests + full Playwright E2E on the 10,000-employee seed).

