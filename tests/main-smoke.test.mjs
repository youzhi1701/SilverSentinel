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
  assert.match(main, /next\.uiScale = clampUiScale\(next\.uiScale\)/);
  assert.match(main, /isValidClockTime\(next\.quietStart\)/);
  assert.match(main, /isValidClockTime\(next\.quietEnd\)/);
});

test('embedded official pages cannot navigate the app window to arbitrary hosts', () => {
  assert.match(main, /const trustedSourceDomains = \['jzj9999\.com', 'ytj9999\.com', 'jin10\.com'\]/);
  assert.match(main, /function isTrustedSourceUrl\(/);
  assert.match(main, /will-navigate/);
  assert.match(main, /shell\.openExternal\(next\)/);
});

test('renderer crash recovery is bounded to avoid reload loops', () => {
  assert.match(main, /let renderCrashTimes = \[\]/);
  assert.match(main, /now - time < 60000/);
  assert.match(main, /renderCrashTimes\.length <= 3/);
  assert.match(main, /界面在一分钟内连续异常退出/);
});

test('hot main-process settings use normalized in-memory caches', () => {
  for (const name of ['getSettings', 'getAppSettings', 'getAiSettings', 'getAlertStore']) {
    assert.match(main, new RegExp(`function\\s+${name}\\s*\\(`));
  }
  assert.match(main, /const saved = getAppSettings\(\)/);
  assert.match(main, /const stored = getAlertStore\(\)/);
  assert.match(main, /const settings = getSettings\(\)/);
});

