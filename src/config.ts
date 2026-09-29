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
      tempScale: Number(env('TUYA_TEMP_SCALE', '10')),
    },
    netatmo: {
      username: env('NETATMO_USERNAME'),
      password: env('NETATMO_PASSWORD'),
      homeId: env('NETATMO_HOME_ID', ''),
      roomName: env('NETATMO_ROOM_NAME', ''),
    },
    rules: {
      threshold: Number(env('THRESHOLD', '0.3')),
      maxDiff: Number(env('MAX_DIFF', '6')),
      validRange: [Number(env('VALID_MIN', '5')), Number(env('VALID_MAX', '35'))],
      onlyWhenWrong: env('CALIBRATE_ONLY_WHEN_WRONG', '0') === '1',
      tolerance: Number(env('TOLERANCE', '0.2')),
    },
    intervalSec: Number(env('INTERVAL_SEC', '300')),
    minCalibrationGapSec: Number(env('MIN_CALIBRATION_GAP_SEC', '900')),
    dryRun: env('DRY_RUN', '0') === '1',
  };
}

function env(name: string, def?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (def !== undefined) return def;
  throw new Error(`Missing environment variable ${name}`);
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
