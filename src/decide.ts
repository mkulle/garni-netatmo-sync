// Decides whether to calibrate. Pure function without I/O so it can be unit tested.

import { round1 } from './utils.ts';

export interface Rules {
  threshold: number;
  maxDiff: number;
  validRange: [number, number];
  onlyWhenWrong: boolean;
  tolerance: number;
}

export interface Reading {
  real: number; // Garni
  measured: number; // Netatmo
  setpoint?: number;
  boiler?: boolean; // relay state; undefined = unknown
}

export interface Decision {
  calibrate: boolean;
  message?: string; // what to log; no message = skip silently
}

export function decide({ real, measured, setpoint, boiler }: Reading, rules: Rules): Decision {
  const diff = round1(real - measured);
  const [min, max] = rules.validRange;
  if (real < min || real > max) return { calibrate: false, message: `Garni reading outside ${min}–${max} °C, skipping` };
  if (Math.abs(diff) > rules.maxDiff) {
    return { calibrate: false, message: `Difference > ${rules.maxDiff} °C looks suspicious, skipping` };
  }

  if (rules.onlyWhenWrong && typeof setpoint === 'number') {
    // A PID thermostat heats in proportion to the error and has no fixed switching point.
    // While the real temperature stays within setpoint ± TOLERANCE, regulation is fine no
    // matter what the thermostat displays. Outside the band, calibrate only if Netatmo
    // underestimates the error, i.e. reads at least THRESHOLD colder / warmer than Garni.
    const lo = round1(setpoint - rules.tolerance);
    const hi = round1(setpoint + rules.tolerance);
    const overheats = real > hi && diff >= rules.threshold;
    const underheats = real < lo && -diff >= rules.threshold;
    if (!overheats && !underheats) {
      return { calibrate: false, message: `Thermostat regulates correctly (band ${lo}–${hi} °C), not calibrating` };
    }
    // Calibrate only when it changes what the boiler does. Overheating with the boiler off
    // (e.g. the room cooling down after a setback) or underheating with it already on can't
    // be fixed by a calibration, it would only shift the thermostat's reading.
    if (overheats && boiler === false) {
      return { calibrate: false, message: 'Thermostat is overheating but the boiler is off, not calibrating' };
    }
    if (underheats && boiler === true) {
      return { calibrate: false, message: 'Thermostat is underheating but the boiler is on, not calibrating' };
    }
    return { calibrate: true, message: `Thermostat is ${overheats ? 'overheating' : 'underheating'} → calibrating` };
  }

  return { calibrate: Math.abs(diff) >= rules.threshold };
}
