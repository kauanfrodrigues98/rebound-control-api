import { z } from 'zod';
import './load-env';

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  return value.trim().toLowerCase() === 'true';
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3021),
  HOST: z.string().min(1).default('127.0.0.1'),
  CONTROL_FRONTEND_URL: z.string().url().default('http://localhost:3020'),
  CONTROL_ALLOWED_ORIGINS: z.string().optional(),

  DATABASE_HOST: z.string().min(1).default('localhost'),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_USERNAME: z.string().min(1).default('postgres'),
  DATABASE_PASSWORD: z.string().default('postgres'),
  DATABASE_NAME: z.string().min(1).default('rebound_control'),
  DATABASE_SSL: booleanFromEnv.default(false),
  DATABASE_SYNCHRONIZE: booleanFromEnv.default(false),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(1),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32)
    .default('development-access-secret-change-before-production'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32)
    .default('development-refresh-secret-change-before-production'),
  JWT_ISSUER: z.string().min(1).default('rebound-control-api'),
  JWT_AUDIENCE: z.string().min(1).default('rebound-control'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: booleanFromEnv.default(false),

  CONTROL_ADMIN_EMAIL: z.string().email().optional(),
  CONTROL_ADMIN_SETUP_TOKEN: z.string().min(24).optional(),
  CONTROL_ADMIN_NAME: z.string().min(1).default('Administrador Rebound'),

  LICENSING_SERVICE_URL: z.string().url().default('http://localhost:3002'),
  LICENSING_ADMIN_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);

export const allowedOrigins = Array.from(
  new Set(
    [
      env.CONTROL_FRONTEND_URL,
      ...(env.CONTROL_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ].filter(Boolean),
  ),
);

if (env.NODE_ENV === 'production') {
  const usingDevelopmentSecret =
    env.JWT_ACCESS_SECRET.startsWith('development-') ||
    env.JWT_REFRESH_SECRET.startsWith('development-');

  if (usingDevelopmentSecret) {
    throw new Error('JWT_ACCESS_SECRET e JWT_REFRESH_SECRET devem ser definidos em produção.');
  }
}
