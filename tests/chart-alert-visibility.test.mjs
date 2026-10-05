import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ALERT_KINDS } from '../src/alerts.mjs';

const source = fs.readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
const start = source.indexOf('function conditionTarget(');
const end = source.indexOf('function alertDistance(', start);
assert.ok(start > 0 && end > start);
const chartFunctions = source.slice(start, end);

function project(conditions, details, side = 'ask', liveQuote = null) {
  const context = {
    primaryCode: 'JZJ_ag', chartSide: side, chartOffset: 0,
    snapshot: { status: liveQuote ? 'connected' : 'stopped' }, quote: () => liveQuote || {},
    alerts: { rules: [{ id: 'one', name: '测试预警', enabled: true, marketCode: 'JZJ_ag', conditions, evaluation: { details } }] },
    finite: value => Number.isFinite(Number(value)),
  };
  vm.runInNewContext(`${chartFunctions}\nresult = chartPriceAlerts();`, context);
  return context.result;
}

test('a dynamic rule stays visible as status when its observation window is interrupted', () => {
  const result = project([{ side: 'ask', kind: 'move_up_amount', threshold: .2 }], [{ ready: false, reason: '观察期间行情曾中断' }]);
  assert.equal(result.lines.length, 0);
  assert.equal(result.statuses.length, 1);
  assert.equal(result.statuses[0].detail.reason, '观察期间行情曾中断');
});

test('a dynamic rule becomes a price line when its current baseline is valid', () => {
  const result = project([{ side: 'ask', kind: 'move_up_amount', threshold: .2 }], [{ ready: true, basePrice: 14.7 }]);
  assert.equal(result.lines.length, 1);
  assert.ok(Math.abs(result.lines[0].price - 14.9) < 1e-9);
  assert.equal(result.statuses.length, 0);
});

test('spread and volatility rules remain visible without inventing a price target', () => {
  const result = project([
    { side: 'ask', kind: 'spread_above', threshold: .1 },
    { side: 'ask', kind: 'volatility_amount', threshold: .2 },
  ], [{ ready: true, basePrice: null }, { ready: true, basePrice: 14.7 }]);
  assert.equal(result.lines.length, 0);
  assert.equal(result.statuses.length, 2);
});

test('every supported alert kind has a visible chart representation', () => {
  for (const kind of ALERT_KINDS) {
    const result = project([{ side: 'ask', kind, threshold: .2, threshold2: .4 }], [{ ready: true, basePrice: 14.7 }]);
    assert.ok(result.lines.length + result.statuses.length > 0, kind);
  }
});

test('spread uses both bid and ask quotes and remains visible on either chart side', () => {
  const condition = { side: 'ask', kind: 'spread_above', threshold: .1 };
  assert.equal(project([condition], [{ ready: true, metric: .12 }], 'bid').statuses.length, 1);
  assert.equal(project([condition], [{ ready: true, metric: .12 }], 'ask').statuses.length, 1);
});

test('five minute amount and percent rules project from the current quote into the future', () => {
  const context = { Number, Math };
  vm.runInNewContext(`${chartFunctions}\nprojectAmount=forwardAlertTarget({kind:'move_up_amount',threshold:.2,windowSeconds:300},14.87,1000000);projectPercent=forwardAlertTarget({kind:'move_up_percent',threshold:2,windowSeconds:300},14.87,1000000);projectDown=forwardAlertTarget({kind:'move_down_percent',threshold:2,windowSeconds:300},14.87,1000000);`, context);
  assert.ok(Math.abs(context.projectAmount.price - 15.07) < 1e-9);
  assert.equal(context.projectAmount.at, 1300000);
  assert.ok(Math.abs(context.projectPercent.price - 15.1674) < 1e-9);
  assert.equal(context.projectPercent.at, 1300000);
  assert.ok(Math.abs(context.projectDown.price - 14.5726) < 1e-9);
});

test('invalid or missing live quotes do not produce a future target', () => {
  const context = {};
  vm.runInNewContext(`${chartFunctions}\nprojected=forwardAlertTarget({kind:'move_up_amount',threshold:.2,windowSeconds:300},NaN,1000000);`, context);
  assert.equal(context.projected, null);
});

test('live quote moves the five minute projection while the interrupted rule stays visible', () => {
  const condition = { side:'ask', kind:'move_up_amount', threshold:.2, windowSeconds:300 };
  const detail = { ready:false, reason:'观察期间行情曾中断' };
  const time = Date.now();
  const first = project([condition], [detail], 'ask', { ask:14.87, askTime:time });
  const second = project([condition], [detail], 'ask', { ask:14.90, askTime:time });
  assert.equal(first.statuses.length, 1);
  assert.equal(second.statuses.length, 1);
  assert.ok(Math.abs(first.lines[0].price - 15.07) < 1e-9);
  assert.ok(Math.abs(second.lines[0].price - 15.10) < 1e-9);
});
