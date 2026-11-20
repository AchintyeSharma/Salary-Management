import { Prisma, type PrismaClient } from '@prisma/client';
import { Router } from 'express';
import {
  compensationReportQuerySchema,
  COUNTRIES,
  COUNTRY_TO_CURRENCY,
  DEPARTMENTS,
  formatMinorToDecimalString,
  LEVELS,
  type CompensationGroupRowDto,
  type CompensationReportQuery,
  type CompensationReportResponse,
  type CurrencyCode,
  type ReportGroupBy,
} from '@acme/contracts';
import { AppError } from '../errors.js';
import { runRaiseCostPreview } from './raise-preview.js';

const COUNTRY_LABEL = new Map<string, string>(COUNTRIES.map((c) => [c.code, c.name]));
const DEPT_LABEL = new Map<string, string>(DEPARTMENTS.map((d) => [d.code, d.name]));
const LEVEL_LABEL = new Map<string, string>(LEVELS.map((l) => [l.code, l.name]));

function labelForGroup(groupBy: ReportGroupBy, key: string): string {
  if (groupBy === 'country') return COUNTRY_LABEL.get(key) ?? key;
  if (groupBy === 'department') return DEPT_LABEL.get(key) ?? key;
  return LEVEL_LABEL.get(key) ?? key;
}

function buildWhereSql(query: CompensationReportQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (query.status === 'active') {
    conditions.push(Prisma.sql`e.active = true`);
  } else if (query.status === 'inactive') {
    conditions.push(Prisma.sql`e.active = false`);
  }

  if (query.country) {
    conditions.push(Prisma.sql`e.country_code = ${query.country}`);
  }
  if (query.department) {
    conditions.push(Prisma.sql`e.department_code = ${query.department}`);
  }
  if (query.level) {
    conditions.push(Prisma.sql`e.level_code = ${query.level}`);
  }

  if (conditions.length === 0) {
    return Prisma.sql`TRUE`;
  }
  return Prisma.join(conditions, ' AND ');
}

function groupColumnSql(groupBy: ReportGroupBy): Prisma.Sql {
  switch (groupBy) {
    case 'country':
      return Prisma.sql`e.country_code`;
    case 'department':
      return Prisma.sql`e.department_code`;
    case 'level':
      return Prisma.sql`e.level_code`;
  }
}

interface SummarySqlRow {
  headcount: number;
  total_minor: bigint | null;
  median_minor: bigint | null;
}

interface GroupedSqlRow {
  group_key: string;
  headcount: number;
  total_minor: bigint;
  median_minor: bigint | null;
}

