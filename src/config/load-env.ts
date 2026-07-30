import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const candidates = [
  process.env.REBOUND_CONTROL_ENV_FILE,
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'rebound-control-api/.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
].filter((candidate): candidate is string => Boolean(candidate));

const envPath = candidates.find((candidate) => fs.existsSync(candidate));

dotenv.config(envPath ? { path: envPath } : undefined);
