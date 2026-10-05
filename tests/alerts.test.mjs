import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine, normalizeRule, describeRule, formatAlertMessage } from '../src/alerts.mjs';

test('public rule timestamp reflects the last actual evaluation, not a UI read', () => {
  const engine = new AlertEngine([normalizeRule({ id:'clock', side:'ask', kind:'level_above', threshold:15, notifyEmail:false, notifyDesktop:true })]);
  assert.equal(engine.publicRules(2000)[0].evaluation.checkedAt, 0);
  engine.push({ code:'JZJ_ag', side:'ask', price:14.8, time:3000 }, { code:'JZJ_ag', connected:true, stale:false });
  assert.equal(engine.publicRules(9000)[0].evaluation.checkedAt, 3000);
});

test('normalizes and describes price and movement rules', () => {
  const level = normalizeRule({ side: 'ask', kind: 'level_above', threshold: 15.2, cooldownMinutes: 30 });
  assert.match(describeRule(level), /销售价.*15\.200/);
  const move = normalizeRule({ side: 'bid', kind: 'move_down_percent', threshold: 1.5, windowMinutes: 5, cooldownMinutes: 15 });
  assert.match(describeRule(move), /回购价.*5 分钟前下跌.*1\.50%/);
  assert.throws(() => normalizeRule({ threshold: 0 }));
  assert.throws(() => normalizeRule({ kind: 'move_up_percent', threshold: 101 }));
});

test('level alerts trigger on the edge, obey cooldown, and require rearm', () => {
  const base = Date.UTC(2026, 8, 11, 0, 0, 0);
  const rule = normalizeRule({ id: 'r1', side: 'ask', kind: 'level_above', threshold: 15, cooldownMinutes: 5, maxPerDay: 10 }, null, base);
  const engine = new AlertEngine([rule]);
  assert.equal(engine.push({ side: 'ask', price: 14.9, time: base }).events.length, 0);
  assert.equal(engine.push({ side: 'ask', price: 15.01, time: base + 1000 }).events.length, 1);
  assert.equal(engine.push({ side: 'ask', price: 15.1, time: base + 2000 }).events.length, 0);
  assert.equal(engine.push({ side: 'ask', price: 14.98, time: base + 301000 }).events.length, 0);
  assert.equal(engine.push({ side: 'ask', price: 15.02, time: base + 302000 }).events.length, 1);
});

test('movement alerts wait for a complete window and use amount changes', () => {
  const base = Date.UTC(2026, 8, 11, 0, 0, 0);
  const rule = normalizeRule({ id: 'r2', side: 'ask', kind: 'move_up_amount', threshold: 0.1, windowMinutes: 1, cooldownMinutes: 5 }, null, base);
  const engine = new AlertEngine([rule]);
  assert.equal(engine.push({ side: 'ask', price: 14.8, time: base }).events.length, 0);
  assert.match(engine.publicRules(base)[0].evaluation.reason, /积累/);
  const result = engine.push({ side: 'ask', price: 14.91, time: base + 60000 });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].basePrice, 14.8);
  assert.match(formatAlertMessage(result.events[0]), /\+0\.110 元\/克/);
});

test('timed alerts restart progress after a real quote gap instead of staying at zero', () => {
  const base = Date.UTC(2026, 8, 11, 0, 0, 0);
  const rule = normalizeRule({ id:'restart', side:'ask', kind:'move_up_amount', threshold:.2, windowSeconds:300, maxGapSeconds:60, notifyEmail:false, notifyDesktop:true });
  const engine = new AlertEngine([rule]);
  for(let seconds=0;seconds<=180;seconds+=30)engine.pushQuote({code:'JZJ_ag',ask:14.8,time:base+seconds*1000,askSourceTime:base-3600000+seconds*1000});
  engine.pushQuote({code:'JZJ_ag',ask:14.81,time:base+251000,askSourceTime:base-3600000+251000});
  engine.pushQuote({code:'JZJ_ag',ask:14.82,time:base+281000,askSourceTime:base-3600000+281000});
  const evaluation=engine.publicRules(base+281000)[0].evaluation.details[0];
  assert.match(evaluation.reason,/重新累计/);
  assert.ok(evaluation.progress>0);
  assert.ok(evaluation.progress<1);
});