export async function runCompensationReport(
  prisma: PrismaClient,
  query: CompensationReportQuery,
): Promise<CompensationReportResponse> {
  // Single-country filter without grouping reports in native currency (no FX conversion).
  // Multi-country overviews and all grouped comparisons normalize to USD.
  const conversionApplied = Boolean(query.groupBy) || !query.country;
  const currency: CurrencyCode = conversionApplied
    ? 'USD'
    : COUNTRY_TO_CURRENCY[query.country!];

  const whereSql = buildWhereSql(query);

  return prisma.$transaction(
    async (tx) => {
      let fxBasis: CompensationReportResponse['fxBasis'] = null;
      let snapshotId: string | null = null;

      if (conversionApplied) {
        const activeSnapshot = await tx.fxSnapshot.findFirst({
          where: { isActive: true },
          orderBy: { asOfDate: 'desc' },
          include: { rates: true },
        });

        if (!activeSnapshot) {
          throw new AppError(
            422,
            'FX_RATE_MISSING',
            'No active FX snapshot is configured for USD compensation reporting.',
          );
        }

        snapshotId = activeSnapshot.id;
        fxBasis = {
          snapshotId: activeSnapshot.id,
          asOfDate: activeSnapshot.asOfDate.toISOString().slice(0, 10),
          sourceLabel: activeSnapshot.sourceLabel,
        };

        // Explicitly verify every currency in the matching cohort has a rate in the selected snapshot.
        const missingRates = await tx.$queryRaw<{ salary_currency: string }[]>`
          SELECT DISTINCT e.salary_currency
          FROM employees e
          LEFT JOIN fx_rates fx
            ON fx.snapshot_id = ${snapshotId}
           AND fx.currency_code = e.salary_currency
          WHERE ${whereSql}
            AND fx.rate_to_usd IS NULL
        `;

        if (missingRates.length > 0) {
          const missingList = missingRates.map((r) => r.salary_currency).sort().join(', ');
          throw new AppError(
            422,
            'FX_RATE_MISSING',
            `Missing FX rate in snapshot "${snapshotId}" for currency: ${missingList}.`,
            { snapshotId, missingCurrencies: missingRates.map((r) => r.salary_currency) },
          );
        }
      }

      const amountExpr = conversionApplied
        ? Prisma.sql`ROUND(e.current_salary_minor::numeric * fx.rate_to_usd, 0)::bigint`
        : Prisma.sql`e.current_salary_minor`;

      const joinSql = conversionApplied
        ? Prisma.sql`INNER JOIN fx_rates fx ON fx.snapshot_id = ${snapshotId} AND fx.currency_code = e.salary_currency`
        : Prisma.empty;

      const summaryRows = await tx.$queryRaw<SummarySqlRow[]>`
        WITH base AS (
          SELECT ${amountExpr} AS effective_minor
          FROM employees e
          ${joinSql}
          WHERE ${whereSql}
        ),
        ranked AS (
          SELECT
            effective_minor,
            ROW_NUMBER() OVER (ORDER BY effective_minor ASC) AS rn,
            COUNT(*) OVER () AS cnt
          FROM base
        )
        SELECT
          COALESCE(MAX(cnt), 0)::int AS headcount,
          COALESCE(SUM(effective_minor), 0)::bigint AS total_minor,
          ROUND(
            AVG(effective_minor::numeric) FILTER (WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)),
            0
          )::bigint AS median_minor
        FROM ranked
      `;

      const summaryRow = summaryRows[0] ?? {
        headcount: 0,
        total_minor: 0n,
        median_minor: null,
      };

      let groups: CompensationGroupRowDto[] = [];

      if (query.groupBy) {
        const groupCol = groupColumnSql(query.groupBy);
        const groupedRows = await tx.$queryRaw<GroupedSqlRow[]>`
          WITH base AS (
            SELECT
              ${groupCol} AS group_key,
              ${amountExpr} AS effective_minor
            FROM employees e
            ${joinSql}
            WHERE ${whereSql}
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
            ROUND(
              AVG(effective_minor::numeric) FILTER (WHERE rn IN ((cnt + 1) / 2, (cnt + 2) / 2)),
              0
            )::bigint AS median_minor
          FROM ranked
          GROUP BY group_key
          ORDER BY total_minor DESC, group_key ASC
        `;

        groups = groupedRows.map((row) => ({
          key: row.group_key,
          label: labelForGroup(query.groupBy!, row.group_key),
          headcount: row.headcount,
          totalAnnualBaseSalary: formatMinorToDecimalString(row.total_minor),
          medianAnnualBaseSalary:
            row.median_minor !== null ? formatMinorToDecimalString(row.median_minor) : null,
        }));
      }

      return {
        filters: {
          ...(query.country ? { country: query.country } : {}),
          ...(query.department ? { department: query.department } : {}),
          ...(query.level ? { level: query.level } : {}),
          status: query.status,
          ...(query.groupBy ? { groupBy: query.groupBy } : {}),
        },
        currency,
        conversionApplied,
        fxBasis,
        summary: {
          headcount: summaryRow.headcount,
          totalAnnualBaseSalary: formatMinorToDecimalString(summaryRow.total_minor ?? 0n),
          medianAnnualBaseSalary:
            summaryRow.median_minor !== null
              ? formatMinorToDecimalString(summaryRow.median_minor)
              : null,
        },
        groups,
        definitions: {
          population:
            query.status === 'active'
              ? 'Active employees matching the selected filters. Each matching employee contributes once using current annual gross base salary.'
              : query.status === 'inactive'
                ? 'Inactive employees matching the selected filters using their last recorded annual gross base salary.'
                : 'All employees (active and inactive) matching the selected filters using current annual gross base salary.',
          totalAnnualBaseSalary:
            'Sum of current annual gross base salaries only (excludes taxes, benefits, bonus, and equity).',
          median:
            'Exact middle minor-unit salary for odd headcounts; half-up rounded mean of the two middle minor-unit salaries for even headcounts.',
          currencyBasis: conversionApplied
            ? `Converted per employee to USD cents (half-up rounding) before aggregation using snapshot ${fxBasis!.snapshotId} (${fxBasis!.asOfDate}, ${fxBasis!.sourceLabel}).`
            : `Native ${currency} annual base pay (no FX conversion required for single-country overview).`,
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export function createReportsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/compensation', async (req, res, next) => {
    try {
      const query = compensationReportQuerySchema.parse(req.query);
      const report = await runCompensationReport(prisma, query);
      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  });

  router.post('/raise-cost-preview', async (req, res, next) => {
    try {
      const preview = await runRaiseCostPreview(prisma, req.body);
      res.status(200).json(preview);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
