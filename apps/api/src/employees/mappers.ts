import type { Employee, HrAccount, SalaryRevision } from '@prisma/client';
import {
  formatMinorToDecimalString,
  type CountryCode,
  type CurrencyCode,
  type DepartmentCode,
  type EmployeeDetailDto,
  type EmployeeSummaryDto,
  type LevelCode,
  type RevisionReasonCode,
  type SalaryRevisionDto,
} from '@acme/contracts';

export function mapEmployeeSummary(row: Employee): EmployeeSummaryDto {
  return {
    id: row.id,
    employeeNumber: row.employeeNumber,
    displayName: row.displayName,
    countryCode: row.countryCode as CountryCode,
    departmentCode: row.departmentCode as DepartmentCode,
    levelCode: row.levelCode as LevelCode,
    active: row.active,
    salaryCurrency: row.salaryCurrency as CurrencyCode,
    currentSalary: formatMinorToDecimalString(row.currentSalaryMinor),
    version: row.version,
  };
}

export function mapSalaryRevision(
  row: SalaryRevision & { actor: Pick<HrAccount, 'displayName'> },
): SalaryRevisionDto {
  return {
    id: row.id,
    sequence: row.sequence,
    previousSalary:
      row.previousSalaryMinor !== null
        ? formatMinorToDecimalString(row.previousSalaryMinor)
        : null,
    newSalary: formatMinorToDecimalString(row.newSalaryMinor),
    currencyCode: row.currencyCode as CurrencyCode,
    reasonCode: row.reasonCode as RevisionReasonCode,
    actorDisplayName: row.actor.displayName,
    recordedAt: row.recordedAt.toISOString(),
  };
}

export function mapEmployeeDetail(
  row: Employee & {
    revisions: (SalaryRevision & { actor: Pick<HrAccount, 'displayName'> })[];
  },
): EmployeeDetailDto {
  return {
    ...mapEmployeeSummary(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revisions: row.revisions.map(mapSalaryRevision),
  };
}
