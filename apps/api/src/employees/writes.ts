import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  COUNTRY_TO_CURRENCY,
  createEmployeeSchema,
  createSalaryRevisionSchema,
  parseSalaryToMinor,
  patchEmployeeSchema,
  type EmployeeDetailDto,
  type SalaryRevisionDto,
} from '@acme/contracts';
import { AppError } from '../errors.js';
import { mapEmployeeDetail, mapEmployeeSummary, mapSalaryRevision } from './mappers.js';

export interface WriteFaultHooks {
  beforeCreateOpeningRevision?: () => void;
  beforeUpdateEmployeeAfterRevision?: () => void;
}

export function computeRevisionFingerprint(
  newSalaryMinor: bigint,
  reasonCode: string,
  expectedVersion: number,
): string {
  const canonical = `${newSalaryMinor.toString()}|${reasonCode.trim().toUpperCase()}|${expectedVersion}`;
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function createEmployeeWithOpeningSalary(
  prisma: PrismaClient,
  rawBody: unknown,
  actorAccountId: number,
  hooks?: WriteFaultHooks,
): Promise<EmployeeDetailDto> {
  const input = createEmployeeSchema.parse(rawBody);
  const openingSalaryMinor = parseSalaryToMinor(input.openingSalary);
  const salaryCurrency = COUNTRY_TO_CURRENCY[input.countryCode];

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          employeeNumber: input.employeeNumber,
          displayName: input.displayName,
          countryCode: input.countryCode,
          departmentCode: input.departmentCode,
          levelCode: input.levelCode,
          active: true,
          salaryCurrency,
          currentSalaryMinor: openingSalaryMinor,
          version: 1,
        },
      });

      hooks?.beforeCreateOpeningRevision?.();

      await tx.salaryRevision.create({
        data: {
          employeeId: created.id,
          sequence: 1,
          previousSalaryMinor: null,
          newSalaryMinor: openingSalaryMinor,
          currencyCode: salaryCurrency,
          reasonCode: 'HIRE',
          actorAccountId,
        },
      });

      const full = await tx.employee.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          revisions: {
            orderBy: { sequence: 'desc' },
            include: { actor: { select: { displayName: true } } },
          },
        },
      });

      return mapEmployeeDetail(full);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(
        409,
        'EMPLOYEE_NUMBER_EXISTS',
        `Employee number "${input.employeeNumber}" already exists.`,
      );
    }
    throw err;
  }
}

export async function patchEmployeeProfileOrStatus(
  prisma: PrismaClient,
  employeeId: number,
  rawBody: unknown,
): Promise<EmployeeDetailDto> {
  const input = patchEmployeeSchema.parse(rawBody);

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }

    const current = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: {
        revisions: {
          orderBy: { sequence: 'desc' },
          include: { actor: { select: { displayName: true } } },
        },
      },
    });

    if (current.version !== input.expectedVersion) {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        'This employee record was updated by another session. Review the current data before submitting again.',
        { currentEmployee: mapEmployeeSummary(current) },
      );
    }

    const nextDisplayName = input.displayName ?? current.displayName;
    const nextDepartmentCode = input.departmentCode ?? current.departmentCode;
    const nextLevelCode = input.levelCode ?? current.levelCode;
    const nextActive = input.active ?? current.active;

    const changed =
      nextDisplayName !== current.displayName ||
      nextDepartmentCode !== current.departmentCode ||
      nextLevelCode !== current.levelCode ||
      nextActive !== current.active;

    if (!changed) {
      return mapEmployeeDetail(current);
    }

    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: {
        displayName: nextDisplayName,
        departmentCode: nextDepartmentCode,
        levelCode: nextLevelCode,
        active: nextActive,
        version: current.version + 1,
      },
      include: {
        revisions: {
          orderBy: { sequence: 'desc' },
          include: { actor: { select: { displayName: true } } },
        },
      },
    });

    return mapEmployeeDetail(updated);
  });
}

