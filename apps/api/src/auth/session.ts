import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { loginRequestSchema, type SessionInfo } from '@acme/contracts';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import { verifyPassword } from './password.js';

export const SESSION_COOKIE_NAME = 'acme_session';

export interface AuthenticatedAccount {
  id: number;
  email: string;
  displayName: string;
}

declare global {
  namespace Express {
    interface Request {
      hrAccount?: AuthenticatedAccount;
      sessionHash?: string;
    }
  }
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function createSimpleRateLimiter(maxRequests: number, windowMs: number): RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req, _res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (entry.count >= maxRequests) {
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.'));
      return;
    }
    entry.count += 1;
    next();
  };
}

export function createSameOriginMiddleware(config: AppConfig): RequestHandler {
  const allowedOrigin = config.appOrigin;

  return (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }

    const originHeader = req.get('origin');
    const refererHeader = req.get('referer');

    if (originHeader) {
      if (originHeader.replace(/\/+$/, '') !== allowedOrigin) {
        next(new AppError(403, 'FORBIDDEN_ORIGIN', 'Cross-origin state-changing request rejected.'));
        return;
      }
      next();
      return;
    }

    if (refererHeader) {
      try {
        const refererOrigin = new URL(refererHeader).origin;
        if (refererOrigin !== allowedOrigin) {
          next(
            new AppError(403, 'FORBIDDEN_ORIGIN', 'Cross-origin state-changing request rejected.'),
          );
          return;
        }
      } catch {
        next(new AppError(403, 'FORBIDDEN_ORIGIN', 'Invalid Referer header.'));
        return;
      }
    }

    next();
  };
}

export function createRequireAuthMiddleware(prisma: PrismaClient): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
      if (typeof rawToken !== 'string' || rawToken.length < 32) {
        throw new AppError(401, 'UNAUTHORIZED', 'HR sign-in is required.');
      }

      const tokenHash = hashSessionToken(rawToken);
      const session = await prisma.hrSession.findUnique({
        where: { id: tokenHash },
        include: { account: true },
      });

      const now = new Date();
      if (
        !session ||
        session.revokedAt !== null ||
        session.expiresAt <= now ||
        !session.account.active
      ) {
        throw new AppError(401, 'UNAUTHORIZED', 'Your HR session has expired or is invalid.');
      }

      req.hrAccount = {
        id: session.account.id,
        email: session.account.email,
        displayName: session.account.displayName,
      };
      req.sessionHash = tokenHash;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function createSessionRouter(
  prisma: PrismaClient,
  config: AppConfig,
  options?: { loginRateLimitMax?: number },
): Router {
  const router = Router();
  const requireAuth = createRequireAuthMiddleware(prisma);
  const sameOrigin = createSameOriginMiddleware(config);
  const loginLimiter = createSimpleRateLimiter(options?.loginRateLimitMax ?? 15, 60_000);

  router.post('/', loginLimiter, sameOrigin, async (req, res, next) => {
    try {
      const parsed = loginRequestSchema.parse(req.body);
      const email = parsed.email.toLowerCase();

      const account = await prisma.hrAccount.findUnique({ where: { email } });
      if (!account || !account.active || !verifyPassword(parsed.password, account.passwordHash)) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      }

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(rawToken);
      const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000);

      await prisma.hrSession.create({
        data: {
          id: tokenHash,
          accountId: account.id,
          expiresAt,
        },
      });

      res.cookie(SESSION_COOKIE_NAME, rawToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        path: '/',
        expires: expiresAt,
      });

      const body: SessionInfo = {
        account: {
          id: account.id,
          email: account.email,
          displayName: account.displayName,
        },
        expiresAt: expiresAt.toISOString(),
      };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get('/', requireAuth, async (req, res, next) => {
    try {
      const session = await prisma.hrSession.findUniqueOrThrow({
        where: { id: req.sessionHash! },
      });
      const body: SessionInfo = {
        account: req.hrAccount!,
        expiresAt: session.expiresAt.toISOString(),
      };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/', requireAuth, sameOrigin, async (req, res, next) => {
    try {
      await prisma.hrSession.update({
        where: { id: req.sessionHash! },
        data: { revokedAt: new Date() },
      });

      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        path: '/',
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