test('stale quotes do not trigger and daily limits are enforced', () => {
  const base = Date.UTC(2026, 8, 11, 0, 0, 0);
  const rule = normalizeRule({ id: 'r3', side: 'bid', kind: 'level_below', threshold: 14, cooldownMinutes: 5, maxPerDay: 1 }, null, base);
  const engine = new AlertEngine([rule]);
  assert.equal(engine.push({ side: 'bid', price: 13.9, time: base }, { stale: true }).events.length, 0);
  assert.equal(engine.push({ side: 'bid', price: 13.9, time: base + 1000 }).events.length, 1);
  engine.push({ side: 'bid', price: 14.2, time: base + 301000 });
  assert.equal(engine.push({ side: 'bid', price: 13.8, time: base + 302000 }).events.length, 0);
});

test('daily change and spread rules use live quote context', () => {
  const base = Date.UTC(2026, 8, 11, 0, 0, 0);
  const day = normalizeRule({ id: 'r4', side: 'ask', kind: 'day_down_percent', threshold: 2, notifyEmail: false, notifyDesktop: true });
  const spread = normalizeRule({ id: 'r5', side: 'ask', kind: 'spread_above', threshold: 0.09, notifyEmail: false, notifySound: true });
  const engine = new AlertEngine([day, spread]);
  const result = engine.push({ side: 'ask', price: 14.5, time: base }, { preClose: 15, spread: 0.1 });
  assert.equal(result.events.length, 2);
  assert.match(describeRule(day), /较昨收下跌/);
  assert.match(describeRule(spread), /价差/);
});

test('range and sustained rules rearm correctly', () => {
  const base = Date.UTC(2026, 8, 11, 0, 0, 0);
  const range = normalizeRule({ id: 'r6', side: 'ask', kind: 'range_enter', threshold: 14.5, threshold2: 14.8, cooldownMinutes: 5, notifyEmail: false, notifyDesktop: true });
  const sustained = normalizeRule({ id: 'r7', side: 'bid', kind: 'sustained_above', threshold: 14, windowMinutes: 1, notifyEmail: false, notifySound: true });
  const engine = new AlertEngine([range, sustained]);
  assert.equal(engine.push({ side: 'ask', price: 14.6, time: base }).events.length, 1);
  engine.push({ side: 'ask', price: 14.9, time: base + 1000 });
  assert.equal(engine.push({ side: 'ask', price: 14.7, time: base + 301000 }).events.length, 1);
  assert.equal(engine.push({ side: 'bid', price: 14.1, time: base }).events.length, 0);
  assert.equal(engine.push({ side: 'bid', price: 14.2, time: base + 60000 }).events.length, 1);
  assert.throws(() => normalizeRule({ kind: 'range_enter', threshold: 15, threshold2: 14, notifyDesktop: true }));
  assert.throws(() => normalizeRule({ threshold: 15, notifyEmail: false, notifyDesktop: false, notifySound: false }));
});

test('compound rules support all and any logic without duplicate triggers', () => {
  const base = Date.UTC(2026, 8, 11, 0, 0, 0);
  const rule = normalizeRule({
    id: 'compound', logic: 'all', notifyEmail: false, notifyDesktop: true, cooldownMinutes: 5,
    conditions: [
      { side: 'ask', kind: 'level_above', threshold: 15 },
      { side: 'bid', kind: 'day_up_amount', threshold: 0.1 },
    ],
  });
  assert.match(describeRule(rule), /且/);
  const engine = new AlertEngine([rule]);
  assert.equal(engine.pushQuote({ ask: 15.1, bid: 14.8, time: base }, { preClose: { ask: 14.9, bid: 14.75 }, spread: 0.3 }).events.length, 0);
  assert.equal(engine.pushQuote({ ask: 15.1, bid: 14.9, time: base + 1000 }, { preClose: { ask: 14.9, bid: 14.75 }, spread: 0.2 }).events.length, 1);
  assert.equal(engine.pushQuote({ ask: 15.2, bid: 15, time: base + 2000 }, { preClose: { ask: 14.9, bid: 14.75 }, spread: 0.2 }).events.length, 0);
  const any = normalizeRule({ id: 'any', logic: 'any', notifyEmail: false, notifyDesktop: true, conditions: [{ side: 'ask', kind: 'level_above', threshold: 20 }, { side: 'bid', kind: 'level_below', threshold: 14 }] });
  assert.match(describeRule(any), /或/);
  assert.equal(new AlertEngine([any]).pushQuote({ ask: 15, bid: 13.9, time: base }).events.length, 1);
});

