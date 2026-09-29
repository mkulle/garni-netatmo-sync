// `--list`: prints Tuya DP codes and Netatmo homes/rooms to help fill in .env.

import type { Config } from './config.ts';
import type { Netatmo } from './netatmo.ts';
import type { Tuya } from './tuya.ts';

export async function list(cfg: Config, tuya: Tuya, netatmo: Netatmo): Promise<void> {
  const { deviceId } = cfg.tuya;
  console.log('--- Tuya device status', deviceId);
  const [status, spec] = await Promise.all([
    tuya.deviceStatus(deviceId),
    tuya.deviceSpecifications(deviceId).catch(() => null),
  ]);
  const specs: Record<string, { unit?: string; scale?: number }> = {};
  for (const s of spec?.status || []) {
    try {
      specs[s.code] = JSON.parse(s.values);
    } catch {}
  }
  // spec.scale is an exponent: value = raw / 10^scale  ->  TUYA_TEMP_SCALE = 10^scale
  console.table(
    status.map(({ code, value }) => {
      const { unit = '', scale } = specs[code] || {};
      const scaled = typeof value === 'number' && scale != null ? value / 10 ** scale : '';
      return { code, raw: value, unit, TUYA_TEMP_SCALE: scale != null ? 10 ** scale : '', value: scaled };
    }),
  );

  console.log('--- Netatmo homes and rooms');
  const { body } = await netatmo.homesData();
  for (const h of body.homes) {
    console.log(`Home "${h.name}"  id=${h.id}`);
    for (const r of h.rooms || []) console.log(`   room "${r.name}"  id=${r.id}  modules=${r.module_ids}`);
    const status = await netatmo.homeStatus(h.id).catch(() => null);
    for (const r of status?.body?.home?.rooms || []) {
      console.log(`   status ${r.id}: measured ${r.therm_measured_temperature} °C, setpoint ${r.therm_setpoint_temperature} °C`);
    }
  }
}
