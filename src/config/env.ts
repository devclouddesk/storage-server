import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(Number(process.env.DCD_STORAGE_PORT || process.env.PORT || 7100)),
  HOST: z.string().default(process.env.HOST || '0.0.0.0'),
  DATA_DIR: z.string().default(process.env.DCD_STORAGE_PATH || process.env.DATA_DIR || path.resolve(process.cwd(), 'data')),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Master Admin Key (for CLI & direct administrative API access)
  MASTER_KEY: z.string().default(process.env.MASTER_KEY || process.env.ADMIN_KEY || ''),
  KEY_PREFIX: z.string().default(process.env.KEY_PREFIX || 'dcd_key_live_'),

  // Guard rails & edge case limits
  MAX_FILE_SIZE_MB: z.coerce.number().default(50),
  MAX_INPUT_PIXELS: z.coerce.number().default(50_000_000), // ~7000x7000 px decomp bomb limit
  CACHE_MAX_SIZE_GB: z.coerce.number().default(5),
  DISK_FREE_THRESHOLD_PERCENT: z.coerce.number().default(15),
  RATE_LIMIT_DEFAULT: z.coerce.number().default(120),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

export const paths = {
  data: env.DATA_DIR,
  uploads: path.join(env.DATA_DIR, 'uploads'),
  cache: path.join(env.DATA_DIR, 'cache'),
  db: path.join(env.DATA_DIR, 'db'),
  config: path.join(env.DATA_DIR, 'config'),
  configFile: path.join(env.DATA_DIR, 'config', 'server.json'),
  databaseFile: path.join(env.DATA_DIR, 'db', 'media.db'),
};