test('a damaged saved rule does not stop valid rules from loading', () => {
  const valid = normalizeRule({ id: 'valid', side: 'ask', kind: 'level_above', threshold: 15, notifyEmail: false, notifyDesktop: true });
  const engine = new AlertEngine([{ id: 'damaged', threshold: 0 }, valid]);
  assert.deepEqual(engine.publicRules().map(rule => rule.id), ['valid']);
});

test('crossing, intraday extremes, volatility, and at-least logic work together', () => {
  const base = Date.UTC(2026, 8, 11, 0, 0, 0);
  const rule = normalizeRule({
    id: 'advanced', logic: 'at_least', minimumMatches: 2, cooldownSeconds: 0,
    notifyEmail: false, notifyDesktop: true,
    conditions: [
      { side: 'ask', kind: 'cross_above', threshold: 15 },
      { side: 'ask', kind: 'drawdown_from_high', threshold: 0.2 },
      { side: 'ask', kind: 'volatility_amount', threshold: 0.25, windowSeconds: 30 },
    ],
  });
  const engine = new AlertEngine([rule]);
  assert.equal(engine.push({ side: 'ask', price: 15.05, time: base, session: 's1' }, { high: { ask: 15.05 } }).events.length, 0);
  assert.equal(engine.push({ side: 'ask', price: 14.75, time: base + 30000, session: 's1' }, { high: { ask: 15.05 } }).events.length, 1);
  assert.match(describeRule(rule), /至少满足 2 项/);
  const crossOnly = new AlertEngine([normalizeRule({ id: 'cross', side: 'ask', kind: 'cross_above', threshold: 15, triggerMode: 'cross', notifyEmail: false, notifyDesktop: true })]);
  assert.equal(crossOnly.push({ side: 'ask', price: 14.99, time: base }).events.length, 0);
  assert.equal(crossOnly.push({ side: 'ask', price: 15.01, time: base + 1000 }).events.length, 1);
});

test('rules are isolated by product and once mode survives rearming prices', () => {
  const base = Date.UTC(2026, 8, 12, 0, 0, 0);
  const rule = normalizeRule({ id: 'gold-once', marketCode: 'JZJ_au', marketName: '黄金', reminderMode: 'once', side: 'ask', kind: 'level_above', threshold: 900, notifyEmail: false, notifyDesktop: true });
  const engine = new AlertEngine([rule]);
  assert.equal(engine.pushQuote({ code: 'JZJ_ag', ask: 15, time: base }, { code: 'JZJ_ag' }).events.length, 0);
  assert.equal(engine.pushQuote({ code: 'JZJ_au', ask: 901, time: base + 1000 }, { code: 'JZJ_au' }).events.length, 1);
  engine.pushQuote({ code: 'JZJ_au', ask: 899, time: base + 2000 }, { code: 'JZJ_au' });
  assert.equal(engine.pushQuote({ code: 'JZJ_au', ask: 902, time: base + 3000 }, { code: 'JZJ_au' }).events.length, 0);
  assert.equal(engine.publicRules()[0].state.triggeredOnce, true);
});

test('editing a paused rule preserves its paused state and cooldown unit', () => {
  const existing = normalizeRule({ id: 'paused-edit', enabled: false, side: 'ask', kind: 'level_above', threshold: 15, cooldownSeconds: 90, cooldownUnit: 1, notifyEmail: false, notifyDesktop: true });
  const edited = normalizeRule({ id: 'paused-edit', side: 'ask', kind: 'level_above', threshold: 16, cooldownSeconds: 90, cooldownUnit: 1, notifyEmail: false, notifyDesktop: true }, existing);
  assert.equal(edited.enabled, false);
  assert.equal(edited.cooldownUnit, 1);
});

test('alert severity is normalized and preserved', () => {
  const urgent = normalizeRule({ id:'urgent-rule', severity:'urgent', side:'ask', kind:'level_above', threshold:15, notifyEmail:false, notifyDesktop:true });
  const fallback = normalizeRule({ id:'fallback-rule', severity:'invalid', side:'ask', kind:'level_above', threshold:15, notifyEmail:false, notifyDesktop:true });
  assert.equal(urgent.severity, 'urgent');
  assert.equal(fallback.severity, 'normal');
});
