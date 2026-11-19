import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { MoneyValidationError } from '@acme/contracts';
import {
  createRequireAuthMiddleware,
  createSameOriginMiddleware,
  createSessionRouter,
} from './auth/session.js';
import { loadConfig, type AppConfig } from './config.js';
import { checkDatabaseConnection } from './db/prisma.js';
import { createEmployeeDirectoryRouter, createLookupsRouter } from './employees/directory.js';
import type { WriteFaultHooks } from './employees/writes.js';
import { AppError } from './errors.js';

export interface AppDependencies {
  config?: AppConfig;
  prisma?: PrismaClient;
  checkDatabase?: () => Promise<boolean>;
  staticDir?: string;
  loginRateLimitMax?: number;
  writeFaultHooks?: WriteFaultHooks;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_DIST = path.resolve(__dirname, '../../web/dist');

export function createApp(deps: AppDependencies = {}) {
  const config = deps.config ?? loadConfig();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());

  // Operational request logging without sensitive payloads (no salaries, questions, reasons, or tokens).
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (config.nodeEnv !== 'test') {
        const durationMs = Date.now() - started;
        console.log(
          JSON.stringify({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs,
          }),
        );
      }
    });
    next();
  });

  const dbCheck =
    deps.checkDatabase ??
    (deps.prisma ? () => checkDatabaseConnection(deps.prisma!) : undefined);

  app.get('/api/health', async (_req, res) => {
    let database = 'skipped';
    if (dbCheck) {
      try {
        const ok = await dbCheck();
        database = ok ? 'ok' : 'unavailable';
      } catch {
        database = 'unavailable';
      }
    }
    const status = database === 'unavailable' ? 503 : 200;
    res.status(status).json({
      status: status === 200 ? 'ok' : 'degraded',
      database,
      interpreterMode: config.payInterpreterMode,
    });
  });

  if (deps.prisma) {
    const requireAuth = createRequireAuthMiddleware(deps.prisma);
    const sameOrigin = createSameOriginMiddleware(config);

    app.use(
      '/api/session',
      createSessionRouter(deps.prisma, config, {
        loginRateLimitMax: deps.loginRateLimitMax,
      }),
    );
    app.use('/api/lookups', requireAuth, createLookupsRouter(deps.prisma));
    app.use(
      '/api/employees',
      requireAuth,
      sameOrigin,
      createEmployeeDirectoryRouter(deps.prisma, deps.writeFaultHooks),
    );
  }

  // Serve built React bundle from the same origin when present.
  const staticDir = deps.staticDir ?? DEFAULT_WEB_DIST;
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'API endpoint not found.',
      },
    });
  });

  // Centralized error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      });
      return;
    }

    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          details: {
            issues: err.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        },
      });
      return;
    }

    if (err instanceof MoneyValidationError) {
      res.status(400).json({
        error: {
          code: 'INVALID_MONEY_AMOUNT',
          message: err.message,
        },
      });
      return;
    }

    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON.',
        },
      });
      return;
    }

    if (config.nodeEnv !== 'test') {
      console.error('Unhandled API error', err instanceof Error ? err.message : 'unknown');
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      },
    });
  });

  return app;
}
