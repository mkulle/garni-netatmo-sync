import fs from 'node:fs';
import type { TuyaConfig } from './tuya.ts';
import type { NetatmoConfig } from './netatmo.ts';
import type { Rules } from './decide.ts';

export interface Config {
  tuya: TuyaConfig & { deviceId: string; tempCode: string; tempScale: number };
  netatmo: NetatmoConfig & { homeId: string; roomName: string };
  rules: Rules;
  intervalSec: number;
  minCalibrationGapSec: number;
  dryRun: boolean;
}

export function loadConfig(): Config {
  loadDotEnv(new URL('../.env', import.meta.url));
  return {
    tuya: {
      baseUrl: env('TUYA_BASE_URL', 'https://openapi.tuyaeu.com'),
      clientId: env('TUYA_ACCESS_ID'),
      secret: env('TUYA_ACCESS_SECRET'),
      deviceId: env('TUYA_DEVICE_ID'),
      tempCode: env('TUYA_TEMP_CODE', 'va_temperature'),
      tempScale: num('TUYA_TEMP_SCALE', '10', 1),
    },
    netatmo: {
      username: env('NETATMO_USERNAME'),
      password: env('NETATMO_PASSWORD'),
      homeId: env('NETATMO_HOME_ID', ''),
      roomName: env('NETATMO_ROOM_NAME', ''),
    },
    rules: {
      threshold: num('THRESHOLD', '0.3', 0),
      maxDiff: num('MAX_DIFF', '6', 0),
      validRange: [num('VALID_MIN', '5'), num('VALID_MAX', '35')],
      onlyWhenWrong: env('CALIBRATE_ONLY_WHEN_WRONG', '0') === '1',
      tolerance: num('TOLERANCE', '0.2', 0),
    },
    intervalSec: num('INTERVAL_SEC', '300', 1),
    minCalibrationGapSec: num('MIN_CALIBRATION_GAP_SEC', '900', 0),
    dryRun: env('DRY_RUN', '0') === '1',
  };
}

function env(name: string, def?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (def !== undefined) return def;
  throw new Error(`Missing environment variable ${name}`);
}

// NaN would silently disable every comparison it takes part in, so fail on startup instead.
function num(name: string, def: string, min = -Infinity): number {
  const n = Number(env(name, def));
  if (!Number.isFinite(n) || n < min) throw new Error(`Environment variable ${name} is not a valid number`);
  return n;
}

// Minimal .env loader; variables already set in the environment take precedence.
function loadDotEnv(url: URL): void {
  if (!fs.existsSync(url)) return;
  for (const line of fs.readFileSync(url, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
