import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { UI_SCALE_MIN, UI_SCALE_MAX, clampUiScale, isValidClockTime } = require('../src/validation.cjs');

test('UI scale is clamped consistently', () => {
  assert.equal(UI_SCALE_MIN, 0.5);
  assert.equal(UI_SCALE_MAX, 2);
  assert.equal(clampUiScale(0.1), 0.5);
  assert.equal(clampUiScale(0.5), 0.5);
  assert.equal(clampUiScale(1.25), 1.25);
  assert.equal(clampUiScale(3), 2);
  assert.equal(clampUiScale('bad'), 1);
});

test('clock time validation rejects impossible times', () => {
  for (const value of ['00:00', '09:30', '23:59']) assert.equal(isValidClockTime(value), true);
  for (const value of ['', '9:30', '24:00', '23:60', '99:99', '12:345']) assert.equal(isValidClockTime(value), false);
});
