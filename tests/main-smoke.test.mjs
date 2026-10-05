import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.cjs', import.meta.url), 'utf8');

test('AI persisted state is bounded on load', () => {
  assert.match(main, /slice\(0,120\)/);
  assert.match(main, /Array\.isArray\(rows\)\?rows\.slice\(0,50\):\[\]/);
});

test('live alert UI broadcasting is throttled away from per-frame writes', () => {
  assert.match(main, /const ALERT_UI_BROADCAST_MS = 250/);
  assert.match(main, /setTimeout\(\(\)=>\{alertUiBroadcastTimer=null;broadcastVisible\('alerts-changed',publicAlerts\(\)\)\},ALERT_UI_BROADCAST_MS\)/);
});

test('persisted app settings are normalized before use', () => {
  assert.match(main, /value\.uiScale = clampUiScale\(value\.uiScale\)/);
  assert.match(main, /isValidClockTime\(value\.quietStart\)/);
  assert.match(main, /isValidClockTime\(value\.quietEnd\)/);
});
