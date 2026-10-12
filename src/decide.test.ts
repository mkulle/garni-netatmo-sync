import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, type Rules } from './decide.ts';

const rules: Rules = { threshold: 0.3, maxDiff: 8, validRange: [5, 35], onlyWhenWrong: true, tolerance: 0.2 };
const calibrates = (real: number, measured: number, setpoint = 21) =>
  decide({ real, measured, setpoint }, rules).calibrate;

test('Garni within setpoint ± tolerance → no calibration', () => {
  assert.equal(calibrates(20.9, 21.2), false);
  assert.equal(calibrates(21.1, 20.9), false);
  assert.equal(calibrates(21.0, 20.0), false);
});

test('underheating: Garni below band, Netatmo ≥ threshold warmer', () => {
  assert.equal(calibrates(20.7, 21.2), true);
  assert.equal(calibrates(20.7, 20.9), false); // diff only 0.2
});

test('overheating: Garni above band, Netatmo ≥ threshold colder', () => {
  assert.equal(calibrates(21.4, 20.9), true);
  assert.equal(calibrates(21.3, 21.1), false); // diff only 0.2
});

test('Netatmo overestimates the error → no calibration', () => {
  assert.equal(calibrates(21.5, 22.0), false);
  assert.equal(calibrates(20.5, 20.0), false);
});

test('schedule drops to 19 °C, both above setpoint, diff ≥ threshold → overheating', () => {
  assert.equal(calibrates(21.3, 20.9, 19), true);
});

test('calibrate only when it changes the boiler state', () => {
  const withBoiler = (real: number, measured: number, boiler: boolean) =>
    decide({ real, measured, setpoint: 21, boiler }, rules).calibrate;
  assert.equal(withBoiler(21.4, 20.9, true), true); // overheating, boiler on → stop it
  assert.equal(withBoiler(21.4, 20.9, false), false); // overheating, boiler already off
  assert.equal(withBoiler(20.7, 21.2, false), true); // underheating, boiler off → start it
  assert.equal(withBoiler(20.7, 21.2, true), false); // underheating, boiler already on
});

test('without CALIBRATE_ONLY_WHEN_WRONG only the threshold matters', () => {
  const r = { ...rules, onlyWhenWrong: false };
  assert.equal(decide({ real: 21.3, measured: 21.1, setpoint: 21 }, r).calibrate, false);
  assert.equal(decide({ real: 21.4, measured: 21.1, setpoint: 21 }, r).calibrate, true);
});

test('out of range or suspicious diff → no calibration', () => {
  assert.equal(calibrates(40, 21), false);
  assert.equal(calibrates(30, 21), false);
});
