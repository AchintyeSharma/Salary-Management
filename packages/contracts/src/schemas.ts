import { z } from 'zod';
import {
  COUNTRY_CODES,
  CURRENCY_CODES,
  DEPARTMENT_CODES,
  LEVEL_CODES,
  USER_REVISION_REASON_CODES,
  type CountryCode,
  type CurrencyCode,
  type DepartmentCode,
  type LevelCode,
  type RevisionReasonCode,
} from './lookups.js';

export const loginRequestSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export interface SessionInfo {
  account: {
    id: number;
    email: string;
    displayName: string;
  };
  expiresAt: string;
}

export const EMPLOYEE_SORT_FIELDS = [
  'employeeNumber',
  'displayName',
  'country',
  'department',
  'level',
  'salary',
] as const;

export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

export const employeeListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  country: z.enum(COUNTRY_CODES).optional(),
  department: z.enum(DEPARTMENT_CODES).optional(),
  level: z.enum(LEVEL_CODES).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  sortBy: z.enum(EMPLOYEE_SORT_FIELDS).default('employeeNumber'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

export interface EmployeeSummaryDto {
  id: number;
  employeeNumber: string;
  displayName: string;
  countryCode: CountryCode;
  departmentCode: DepartmentCode;
  levelCode: LevelCode;
  active: boolean;
  salaryCurrency: CurrencyCode;
  currentSalary: string;
  version: number;
}

export interface SalaryRevisionDto {
  id: number;
  sequence: number;
  previousSalary: string | null;
  newSalary: string;
  currencyCode: CurrencyCode;
  reasonCode: RevisionReasonCode;
  actorDisplayName: string;
  recordedAt: string;
}

export interface EmployeeDetailDto extends EmployeeSummaryDto {
  createdAt: string;
  updatedAt: string;
  revisions: SalaryRevisionDto[];
}

export interface EmployeeListResponse {
  items: EmployeeSummaryDto[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface FxSnapshotSummary {
  id: string;
  asOfDate: string;
  sourceLabel: string;
  rates: Record<CurrencyCode, string>;
}

export interface LookupsResponse {
  countries: readonly { code: CountryCode; name: string; currencyCode: CurrencyCode }[];
  departments: readonly { code: DepartmentCode; name: string }[];
  levels: readonly { code: LevelCode; name: string }[];
  revisionReasons: readonly {
    code: Exclude<RevisionReasonCode, 'HIRE'>;
    name: string;
  }[];
  fxSnapshot: FxSnapshotSummary | null;
}

export const createEmployeeSchema = z.object({
  employeeNumber: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Employee number may contain letters, numbers, hyphens, and underscores.'),
  displayName: z.string().trim().min(1).max(120),
  countryCode: z.enum(COUNTRY_CODES),
  departmentCode: z.enum(DEPARTMENT_CODES),
  levelCode: z.enum(LEVEL_CODES),
  openingSalary: z.string().trim().min(1).max(32),
});

export type CreateEmployeeRequest = z.infer<typeof createEmployeeSchema>;

export const patchEmployeeSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    displayName: z.string().trim().min(1).max(120).optional(),
    departmentCode: z.enum(DEPARTMENT_CODES).optional(),
    levelCode: z.enum(LEVEL_CODES).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export type PatchEmployeeRequest = z.infer<typeof patchEmployeeSchema>;

export const createSalaryRevisionSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    newSalary: z.string().trim().min(1).max(32),
    reasonCode: z.enum(USER_REVISION_REASON_CODES),
    requestKey: z
      .string()
      .trim()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/, 'Request key must be alphanumeric, hyphen, or underscore.'),
  })
  .strict();

export type CreateSalaryRevisionRequest = z.infer<typeof createSalaryRevisionSchema>;

export const REPORT_GROUP_BY_FIELDS = ['country', 'department', 'level'] as const;
export type ReportGroupBy = (typeof REPORT_GROUP_BY_FIELDS)[number];

export const compensationReportQuerySchema = z.object({
  country: z.enum(COUNTRY_CODES).optional(),
  department: z.enum(DEPARTMENT_CODES).optional(),
  level: z.enum(LEVEL_CODES).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  groupBy: z.enum(REPORT_GROUP_BY_FIELDS).optional(),
});

export type CompensationReportQuery = z.infer<typeof compensationReportQuerySchema>;

export interface CompensationMetricsDto {
  headcount: number;
  totalAnnualBaseSalary: string;
  medianAnnualBaseSalary: string | null;
}

