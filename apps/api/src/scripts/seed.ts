import 'dotenv/config';
import type { PrismaClient } from '@prisma/client';
import {
  COUNTRY_TO_CURRENCY,
  type CountryCode,
  type DepartmentCode,
  type LevelCode,
  type RevisionReasonCode,
} from '@acme/contracts';
import { createPrismaClient } from '../db/prisma.js';

export const SEED_VERSION = 'acme-seed-v1-10000';
export const SEED_EMPLOYEE_COUNT = 10_000;
export const SEED_REFERENCE_DATE = new Date('2026-11-18T00:00:00.000Z');
export const SYNTHETIC_FX_SNAPSHOT_ID = 'fx-2026-11-18-synthetic';
export const SYSTEM_SEED_EMAIL = 'system-seed@acme.example';

const SYNTHETIC_FX_RATES: Record<string, string> = {
  USD: '1.00000000',
  INR: '0.01250000',
  GBP: '1.28000000',
  EUR: '1.08000000',
};

// Deterministic PRNG (Mulberry32)
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(rng: () => number, items: readonly { value: T; weight: number }[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let target = rng() * total;
  for (const item of items) {
    target -= item.weight;
    if (target <= 0) return item.value;
  }
  return items[items.length - 1]!.value;
}

const COUNTRY_WEIGHTS: { value: CountryCode; weight: number }[] = [
  { value: 'US', weight: 38 },
  { value: 'IN', weight: 32 },
  { value: 'GB', weight: 16 },
  { value: 'DE', weight: 14 },
];

const DEPARTMENT_WEIGHTS: { value: DepartmentCode; weight: number }[] = [
  { value: 'ENG', weight: 40 },
  { value: 'SALES', weight: 18 },
  { value: 'OPS', weight: 14 },
  { value: 'PROD', weight: 10 },
  { value: 'FIN', weight: 7 },
  { value: 'DESIGN', weight: 6 },
  { value: 'HR', weight: 5 },
];

const LEVEL_WEIGHTS: { value: LevelCode; weight: number }[] = [
  { value: 'L1', weight: 12 },
  { value: 'L2', weight: 26 },
  { value: 'L3', weight: 28 },
  { value: 'L4', weight: 18 },
  { value: 'L5', weight: 10 },
  { value: 'L6', weight: 4 },
  { value: 'L7', weight: 2 },
];

// Annual base salary anchors in native major units for L1 by country, scaled by level multiplier
const BASE_MAJOR_L1: Record<CountryCode, number> = {
  US: 72_000,
  IN: 1_200_000,
  GB: 44_000,
  DE: 52_000,
};

const LEVEL_MULTIPLIER: Record<LevelCode, number> = {
  L1: 1.0,
  L2: 1.32,
  L3: 1.72,
  L4: 2.22,
  L5: 2.8,
  L6: 3.45,
  L7: 4.3,
};

const DEPT_MULTIPLIER: Record<DepartmentCode, number> = {
  ENG: 1.12,
  PROD: 1.08,
  DESIGN: 0.98,
  SALES: 1.02,
  FIN: 1.0,
  OPS: 0.88,
  HR: 0.9,
};

const FIRST_NAMES = [
  'Aarav', 'Aditi', 'Alex', 'Amelia', 'Ananya', 'Arthur', 'Benjamin', 'Charlotte',
  'Chloe', 'Daniel', 'Diya', 'Elena', 'Elias', 'Emily', 'Ethan', 'Felix',
  'Freya', 'Grace', 'Hannah', 'Henry', 'Ishaan', 'Jack', 'Jonas', 'Jordan',
  'Kabir', 'Klara', 'Laura', 'Lea', 'Leon', 'Liam', 'Lukas', 'Maya',
  'Meera', 'Mia', 'Noah', 'Nora', 'Oliver', 'Olivia', 'Priya', 'Rohan',
  'Sam', 'Sanya', 'Sofia', 'Sophia', 'Theo', 'Vikram', 'Zara', 'Zoe',
];

const LAST_NAMES = [
  'Bauer', 'Bennett', 'Bhatia', 'Brooks', 'Carter', 'Clarke', 'Das', 'Davies',
  'Desai', 'Edwards', 'Fischer', 'Foster', 'Gupta', 'Hall', 'Harrison', 'Hoffmann',
  'Iyer', 'Joshi', 'Kapoor', 'Keller', 'Klein', 'Koch', 'Krueger', 'Kumar',
  'Lewis', 'Martin', 'Mehta', 'Meyer', 'Miller', 'Morgan', 'Mueller', 'Nair',
  'Patel', 'Rao', 'Reddy', 'Richter', 'Robinson', 'Schmidt', 'Schneider', 'Sharma',
  'Singh', 'Smith', 'Taylor', 'Thomas', 'Verma', 'Wagner', 'Walker', 'Weber',
];

const FOLLOWUP_REASONS: RevisionReasonCode[] = [
  'MERIT',
  'ANNUAL_REVIEW',
  'PROMOTION',
  'MARKET_ADJUSTMENT',
];

interface DocumentedDemoEmployee {
  employeeNumber: string;
  displayName: string;
  countryCode: CountryCode;
  departmentCode: DepartmentCode;
  levelCode: LevelCode;
  active: boolean;
  revisionsMajor: { amount: number; reason: RevisionReasonCode; daysAgo: number }[];
}

export const DOCUMENTED_DEMO_EMPLOYEES: readonly DocumentedDemoEmployee[] = [
  {
    employeeNumber: 'EMP-00001',
    displayName: 'Priya Sharma',
    countryCode: 'IN',
    departmentCode: 'ENG',
    levelCode: 'L4',
    active: true,
    revisionsMajor: [
      { amount: 2_800_000, reason: 'HIRE', daysAgo: 900 },
      { amount: 3_150_000, reason: 'MERIT', daysAgo: 450 },
      { amount: 3_600_000, reason: 'PROMOTION', daysAgo: 120 },
    ],
  },
  {
    employeeNumber: 'EMP-00002',
    displayName: 'Jordan Taylor',
    countryCode: 'US',
    departmentCode: 'ENG',
    levelCode: 'L4',
    active: true,
    revisionsMajor: [
      { amount: 155_000, reason: 'HIRE', daysAgo: 760 },
      { amount: 172_500, reason: 'ANNUAL_REVIEW', daysAgo: 210 },
    ],
  },
  {
    employeeNumber: 'EMP-00003',
    displayName: 'Hannah Clarke',
    countryCode: 'GB',
    departmentCode: 'PROD',
    levelCode: 'L3',
    active: true,
    revisionsMajor: [
      { amount: 74_000, reason: 'HIRE', daysAgo: 540 },
      { amount: 81_000, reason: 'MERIT', daysAgo: 180 },
    ],
  },
  {
    employeeNumber: 'EMP-00004',
    displayName: 'Lukas Weber',
    countryCode: 'DE',
    departmentCode: 'ENG',
    levelCode: 'L5',
    active: true,
    revisionsMajor: [
      { amount: 128_000, reason: 'HIRE', daysAgo: 1020 },
      { amount: 140_000, reason: 'MARKET_ADJUSTMENT', daysAgo: 620 },
      { amount: 152_000, reason: 'PROMOTION', daysAgo: 140 },
    ],
  },
  {
    employeeNumber: 'EMP-00005',
    displayName: 'Maya Patel',
    countryCode: 'IN',
    departmentCode: 'SALES',
    levelCode: 'L2',
    active: false,
    revisionsMajor: [
      { amount: 1_550_000, reason: 'HIRE', daysAgo: 680 },
      { amount: 1_680_000, reason: 'MERIT', daysAgo: 310 },
    ],
  },
];

export interface SeedResult {
  status: 'seeded' | 'already_seeded';
  seedVersion: string;
  employeeCount: number;
  revisionCount: number;
}

export async function runSeed(
  prisma: PrismaClient,
  targetCount: number = SEED_EMPLOYEE_COUNT,
): Promise<SeedResult> {
  const seedVersion =
    targetCount === SEED_EMPLOYEE_COUNT ? SEED_VERSION : `acme-seed-v1-${targetCount}`;

  return prisma.$transaction(
    async (tx) => {
      const existingMarker = await tx.seedMarker.findUnique({
        where: { seedVersion },
      });

      if (existingMarker) {
        const revisionCount = await tx.salaryRevision.count();
        return {
          status: 'already_seeded',
          seedVersion,
          employeeCount: existingMarker.employeeCount,
          revisionCount,
        };
      }

      const existingEmployees = await tx.employee.count();
      if (existingEmployees > 0) {
        throw new Error(
          `Refusing to seed: database already contains ${existingEmployees} employee rows without seed marker "${seedVersion}".`,
        );
      }

      // 1. Disabled system account for synthetic revision attribution
      const systemAccount = await tx.hrAccount.upsert({
        where: { email: SYSTEM_SEED_EMAIL },
        update: { active: false },
        create: {
          email: SYSTEM_SEED_EMAIL,
          displayName: 'Synthetic Seed System',
          passwordHash: 'disabled$not-for-login',
          active: false,
        },
      });

      // 2. Active immutable synthetic FX snapshot
      await tx.fxSnapshot.upsert({
        where: { id: SYNTHETIC_FX_SNAPSHOT_ID },
        update: {},
        create: {
          id: SYNTHETIC_FX_SNAPSHOT_ID,
          asOfDate: SEED_REFERENCE_DATE,
          sourceLabel: 'Synthetic assessment FX rates (USD reporting basis)',
          isActive: true,
          rates: {
            create: Object.entries(SYNTHETIC_FX_RATES).map(([currencyCode, rateToUsd]) => ({
              currencyCode,
              rateToUsd,
            })),
          },
        },
      });

      // 3. Build deterministic employee + revision rows
      const rng = createRng(20261118);
      const refMs = SEED_REFERENCE_DATE.getTime();
      const dayMs = 86_400_000;

      interface PreparedEmployee {
        employeeNumber: string;
        displayName: string;
        countryCode: CountryCode;
        departmentCode: DepartmentCode;
        levelCode: LevelCode;
        active: boolean;
        salaryCurrency: string;
        currentSalaryMinor: bigint;
        version: number;
        createdAt: Date;
        updatedAt: Date;
        revisions: {
          sequence: number;
          previousSalaryMinor: bigint | null;
          newSalaryMinor: bigint;
          currencyCode: string;
          reasonCode: RevisionReasonCode;
          recordedAt: Date;
        }[];
      }

      const prepared: PreparedEmployee[] = [];

      // Documented demo employees first
      for (let i = 0; i < Math.min(DOCUMENTED_DEMO_EMPLOYEES.length, targetCount); i++) {
        const demo = DOCUMENTED_DEMO_EMPLOYEES[i]!;
        const currency = COUNTRY_TO_CURRENCY[demo.countryCode];
        const revs = demo.revisionsMajor.map((r, idx) => {
          const prev = idx === 0 ? null : BigInt(demo.revisionsMajor[idx - 1]!.amount) * 100n;
          return {
            sequence: idx + 1,
            previousSalaryMinor: prev,
            newSalaryMinor: BigInt(r.amount) * 100n,
            currencyCode: currency,
            reasonCode: r.reason,
            recordedAt: new Date(refMs - r.daysAgo * dayMs),
          };
        });
        const latest = revs[revs.length - 1]!;
        prepared.push({
          employeeNumber: demo.employeeNumber,
          displayName: demo.displayName,
          countryCode: demo.countryCode,
          departmentCode: demo.departmentCode,
          levelCode: demo.levelCode,
          active: demo.active,
          salaryCurrency: currency,
          currentSalaryMinor: latest.newSalaryMinor,
          version: revs.length,
          createdAt: revs[0]!.recordedAt,
          updatedAt: latest.recordedAt,
          revisions: revs,
        });
      }

      // Remaining synthetic employees up to targetCount
      for (let idx = prepared.length + 1; idx <= targetCount; idx++) {
        const employeeNumber = `EMP-${String(idx).padStart(5, '0')}`;
        const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]!;
        const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]!;
        const displayName = `${first} ${last}`;
        const countryCode = pickWeighted(rng, COUNTRY_WEIGHTS);
        const departmentCode = pickWeighted(rng, DEPARTMENT_WEIGHTS);
        const levelCode = pickWeighted(rng, LEVEL_WEIGHTS);
        const active = rng() >= 0.05; // ~95% active, ~5% inactive
        const currency = COUNTRY_TO_CURRENCY[countryCode];

        const baseAnchor =
          BASE_MAJOR_L1[countryCode] * LEVEL_MULTIPLIER[levelCode] * DEPT_MULTIPLIER[departmentCode];
        // Spread between 0.84x and 1.18x of anchor, rounded to nearest 500 major units
        const spread = 0.84 + rng() * 0.34;
        const currentMajor = Math.max(10_000, Math.round((baseAnchor * spread) / 500) * 500);

        const revCount = rng() < 0.35 ? 1 : rng() < 0.8 ? 2 : 3;
        const hireDaysAgo = 200 + Math.floor(rng() * 1400);

        // Build increasing or varied coherent salary history ending at currentMajor
        const amountsMajor: number[] = new Array(revCount);
        amountsMajor[revCount - 1] = currentMajor;
        for (let r = revCount - 2; r >= 0; r--) {
          const factor = 0.88 + rng() * 0.07; // prior salary 88%-95% of next
          const prior = Math.max(5_000, Math.round((amountsMajor[r + 1]! * factor) / 500) * 500);
          amountsMajor[r] = prior === amountsMajor[r + 1]! ? prior - 500 : prior;
        }

        const revs = amountsMajor.map((amt, rIdx) => {
          const fraction = revCount === 1 ? 0 : rIdx / (revCount - 1);
          const daysAgo = Math.round(hireDaysAgo * (1 - fraction * 0.82));
          const reason: RevisionReasonCode =
            rIdx === 0
              ? 'HIRE'
              : FOLLOWUP_REASONS[Math.floor(rng() * FOLLOWUP_REASONS.length)]!;
          return {
            sequence: rIdx + 1,
            previousSalaryMinor: rIdx === 0 ? null : BigInt(amountsMajor[rIdx - 1]!) * 100n,
            newSalaryMinor: BigInt(amt) * 100n,
            currencyCode: currency,
            reasonCode: reason,
            recordedAt: new Date(refMs - daysAgo * dayMs),
          };
        });

        const latest = revs[revs.length - 1]!;
        prepared.push({
          employeeNumber,
          displayName,
          countryCode,
          departmentCode,
          levelCode,
          active,
          salaryCurrency: currency,
          currentSalaryMinor: latest.newSalaryMinor,
          version: revs.length,
          createdAt: revs[0]!.recordedAt,
          updatedAt: latest.recordedAt,
          revisions: revs,
        });
      }

      // 4. Insert employees in batches of 1,000 and map employeeNumber -> generated id
      const BATCH_SIZE = 1000;
      const numberToId = new Map<string, number>();

      for (let start = 0; start < prepared.length; start += BATCH_SIZE) {
        const slice = prepared.slice(start, start + BATCH_SIZE);
        const created = await tx.employee.createManyAndReturn({
          select: { id: true, employeeNumber: true },
          data: slice.map((e) => ({
            employeeNumber: e.employeeNumber,
            displayName: e.displayName,
            countryCode: e.countryCode,
            departmentCode: e.departmentCode,
            levelCode: e.levelCode,
            active: e.active,
            salaryCurrency: e.salaryCurrency,
            currentSalaryMinor: e.currentSalaryMinor,
            version: e.version,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
          })),
        });
        for (const row of created) {
          numberToId.set(row.employeeNumber, row.id);
        }
      }

      // 5. Insert salary revisions in batches of 2,000
      const allRevisionRows = prepared.flatMap((e) => {
        const employeeId = numberToId.get(e.employeeNumber)!;
        return e.revisions.map((rev) => ({
          employeeId,
          sequence: rev.sequence,
          previousSalaryMinor: rev.previousSalaryMinor,
          newSalaryMinor: rev.newSalaryMinor,
          currencyCode: rev.currencyCode,
          reasonCode: rev.reasonCode,
          actorAccountId: systemAccount.id,
          recordedAt: rev.recordedAt,
        }));
      });

      const REV_BATCH_SIZE = 2000;
      for (let start = 0; start < allRevisionRows.length; start += REV_BATCH_SIZE) {
        await tx.salaryRevision.createMany({
          data: allRevisionRows.slice(start, start + REV_BATCH_SIZE),
        });
      }

      // 6. Commit seed marker in the exact same transaction
      await tx.seedMarker.create({
        data: {
          seedVersion,
          employeeCount: prepared.length,
          referenceDate: SEED_REFERENCE_DATE,
        },
      });

      return {
        status: 'seeded',
        seedVersion,
        employeeCount: prepared.length,
        revisionCount: allRevisionRows.length,
      };
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

// CLI entrypoint
const isDirectExecution =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);

if (isDirectExecution) {
  const dbUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('MIGRATION_DATABASE_URL or DATABASE_URL must be set.');
    process.exit(1);
  }
  const prisma = createPrismaClient(dbUrl);
  const started = Date.now();
  runSeed(prisma)
    .then((result) => {
      console.log(
        JSON.stringify({
          event: 'seed_complete',
          ...result,
          durationMs: Date.now() - started,
        }),
      );
    })
    .catch((err) => {
      console.error('Seed failed:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
