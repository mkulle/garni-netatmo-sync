// One sync pass: read Garni and Netatmo, decide, calibrate if needed.

import type { Config } from './config.ts';
import { decide } from './decide.ts';
import type { Netatmo } from './netatmo.ts';
import type { Tuya } from './tuya.ts';
import { log, round1 } from './utils.ts';

interface Target {
  homeId: string;
  roomId: string;
  roomName: string;
}

interface NetatmoReading {
  measured: number;
  setpoint?: number;
  boiler?: boolean; // actual relay state, logged only
}

export class Sync {
  private readonly cfg: Config;
  private readonly tuya: Tuya;
  private readonly netatmo: Netatmo;
  private target: Target | null = null;
  private lastCalibration = 0;

  constructor(cfg: Config, tuya: Tuya, netatmo: Netatmo) {
    this.cfg = cfg;
    this.tuya = tuya;
    this.netatmo = netatmo;
  }

  async tick(): Promise<void> {
    const target = (this.target ??= await this.resolveTarget());

    const [real, net] = await Promise.all([this.readGarni(), this.readNetatmo(target)]);
    const diff = round1(real - net.measured);
    const boiler = net.boiler === undefined ? '' : `, boiler ${net.boiler ? 'on' : 'off'}`;
    log(`Garni ${real} °C | Netatmo ${net.measured} °C (setpoint ${net.setpoint} °C${boiler}) | diff ${diff}`);

    const { calibrate, message } = decide({ real, measured: net.measured, setpoint: net.setpoint }, this.cfg.rules);
    if (message) log(message);
    if (!calibrate) return;

    const since = (Date.now() - this.lastCalibration) / 1000;
    if (since < this.cfg.minCalibrationGapSec) {
      return log(`Last calibration ${Math.round(since)} s ago, waiting (min ${this.cfg.minCalibrationGapSec} s)`);
    }

    if (this.cfg.dryRun) return log(`[DRY_RUN] would set true temperature to ${real} °C`);
    const res = await this.netatmo.trueTemperature(target.homeId, target.roomId, net.measured, real);
    this.lastCalibration = Date.now();
    log(`Netatmo: true temperature set to ${real} °C →`, JSON.stringify(res));
  }

  private async readGarni(): Promise<number> {
    const { deviceId, tempCode, tempScale } = this.cfg.tuya;
    // Tuya keeps serving the last datapoints of an offline device, so check the online flag.
    const device = await this.tuya.device(deviceId);
    if (!device.online) throw new Error('Tuya: Garni is offline, its last reading may be stale');
    const status = device.status ?? [];
    const dp = status.find((s) => s.code === tempCode);
    if (!dp || typeof dp.value !== 'number') {
      throw new Error(`Tuya: DP "${tempCode}" not found. Available: ${status.map((s) => s.code).join(', ')}`);
    }
    return round1(dp.value / tempScale);
  }

  private async resolveTarget(): Promise<Target> {
    const { homeId, roomName } = this.cfg.netatmo;
    const { body } = await this.netatmo.homesData();
    const home = homeId ? body.homes.find((h) => h.id === homeId) : body.homes.find((h) => h.rooms?.length);
    if (!home) throw new Error('Netatmo: home not found');

    const wanted = roomName.toLowerCase();
    const rooms = home.rooms || [];
    const room = wanted ? rooms.find((r) => r.name.toLowerCase() === wanted) : rooms.find((r) => r.module_ids?.length);
    if (!room) throw new Error(`Netatmo: room "${roomName}" not found`);
    log(`Netatmo: home "${home.name}", room "${room.name}"`);
    return { homeId: home.id, roomId: room.id, roomName: room.name };
  }

  private async readNetatmo(target: Target): Promise<NetatmoReading> {
    const { body } = await this.netatmo.homeStatus(target.homeId);
    const room = body.home.rooms?.find((r) => r.id === target.roomId);
    if (!room || typeof room.therm_measured_temperature !== 'number') {
      throw new Error('Netatmo: room does not report therm_measured_temperature');
    }
    if (room.reachable === false) throw new Error('Netatmo: thermostat is unreachable, its last reading may be stale');
    const therm = body.home.modules?.find((m) => m.type === 'NATherm1' && typeof m.boiler_status === 'boolean');
    return {
      measured: room.therm_measured_temperature,
      setpoint: room.therm_setpoint_temperature,
      boiler: therm?.boiler_status,
    };
  }
}