export interface CompensationGroupRowDto extends CompensationMetricsDto {
  key: string;
  label: string;
}

export interface ReportFxBasisDto {
  snapshotId: string;
  asOfDate: string;
  sourceLabel: string;
}

export interface CompensationReportResponse {
  filters: {
    country?: CountryCode;
    department?: DepartmentCode;
    level?: LevelCode;
    status: 'active' | 'inactive' | 'all';
    groupBy?: ReportGroupBy;
  };
  currency: CurrencyCode;
  conversionApplied: boolean;
  fxBasis: ReportFxBasisDto | null;
  summary: CompensationMetricsDto;
  groups: CompensationGroupRowDto[];
  definitions: {
    population: string;
    totalAnnualBaseSalary: string;
    median: string;
    currencyBasis: string;
  };
}

export const PAY_QUESTION_METRICS = ['headcount', 'total', 'median', 'overview'] as const;
export type PayQuestionMetric = (typeof PAY_QUESTION_METRICS)[number];

export const payQuestionRequestSchema = z
  .object({
    question: z.string().trim().min(3, 'Enter a compensation question.').max(300),
  })
  .strict();

export type PayQuestionRequest = z.infer<typeof payQuestionRequestSchema>;

export const validatedReportIntentSchema = z.object({
  metric: z.enum(PAY_QUESTION_METRICS),
  filters: z.object({
    country: z.enum(COUNTRY_CODES).optional(),
    department: z.enum(DEPARTMENT_CODES).optional(),
    level: z.enum(LEVEL_CODES).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
    groupBy: z.enum(REPORT_GROUP_BY_FIELDS).optional(),
  }),
  expectedCurrency: z.enum(CURRENCY_CODES),
  conversionExpected: z.boolean(),
  label: z.string(),
  dashboardPath: z.string(),
  directoryPath: z.string(),
});

export type ValidatedReportIntent = z.infer<typeof validatedReportIntentSchema>;

export type PayQuestionUnsupportedReason =
  | 'CONTAINS_IDENTIFIER'
  | 'WRITE_REQUEST'
  | 'EMPLOYEE_SPECIFIC'
  | 'HISTORY_TREND'
  | 'UNSUPPORTED_DIMENSION'
  | 'UNSUPPORTED_OVERRIDE'
  | 'UNRECOGNIZED';

export interface PayQuestionInterpretResponse {
  mode: 'deterministic' | 'live';
  outcome: 'report_intent' | 'preview_intent' | 'clarification_needed' | 'unsupported';
  summary: string;
  intent?: ValidatedReportIntent;
  previewIntent?: ValidatedRaisePreviewIntent;
  clarificationPrompt?: string;
  options?: ValidatedReportIntent[];
  reasonCode?: PayQuestionUnsupportedReason;
  guidance?: string;
}

export const raiseCostPreviewRequestSchema = z
  .object({
    country: z.enum(COUNTRY_CODES).optional(),
    department: z.enum(DEPARTMENT_CODES).optional(),
    level: z.enum(LEVEL_CODES).optional(),
    raisePercent: z.string().trim().min(1).max(16),
  })
  .strict();

export type RaiseCostPreviewRequest = z.infer<typeof raiseCostPreviewRequestSchema>;

export interface RaiseCostPreviewResponse {
  filters: {
    country?: CountryCode;
    department?: DepartmentCode;
    level?: LevelCode;
    status: 'active';
  };
  raisePercent: string;
  headcount: number;
  currency: CurrencyCode;
  conversionApplied: boolean;
  fxBasis: ReportFxBasisDto | null;
  currentAnnualSpend: string;
  projectedAnnualSpend: string;
  differenceAnnualSpend: string;
  directoryPath: string;
  definitions: {
    population: string;
    calculation: string;
    currencyBasis: string;
    readOnly: string;
  };
}

export const validatedRaisePreviewIntentSchema = z.object({
  filters: z.object({
    country: z.enum(COUNTRY_CODES).optional(),
    department: z.enum(DEPARTMENT_CODES).optional(),
    level: z.enum(LEVEL_CODES).optional(),
    status: z.literal('active'),
  }),
  raisePercent: z.string().trim().min(1).max(16),
  expectedCurrency: z.enum(CURRENCY_CODES),
  conversionExpected: z.boolean(),
  label: z.string(),
  previewPath: z.string(),
  directoryPath: z.string(),
});

export type ValidatedRaisePreviewIntent = z.infer<typeof validatedRaisePreviewIntentSchema>;
