import 'dotenv/config';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  appOrigin: string;
  cookieSecure: boolean;
  sessionTtlHours: number;
  payInterpreterMode: 'deterministic' | 'live';
  databaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? '3000');
  const sessionTtlHours = Number(env.SESSION_TTL_HOURS ?? '8');
  const nodeEnv = env.NODE_ENV ?? 'development';
  const cookieSecure =
    env.COOKIE_SECURE !== undefined ? env.COOKIE_SECURE === 'true' : nodeEnv === 'production';

  return {
    port: Number.isFinite(port) && port > 0 ? port : 3000,
    nodeEnv,
    appOrigin: (env.APP_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, ''),
    cookieSecure,
    sessionTtlHours:
      Number.isFinite(sessionTtlHours) && sessionTtlHours > 0 ? sessionTtlHours : 8,
    payInterpreterMode: env.PAY_INTERPRETER_MODE === 'live' ? 'live' : 'deterministic',
    databaseUrl: env.DATABASE_URL ?? '',
  };
}
