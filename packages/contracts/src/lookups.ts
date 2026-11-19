export const COUNTRIES = [
  { code: 'US', name: 'United States', currencyCode: 'USD' },
  { code: 'IN', name: 'India', currencyCode: 'INR' },
  { code: 'GB', name: 'United Kingdom', currencyCode: 'GBP' },
  { code: 'DE', name: 'Germany', currencyCode: 'EUR' },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]['code'];
export type CurrencyCode = (typeof COUNTRIES)[number]['currencyCode'];

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code) as [CountryCode, ...CountryCode[]];
export const CURRENCY_CODES = COUNTRIES.map((c) => c.currencyCode) as [
  CurrencyCode,
  ...CurrencyCode[],
];

export const COUNTRY_TO_CURRENCY: Record<CountryCode, CurrencyCode> = {
  US: 'USD',
  IN: 'INR',
  GB: 'GBP',
  DE: 'EUR',
};

export const DEPARTMENTS = [
  { code: 'ENG', name: 'Engineering' },
  { code: 'PROD', name: 'Product' },
  { code: 'DESIGN', name: 'Design' },
  { code: 'SALES', name: 'Sales' },
  { code: 'OPS', name: 'Operations' },
  { code: 'FIN', name: 'Finance' },
  { code: 'HR', name: 'People & HR' },
] as const;

export type DepartmentCode = (typeof DEPARTMENTS)[number]['code'];
export const DEPARTMENT_CODES = DEPARTMENTS.map((d) => d.code) as [
  DepartmentCode,
  ...DepartmentCode[],
];

export const LEVELS = [
  { code: 'L1', name: 'L1 - Associate' },
  { code: 'L2', name: 'L2 - Mid-Level' },
  { code: 'L3', name: 'L3 - Senior' },
  { code: 'L4', name: 'L4 - Staff' },
  { code: 'L5', name: 'L5 - Principal' },
  { code: 'L6', name: 'L6 - Director' },
  { code: 'L7', name: 'L7 - VP' },
] as const;

export type LevelCode = (typeof LEVELS)[number]['code'];
export const LEVEL_CODES = LEVELS.map((l) => l.code) as [LevelCode, ...LevelCode[]];

export const REVISION_REASONS = [
  { code: 'HIRE', name: 'Opening Salary (Hire)', userSelectable: false },
  { code: 'MERIT', name: 'Merit Increase', userSelectable: true },
  { code: 'PROMOTION', name: 'Promotion', userSelectable: true },
  { code: 'MARKET_ADJUSTMENT', name: 'Market Adjustment', userSelectable: true },
  { code: 'ANNUAL_REVIEW', name: 'Annual Review', userSelectable: true },
  { code: 'CORRECTION', name: 'Data Correction', userSelectable: true },
] as const;

export type RevisionReasonCode = (typeof REVISION_REASONS)[number]['code'];
export const USER_REVISION_REASON_CODES = REVISION_REASONS.filter((r) => r.userSelectable).map(
  (r) => r.code,
) as [Exclude<RevisionReasonCode, 'HIRE'>, ...Exclude<RevisionReasonCode, 'HIRE'>[]];

export const CURRENCY_DECIMALS = 2;
export const MINOR_UNITS_PER_MAJOR = 100n;
