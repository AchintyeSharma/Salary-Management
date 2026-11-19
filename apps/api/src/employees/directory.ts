import type { Prisma, PrismaClient } from '@prisma/client';
import { Router } from 'express';
import {
  COUNTRIES,
  DEPARTMENTS,
  employeeListQuerySchema,
  LEVELS,
  REVISION_REASONS,
  type CurrencyCode,
  type EmployeeListResponse,
  type EmployeeSortField,
  type LookupsResponse,
} from '@acme/contracts';
import { AppError } from '../errors.js';
import { mapEmployeeDetail, mapEmployeeSummary } from './mappers.js';
import {
  createEmployeeWithOpeningSalary,
  patchEmployeeProfileOrStatus,
  recordSalaryRevision,
  type WriteFaultHooks,
} from './writes.js';

function buildOrderBy(
  sortBy: EmployeeSortField,
  sortDir: 'asc' | 'desc',
): Prisma.EmployeeOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'displayName':
      return [{ displayName: sortDir }, { id: 'asc' }];
    case 'country':
      return [{ countryCode: sortDir }, { id: 'asc' }];
    case 'department':
      return [{ departmentCode: sortDir }, { id: 'asc' }];
    case 'level':
      return [{ levelCode: sortDir }, { id: 'asc' }];
    case 'salary':
      return [{ currentSalaryMinor: sortDir }, { id: 'asc' }];
    case 'employeeNumber':
    default:
      return [{ employeeNumber: sortDir }, { id: 'asc' }];
  }
}

export function createLookupsRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const snapshot = await prisma.fxSnapshot.findFirst({
        where: { isActive: true },
        orderBy: { asOfDate: 'desc' },
        include: { rates: true },
      });

      const rates = {} as Record<CurrencyCode, string>;
      if (snapshot) {
        for (const r of snapshot.rates) {
          rates[r.currencyCode as CurrencyCode] = r.rateToUsd.toString();
        }
      }

      const payload: LookupsResponse = {
        countries: COUNTRIES,
        departments: DEPARTMENTS,
        levels: LEVELS,
        revisionReasons: REVISION_REASONS.filter((r) => r.userSelectable).map((r) => ({
          code: r.code as Exclude<(typeof REVISION_REASONS)[number]['code'], 'HIRE'>,
          name: r.name,
        })),
        fxSnapshot: snapshot
          ? {
              id: snapshot.id,
              asOfDate: snapshot.asOfDate.toISOString().slice(0, 10),
              sourceLabel: snapshot.sourceLabel,
              rates,
            }
          : null,
      };

      res.status(200).json(payload);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function createEmployeeDirectoryRouter(
  prisma: PrismaClient,
  writeFaultHooks?: WriteFaultHooks,
): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const created = await createEmployeeWithOpeningSalary(
        prisma,
        req.body,
        req.hrAccount!.id,
        writeFaultHooks,
      );
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const query = employeeListQuerySchema.parse(req.query);
      const where: Prisma.EmployeeWhereInput = {};

      if (query.status === 'active') {
        where.active = true;
      } else if (query.status === 'inactive') {
        where.active = false;
      }

      if (query.country) {
        where.countryCode = query.country;
      }
      if (query.department) {
        where.departmentCode = query.department;
      }
      if (query.level) {
        where.levelCode = query.level;
      }
      if (query.search && query.search.length > 0) {
        where.OR = [
          { displayName: { contains: query.search, mode: 'insensitive' } },
          { employeeNumber: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      const skip = (query.page - 1) * query.pageSize;
      const orderBy = buildOrderBy(query.sortBy, query.sortDir);

      const [totalCount, rows] = await Promise.all([
        prisma.employee.count({ where }),
        prisma.employee.findMany({
          where,
          orderBy,
          skip,
          take: query.pageSize,
        }),
      ]);

      const response: EmployeeListResponse = {
        items: rows.map(mapEmployeeSummary),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalCount,
          totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize),
        },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new AppError(400, 'INVALID_ID', 'Employee ID must be a positive integer.');
      }

      const employee = await prisma.employee.findUnique({
        where: { id },
        include: {
          revisions: {
            orderBy: { sequence: 'desc' },
            include: {
              actor: {
                select: { displayName: true },
              },
            },
          },
        },
      });

      if (!employee) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
      }

      res.status(200).json(mapEmployeeDetail(employee));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new AppError(400, 'INVALID_ID', 'Employee ID must be a positive integer.');
      }
      const updated = await patchEmployeeProfileOrStatus(prisma, id, req.body);
      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/salary-revisions', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new AppError(400, 'INVALID_ID', 'Employee ID must be a positive integer.');
      }
      const result = await recordSalaryRevision(
        prisma,
        id,
        req.body,
        req.hrAccount!.id,
        writeFaultHooks,
      );
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
