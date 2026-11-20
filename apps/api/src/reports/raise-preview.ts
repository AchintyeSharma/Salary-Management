import { Prisma, type PrismaClient } from '@prisma/client';
import {
  COUNTRY_TO_CURRENCY,
  formatMinorToDecimalString,
  parseRaisePercentToBasisPoints,
  raiseCostPreviewRequestSchema,
  type CurrencyCode,
  type RaiseCostPreviewResponse,
} from '@acme/contracts';
import { AppError } from '../errors.js';

interface PreviewSqlRow {
  headcount: number;
  current_spend_minor: bigint | null;
  projected_spend_minor: bigint | null;
}

export async function runRaiseCostPreview(
  prisma: PrismaClient,
  rawBody: unknown,
): Promise<RaiseCostPreviewResponse> {
  const input = raiseCostPreviewRequestSchema.parse(rawBody);
  const raiseBps = parseRaisePercentToBasisPoints(input.raisePercent);
  const canonicalPercent = input.raisePercent.trim();

  const conversionApplied = !input.country;
  const currency: CurrencyCode = conversionApplied
    ? 'USD'
    : COUNTRY_TO_CURRENCY[input.country!];

  const conditions: Prisma.Sql[] = [Prisma.sql`e.active = true`];
  if (input.country) {
    conditions.push(Prisma.sql`e.country_code = ${input.country}`);
  }
  if (input.department) {
    conditions.push(Prisma.sql`e.department_code = ${input.department}`);
  }
  if (input.level) {
    conditions.push(Prisma.sql`e.level_code = ${input.level}`);
  }
  const whereSql = Prisma.join(conditions, ' AND ');

  const dirParams = new URLSearchParams();
  if (input.country) dirParams.set('country', input.country);
  if (input.department) dirParams.set('department', input.department);
  if (input.level) dirParams.set('level', input.level);
  dirParams.set('status', 'active');
  const directoryPath = `/employees?${dirParams.toString()}`;

  return prisma.$transaction(
    async (tx) => {
      let fxBasis: RaiseCostPreviewResponse['fxBasis'] = null;
      let snapshotId: string | null = null;

      if (conversionApplied) {
        const activeSnapshot = await tx.fxSnapshot.findFirst({
          where: { isActive: true },
          orderBy: { asOfDate: 'desc' },
        });

        if (!activeSnapshot) {
          throw new AppError(
            422,
            'FX_RATE_MISSING',
            'No active FX snapshot is configured for USD raise-cost previews.',
          );
        }

        snapshotId = activeSnapshot.id;
        fxBasis = {
          snapshotId: activeSnapshot.id,
          asOfDate: activeSnapshot.asOfDate.toISOString().slice(0, 10),
          sourceLabel: activeSnapshot.sourceLabel,
        };

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

      const multiplierNum = 10_000n + raiseBps;

      // Single read query so headcount, current spend, and projected spend reflect the exact same cohort snapshot.
      const rows = conversionApplied
        ? await tx.$queryRaw<PreviewSqlRow[]>`
            WITH per_employee AS (
              SELECT
                e.current_salary_minor AS current_native_minor,
                ROUND(
                  (e.current_salary_minor::numeric * ${multiplierNum.toString()}::numeric) / 10000::numeric,
                  0
                )::bigint AS projected_native_minor,
                fx.rate_to_usd
              FROM employees e
              INNER JOIN fx_rates fx
                ON fx.snapshot_id = ${snapshotId}
               AND fx.currency_code = e.salary_currency
              WHERE ${whereSql}
            ),
            converted AS (
              SELECT
                ROUND(current_native_minor::numeric * rate_to_usd, 0)::bigint AS current_eff_minor,
                ROUND(projected_native_minor::numeric * rate_to_usd, 0)::bigint AS projected_eff_minor
              FROM per_employee
            )
            SELECT
              COUNT(*)::int AS headcount,
              COALESCE(SUM(current_eff_minor), 0)::bigint AS current_spend_minor,
              COALESCE(SUM(projected_eff_minor), 0)::bigint AS projected_spend_minor
            FROM converted
          `
        : await tx.$queryRaw<PreviewSqlRow[]>`
            WITH per_employee AS (
              SELECT
                e.current_salary_minor AS current_eff_minor,
                ROUND(
                  (e.current_salary_minor::numeric * ${multiplierNum.toString()}::numeric) / 10000::numeric,
                  0
                )::bigint AS projected_eff_minor
              FROM employees e
              WHERE ${whereSql}
            )
            SELECT
              COUNT(*)::int AS headcount,
              COALESCE(SUM(current_eff_minor), 0)::bigint AS current_spend_minor,
              COALESCE(SUM(projected_eff_minor), 0)::bigint AS projected_spend_minor
            FROM per_employee
          `;

      const row = rows[0] ?? {
        headcount: 0,
        current_spend_minor: 0n,
        projected_spend_minor: 0n,
      };
      const currentMinor = row.current_spend_minor ?? 0n;
      const projectedMinor = row.projected_spend_minor ?? 0n;
      const diffMinor = projectedMinor - currentMinor;

      return {
        filters: {
          ...(input.country ? { country: input.country } : {}),
          ...(input.department ? { department: input.department } : {}),
          ...(input.level ? { level: input.level } : {}),
          status: 'active',
        },
        raisePercent: canonicalPercent,
        headcount: row.headcount,
        currency,
        conversionApplied,
        fxBasis,
        currentAnnualSpend: formatMinorToDecimalString(currentMinor),
        projectedAnnualSpend: formatMinorToDecimalString(projectedMinor),
        differenceAnnualSpend: formatMinorToDecimalString(diffMinor),
        directoryPath,
        definitions: {
          population:
            'Fixed to active employees matching the selected filters. Each matching employee contributes once using current annual gross base salary.',
          calculation:
            'Each projected salary is calculated in native minor units as current × (1 + raisePercent / 100) rounded half-up to 1 minor unit before any FX conversion. Difference is projected spend minus current spend after summing.',
          currencyBasis: conversionApplied
            ? `Converted per employee to USD cents (half-up rounding) independently for current and projected pay using snapshot ${fxBasis!.snapshotId} (${fxBasis!.asOfDate}, ${fxBasis!.sourceLabel}).`
            : `Native ${currency} annual base pay (no FX conversion required for single-country preview).`,
          readOnly:
            'Read-only estimate: previewing creates zero employee updates and zero salary revision ledger rows.',
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