export interface SalaryRevisionWriteResult {
  employee: EmployeeDetailDto;
  revision: SalaryRevisionDto;
  replayed: boolean;
}

export async function recordSalaryRevision(
  prisma: PrismaClient,
  employeeId: number,
  rawBody: unknown,
  actorAccountId: number,
  hooks?: WriteFaultHooks,
): Promise<SalaryRevisionWriteResult> {
  const input = createSalaryRevisionSchema.parse(rawBody);
  const newSalaryMinor = parseSalaryToMinor(input.newSalary);
  const fingerprint = computeRevisionFingerprint(
    newSalaryMinor,
    input.reasonCode,
    input.expectedVersion,
  );

  return prisma.$transaction(async (tx) => {
    // 1. Consistent lock order: always lock employee row first.
    const locked = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    }

    // 2. Check idempotency key for this actor and employee BEFORE checking version or active status.
    const existingByKey = await tx.salaryRevision.findUnique({
      where: {
        employeeId_actorAccountId_requestKey: {
          employeeId,
          actorAccountId,
          requestKey: input.requestKey,
        },
      },
      include: { actor: { select: { displayName: true } } },
    });

    if (existingByKey) {
      if (existingByKey.requestFingerprint !== fingerprint) {
        throw new AppError(
          409,
          'REQUEST_KEY_CONFLICT',
          'This request key was already used with different salary revision details.',
        );
      }

      const currentFull = await tx.employee.findUniqueOrThrow({
        where: { id: employeeId },
        include: {
          revisions: {
            orderBy: { sequence: 'desc' },
            include: { actor: { select: { displayName: true } } },
          },
        },
      });

      return {
        employee: mapEmployeeDetail(currentFull),
        revision: mapSalaryRevision(existingByKey),
        replayed: true,
      };
    }

    // 3. Validate shared employee version, active status, and changed amount.
    const current = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
    });

    if (current.version !== input.expectedVersion) {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        'This employee record was updated by another session. Review the current data before submitting again.',
        { currentEmployee: mapEmployeeSummary(current) },
      );
    }

    if (!current.active) {
      throw new AppError(
        409,
        'EMPLOYEE_INACTIVE',
        'Salary revisions cannot be recorded for an inactive employee. Reactivate the employee first.',
        { currentEmployee: mapEmployeeSummary(current) },
      );
    }

    if (newSalaryMinor === current.currentSalaryMinor) {
      throw new AppError(
        400,
        'UNCHANGED_SALARY',
        'New salary must be different from the current salary.',
      );
    }

    // 4. Read latest independent ledger sequence under the employee row lock.
    const latestRevision = await tx.salaryRevision.findFirst({
      where: { employeeId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    const nextSequence = (latestRevision?.sequence ?? 0) + 1;

    // 5. Append revision and update employee pay + shared version in the same transaction.
    const createdRevision = await tx.salaryRevision.create({
      data: {
        employeeId,
        sequence: nextSequence,
        previousSalaryMinor: current.currentSalaryMinor,
        newSalaryMinor,
        currencyCode: current.salaryCurrency,
        reasonCode: input.reasonCode,
        actorAccountId,
        requestKey: input.requestKey,
        requestFingerprint: fingerprint,
      },
      include: { actor: { select: { displayName: true } } },
    });

    hooks?.beforeUpdateEmployeeAfterRevision?.();

    const updatedEmployee = await tx.employee.update({
      where: { id: employeeId },
      data: {
        currentSalaryMinor: newSalaryMinor,
        version: current.version + 1,
      },
      include: {
        revisions: {
          orderBy: { sequence: 'desc' },
          include: { actor: { select: { displayName: true } } },
        },
      },
    });

    return {
      employee: mapEmployeeDetail(updatedEmployee),
      revision: mapSalaryRevision(createdRevision),
      replayed: false,
    };
  });
}
