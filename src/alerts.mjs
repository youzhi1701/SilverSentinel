import { randomUUID, createHash } from 'node:crypto';

export const ALERT_KINDS = Object.freeze([
  'level_above', 'level_below', 'cross_above', 'cross_below',
  'move_up_amount', 'move_down_amount', 'move_up_percent', 'move_down_percent',
  'day_up_amount', 'day_down_amount', 'day_up_percent', 'day_down_percent',
  'sustained_above', 'sustained_below', 'range_enter', 'range_exit', 'spread_above',
  'drawdown_from_high', 'rebound_from_low', 'volatility_amount', 'volatility_percent',
]);

const KIND_SET = new Set(ALERT_KINDS);
const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const finite = value => Number.isFinite(Number(value)) ? Number(value) : NaN;
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const isMovement = kind => kind.startsWith('move_');
const isDaily = kind => kind.startsWith('day_');
const isSustained = kind => kind.startsWith('sustained_');
const isVolatility = kind => kind.startsWith('volatility_');
const isPercent = kind => kind.endsWith('_percent');
const needsWindow = kind => isMovement(kind) || isSustained(kind) || isVolatility(kind);
const dayKey = time => new Date(time).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });

function normalizeCondition(input, index = 0) {
  const kind = KIND_SET.has(input?.kind) ? input.kind : 'level_above';
  const threshold = finite(input?.threshold);
  if (!(threshold > 0)) throw new Error(`第 ${index + 1} 个条件的数值必须大于 0`);
  if (isPercent(kind) && threshold > 100) throw new Error(`第 ${index + 1} 个条件的百分比不能超过 100%`);
  if (!isPercent(kind) && threshold > 10000) throw new Error(`第 ${index + 1} 个条件的数值过大`);
  const threshold2 = finite(input?.threshold2);
  if (kind.startsWith('range_') && (!(threshold2 > threshold) || threshold2 > 10000)) throw new Error(`第 ${index + 1} 个条件的区间上限必须大于下限`);
  const legacySeconds = Number(input?.windowMinutes) * 60;
  const windowSeconds = needsWindow(kind) ? Math.round(clamp(input?.windowSeconds, 5, 86400, Number.isFinite(legacySeconds) && legacySeconds > 0 ? legacySeconds : 300)) : 0;
  return { id: clean(input?.id) || randomUUID(), side: kind === 'spread_above' ? 'ask' : input?.side === 'bid' ? 'bid' : 'ask', kind, threshold, threshold2: kind.startsWith('range_') ? threshold2 : null, windowSeconds, windowMinutes: windowSeconds ? windowSeconds / 60 : 0 };
}

function durationText(seconds) {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  return `${Number((seconds / 60).toFixed(1))} 分钟`;
}

export function describeCondition(condition) {
  const side = condition.side === 'bid' ? '回购价' : '销售价';
  const amount = Number(condition.threshold).toFixed(isPercent(condition.kind) ? 2 : 3);
  const duration = durationText(condition.windowSeconds || Number(condition.windowMinutes || 5) * 60);
  const direction = condition.kind.includes('down') || condition.kind === 'level_below' ? '下跌' : '上涨';
  if (condition.kind === 'level_above') return `${side}达到或高于 ${amount} 元/克`;
  if (condition.kind === 'level_below') return `${side}达到或低于 ${amount} 元/克`;
  if (condition.kind === 'cross_above') return `${side}向上穿越 ${amount} 元/克`;
  if (condition.kind === 'cross_below') return `${side}向下穿越 ${amount} 元/克`;
  if (condition.kind === 'sustained_above') return `${side}连续 ${duration} 高于 ${amount} 元/克`;
  if (condition.kind === 'sustained_below') return `${side}连续 ${duration} 低于 ${amount} 元/克`;
  if (condition.kind === 'range_enter') return `${side}进入 ${amount}–${Number(condition.threshold2).toFixed(3)} 元/克区间`;
  if (condition.kind === 'range_exit') return `${side}离开 ${amount}–${Number(condition.threshold2).toFixed(3)} 元/克区间`;
  if (condition.kind === 'spread_above') return `销售与回购价差达到 ${amount} 元/克`;
  if (condition.kind === 'drawdown_from_high') return `${side}从今日最高回落 ${amount} 元/克`;
  if (condition.kind === 'rebound_from_low') return `${side}从今日最低反弹 ${amount} 元/克`;
  if (condition.kind === 'volatility_amount') return `${side}在 ${duration} 内波动达到 ${amount} 元/克`;
  if (condition.kind === 'volatility_percent') return `${side}在 ${duration} 内波动达到 ${amount}%`;
  if (isDaily(condition.kind)) return `${side}较昨收${direction}不少于 ${amount}${isPercent(condition.kind) ? '%' : ' 元/克'}`;
  return `${side}相较 ${duration}前${direction}不少于 ${amount}${isPercent(condition.kind) ? '%' : ' 元/克'}`;
}

export function describeRule(rule) {
  const conditions = Array.isArray(rule?.conditions) && rule.conditions.length ? rule.conditions : [rule];
  const joiner = rule?.logic === 'any' ? '，或者 ' : rule?.logic === 'at_least' ? `，至少满足 ${rule.minimumMatches || 1} 项：` : '，并且 ';
  return conditions.map(describeCondition).join(joiner);
}

function signatureOf(rule) {
  return createHash('sha256').update(JSON.stringify({ marketCode: rule.marketCode, logic: rule.logic, minimumMatches: rule.minimumMatches, conditions: rule.conditions, cooldownSeconds: rule.cooldownSeconds, maxPerDay: rule.maxPerDay, triggerMode: rule.triggerMode, reminderMode: rule.reminderMode })).digest('hex').slice(0, 16);
}

export function normalizeRule(input, existing = null, now = Date.now()) {
  const rawConditions = Array.isArray(input?.conditions) && input.conditions.length ? input.conditions : [input];
  if (rawConditions.length > 20) throw new Error('一条规则最多可设置 20 个条件');
  const conditions = rawConditions.map(normalizeCondition);
  const legacyCooldown = Number(input?.cooldownMinutes) * 60;
  const cooldownSeconds = Math.round(clamp(input?.cooldownSeconds, 0, 604800, Number.isFinite(legacyCooldown) ? legacyCooldown : 1800));
  const maxPerDay = Math.round(clamp(input?.maxPerDay, 1, 9999, 10));
  const recipientIds = [...new Set(Array.isArray(input?.recipientIds) ? input.recipientIds.map(value => clean(value, 80)).filter(Boolean) : [])];
  const first = conditions[0];
  const logic = ['all', 'any', 'at_least'].includes(input?.logic) ? input.logic : 'all';
  const base = {
    id: existing?.id || clean(input?.id, 80) || randomUUID(), name: clean(input?.name),
    enabled: input?.enabled === undefined ? existing?.enabled !== false : input.enabled !== false,
    marketCode: clean(input?.marketCode, 80) || 'JZJ_ag', marketName: clean(input?.marketName, 40) || '白银',
    logic, minimumMatches: logic === 'at_least' ? Math.round(clamp(input?.minimumMatches, 1, conditions.length, 1)) : 1,
    conditions, side: first.side, kind: first.kind, threshold: first.threshold, threshold2: first.threshold2,
    windowSeconds: first.windowSeconds, windowMinutes: first.windowMinutes, cooldownSeconds, cooldownMinutes: cooldownSeconds / 60,
    maxPerDay, recipientIds, notifyEmail: input?.notifyEmail !== false, notifyDesktop: input?.notifyDesktop !== false,
    notifySound: !!input?.notifySound, notifySpeech: !!input?.notifySpeech, emailSubject: clean(input?.emailSubject, 160),
    messageTemplate: clean(input?.messageTemplate, 1000), speechText: clean(input?.speechText, 300),
    soundName: ['gentle', 'chime', 'urgent'].includes(input?.soundName) ? input.soundName : 'chime',
    soundVolume: clamp(input?.soundVolume, 0, 300, 100), triggerMode: input?.triggerMode === 'cross' ? 'cross' : 'immediate',
    severity: ['normal','important','urgent'].includes(input?.severity) ? input.severity : 'normal',
    reminderMode: ['once','daily','rearm','repeat'].includes(input?.reminderMode) ? input.reminderMode : 'rearm',
    maxGapSeconds: Math.round(clamp(input?.maxGapSeconds, 60, 300, 90)),
    cooldownUnit: [1, 60, 3600].includes(Number(input?.cooldownUnit)) ? Number(input.cooldownUnit) : Number(existing?.cooldownUnit) || 60,
    createdAt: existing?.createdAt || now, updatedAt: now,
  };
  if (!base.notifyEmail && !base.notifyDesktop && !base.notifySound && !base.notifySpeech) throw new Error('请至少选择一种提醒方式');
  if (!base.name) base.name = describeRule(base);
  base.signature = signatureOf(base);
  return base;
}

function emptyState() { return { armed: true, primed: false, triggeredOnce: false, lastMatches: [], lastTriggeredAt: 0, day: '', sentToday: 0, signature: '' }; }
function findBaseline(points, target) { for (let index = points.length - 1; index >= 0; index -= 1) if (points[index].time <= target) return { point: points[index], index }; return null; }
function continuity(points, start, end, maxGapMs) { for (let i = start + 1; i <= end; i += 1) if (points[i].time - points[i - 1].time > maxGapMs || points[i].session && points[i - 1].session && points[i].session !== points[i - 1].session) return false; return !!points.length; }
function continuousStart(points, start, end, maxGapMs) { let result=start; for(let i=start+1;i<=end;i+=1)if(points[i].time-points[i-1].time>maxGapMs||points[i].session&&points[i-1].session&&points[i].session!==points[i-1].session)result=i; return result; }

function evaluateCondition(condition, buffers, now, context = {}, maxGapSeconds = 20) {
  const points = buffers.get(`${context.code || 'JZJ_ag'}/${condition.side}`) || []; const current = points.at(-1);
  if (!current) return { ready: false, reason: `等待${condition.side === 'bid' ? '回购' : '销售'}报价` };
  const previous = points.at(-2); const basic = { ready: true, price: current.price, sourceTime: current.sourceTime || current.time };
  if (condition.kind === 'cross_above' || condition.kind === 'cross_below') {
    if (!previous) return { ...basic, ready: false, reason: '等待下一笔行情以确认穿越' };
    const up = condition.kind === 'cross_above';
    return { ...basic, condition: up ? previous.price < condition.threshold && current.price >= condition.threshold : previous.price > condition.threshold && current.price <= condition.threshold, basePrice: previous.price, metric: current.price };
  }
  if (condition.kind === 'range_enter' || condition.kind === 'range_exit') { const inside = current.price >= condition.threshold && current.price <= condition.threshold2; return { ...basic, condition: condition.kind === 'range_enter' ? inside : !inside, metric: current.price, basePrice: null }; }
  if (condition.kind === 'spread_above') { if (!Number.isFinite(context.spread) || context.quoteSkewMs > 5000) return { ...basic, ready: false, reason: '等待时间同步的回购与销售报价' }; return { ...basic, condition: context.spread >= condition.threshold, metric: context.spread, signed: context.spread, basePrice: null }; }
  if (condition.kind === 'drawdown_from_high' || condition.kind === 'rebound_from_low') {
    const anchor = Number(condition.kind === 'drawdown_from_high' ? context.high?.[condition.side] : context.low?.[condition.side]);
    if (!Number.isFinite(anchor) || anchor <= 0) return { ...basic, ready: false, reason: '等待当日最高最低数据' };
    const signed = condition.kind === 'drawdown_from_high' ? anchor - current.price : current.price - anchor;
    return { ...basic, condition: signed >= condition.threshold, metric: signed, signed, basePrice: anchor };
  }
  if (isDaily(condition.kind)) {
    const preClose = typeof context.preClose === 'object' ? Number(context.preClose?.[condition.side]) : Number(context.preClose);
    if (!Number.isFinite(preClose) || preClose <= 0) return { ...basic, ready: false, reason: '等待昨收数据' };
    const change = current.price - preClose; const percent = change / preClose * 100; const signed = isPercent(condition.kind) ? percent : change; const up = condition.kind.includes('_up_');
    return { ...basic, condition: up ? signed >= condition.threshold : signed <= -condition.threshold, basePrice: preClose, metric: Math.abs(signed), signed };
  }
  if (needsWindow(condition.kind)) {
    const target = now - condition.windowSeconds * 1000; const baseline = findBaseline(points, target); const maxGapMs = maxGapSeconds * 1000;
    if (!baseline || target - baseline.point.time > maxGapMs) { const requiredMs=condition.windowSeconds*1000,restart=continuousStart(points,0,points.length-1,maxGapMs),elapsedMs=Math.max(0,Math.min(requiredMs,current.time-Number(points[restart]?.time||current.time))),restarted=restart>0; return { ...basic, ready: false, reason: restarted?`行情曾中断，已从 ${new Date(points[restart].time).toLocaleTimeString('zh-CN',{hour12:false})} 重新累计`:`正在积累 ${durationText(condition.windowSeconds)} 连续行情`, elapsedMs, requiredMs, progress: requiredMs ? elapsedMs/requiredMs : 0,...(restarted?{restartedAt:points[restart].time}:{}) }; }
    if (!continuity(points, baseline.index, points.length - 1, maxGapMs)) { const restart=continuousStart(points,baseline.index,points.length-1,maxGapMs),requiredMs=condition.windowSeconds*1000,elapsedMs=Math.max(0,Math.min(requiredMs,current.time-points[restart].time));return { ...basic, ready:false,reason:`行情曾中断，已从 ${new Date(points[restart].time).toLocaleTimeString('zh-CN',{hour12:false})} 重新累计`,elapsedMs,requiredMs,progress:requiredMs?elapsedMs/requiredMs:0,restartedAt:points[restart].time }; }
    const windowPoints = points.slice(baseline.index);
    if (isSustained(condition.kind)) { const above = condition.kind === 'sustained_above'; return { ...basic, condition: windowPoints.every(point => above ? point.price >= condition.threshold : point.price <= condition.threshold), metric: current.price, basePrice: baseline.point.price }; }
    if (isVolatility(condition.kind)) { const high = Math.max(...windowPoints.map(point => point.price)); const low = Math.min(...windowPoints.map(point => point.price)); const spread = high - low; const metric = isPercent(condition.kind) && low > 0 ? spread / low * 100 : spread; return { ...basic, condition: metric >= condition.threshold, metric, signed: metric, basePrice: low, highPrice: high }; }
    const change = current.price - baseline.point.price; const percent = baseline.point.price > 0 ? change / baseline.point.price * 100 : 0; const signed = isPercent(condition.kind) ? percent : change; const up = condition.kind.includes('up');
    return { ...basic, condition: up ? signed >= condition.threshold : signed <= -condition.threshold, basePrice: baseline.point.price, metric: Math.abs(signed), signed };
  }
  return { ...basic, condition: condition.kind === 'level_above' ? current.price >= condition.threshold : current.price <= condition.threshold, metric: current.price, basePrice: null };
}

export class AlertEngine {
  constructor(rules = [], states = {}) { this.rules = []; this.states = new Map(); this.buffers = new Map() ; this.evaluations = new Map(); this.setRules(rules, states); }
  setRules(rules, states = this.snapshotStates()) {
    this.rules = []; for (const rule of Array.isArray(rules) ? rules : []) { try { this.rules.push(normalizeRule(rule, rule, Number(rule?.updatedAt) || Date.now())); } catch {} }
    const next = new Map();
    for (const rule of this.rules) { const prior = states?.[rule.id] || this.states.get(rule.id) || {}; next.set(rule.id, prior.signature && prior.signature !== rule.signature ? { ...emptyState(), signature: rule.signature } : { ...emptyState(), ...prior, signature: rule.signature }); }
    this.states = next;
  }
  addPoint(point) {
    if (!point || !['bid', 'ask'].includes(point.side) || !Number.isFinite(point.price) || !Number.isFinite(point.time)) return false;
    const key = `${point.code || 'JZJ_ag'}/${point.side}`; if (!this.buffers.has(key)) this.buffers.set(key, []); const points = this.buffers.get(key); if (points.length && point.time < points.at(-1).time) return false;
    points.push({ price: point.price, time: point.time, sourceTime: point.sourceTime || point.time, session: point.session || '' });
    const cutoff = point.time - 25 * 3600000; while (points.length && points[0].time < cutoff) points.shift(); return true;
  }
  evaluate(now, context = {}, relevantSide = null) {
    const events = []; let stateChanged = false;
    for (const rule of this.rules) {
      if (!rule.enabled || (context.code && rule.marketCode !== context.code)) continue;
      if (relevantSide && !rule.conditions.some(c => c.side === relevantSide || c.kind === 'spread_above')) continue;
      const details = rule.conditions.map(c => {
        const sideStale = c.kind === 'spread_above' ? context.sideFresh && (!context.sideFresh.bid || !context.sideFresh.ask) : context.sideFresh?.[c.side] === false;
        if (context.connected === false || context.stale || sideStale) return { ready: false, reason: context.connected === false ? '行情未连接，暂停判断' : `${c.side === 'bid' ? '回购' : '销售'}报价已过期，暂停判断`, price: this.buffers.get(`${context.code || rule.marketCode}/${c.side}`)?.at(-1)?.price };
        return evaluateCondition(c, this.buffers, now, context, rule.maxGapSeconds);
      });
      const readyCount = details.filter(item => item.ready).length; const matchedIndexes = details.map((item, index) => item.ready && item.condition ? index : -1).filter(index => index >= 0);
      const required = rule.logic === 'any' ? 1 : rule.logic === 'at_least' ? rule.minimumMatches : rule.conditions.length;
      const ready = rule.logic === 'all' ? readyCount === rule.conditions.length : readyCount > 0; const condition = matchedIndexes.length >= required;
      const state = this.states.get(rule.id) || emptyState(); const today = dayKey(now);
      if (state.day !== today) { state.day = today; state.sentToday = 0; stateChanged = true; }
      const previousMatches = Array.isArray(state.lastMatches) ? state.lastMatches : []; const edge = condition && (!state.primed || matchedIndexes.some(index => previousMatches[index] !== true));
      const exhausted = rule.reminderMode === 'once' && state.triggeredOnce;
      const dailyExhausted = rule.reminderMode === 'daily' && state.sentToday > 0;
      const shouldTrigger = !exhausted && !dailyExhausted && condition && (rule.reminderMode === 'repeat' ? true : state.armed || edge); if (!condition && !state.armed && rule.reminderMode !== 'once') { state.armed = true; stateChanged = true; }
      const cooldownReady = now - state.lastTriggeredAt >= rule.cooldownSeconds * 1000; const primaryIndex = matchedIndexes[0] ?? 0; const primary = details[primaryIndex] || {};
      const evaluation = { ...primary, ready, condition, reason: ready ? '' : details.find(item => !item.ready)?.reason || '等待行情', details, matchedIndexes, required, checkedAt: now }; this.evaluations.set(rule.id, evaluation);
      if (ready && shouldTrigger && cooldownReady && state.sentToday < rule.maxPerDay && (state.primed || rule.triggerMode === 'immediate')) {
        state.armed = false; state.lastTriggeredAt = now; state.sentToday += 1; if (rule.reminderMode === 'once') state.triggeredOnce = true; stateChanged = true;
        events.push({ id: randomUUID(), ruleId: rule.id, ruleName: rule.name, severity: rule.severity, marketCode: rule.marketCode, marketName: rule.marketName, description: describeRule(rule), logic: rule.logic, conditions: rule.conditions.map(describeCondition), matchedConditions: matchedIndexes.map(index => describeCondition(rule.conditions[index])), side: rule.conditions[primaryIndex].side, kind: rule.conditions[primaryIndex].kind, price: primary.price, basePrice: primary.basePrice, metric: primary.metric, signed: primary.signed, threshold: rule.conditions[primaryIndex].threshold, threshold2: rule.conditions[primaryIndex].threshold2, windowSeconds: rule.conditions[primaryIndex].windowSeconds || null, windowMinutes: rule.conditions[primaryIndex].windowMinutes || null, recipientIds: rule.recipientIds, notifyEmail: rule.notifyEmail, notifyDesktop: rule.notifyDesktop, notifySound: rule.notifySound, notifySpeech: rule.notifySpeech, emailSubject: rule.emailSubject, messageTemplate: rule.messageTemplate, speechText: rule.speechText, soundName: rule.soundName, soundVolume: rule.soundVolume, time: now, sourceTime: primary.sourceTime || null });
      }
      if (!state.primed) { state.primed = true; stateChanged = true; } state.lastMatches = details.map(item => !!(item.ready && item.condition)); this.states.set(rule.id, state);
    }
    return { events, stateChanged };
  }
  push(point, context = {}) { if (!this.addPoint(point)) return { events: [], stateChanged: false }; return this.evaluate(point.time, context, point.side); }
  pushQuote(quote, context = {}) { if (!quote || !Number.isFinite(quote.time)) return { events: [], stateChanged: false }; let added = false; if (Number.isFinite(quote.bid)) added = this.addPoint({ code: quote.code, side: 'bid', price: quote.bid, time: quote.time, sourceTime: quote.bidSourceTime, session: quote.session }) || added; if (Number.isFinite(quote.ask)) added = this.addPoint({ code: quote.code, side: 'ask', price: quote.ask, time: quote.time, sourceTime: quote.askSourceTime, session: quote.session }) || added; return added ? this.evaluate(quote.time, context) : { events: [], stateChanged: false }; }
  snapshotStates() { return Object.fromEntries([...this.states.entries()].map(([id, state]) => [id, { ...state }])); }
  publicRules(now = Date.now()) { return this.rules.map(rule => { const state = this.states.get(rule.id) || emptyState(); const evaluation = this.evaluations.get(rule.id) || { ready: false, reason: '等待实时行情', details: [] }; return { ...rule, description: describeRule(rule), state: { armed: state.armed, triggeredOnce: !!state.triggeredOnce, lastTriggeredAt: state.lastTriggeredAt, sentToday: state.sentToday, nextEligibleAt: state.lastTriggeredAt ? state.lastTriggeredAt + rule.cooldownSeconds * 1000 : 0 }, evaluation: { ready: !!evaluation.ready, reason: evaluation.reason || '', price: evaluation.price, basePrice: evaluation.basePrice, metric: evaluation.metric, signed: evaluation.signed, condition: !!evaluation.condition, details: evaluation.details || [], matchedIndexes: evaluation.matchedIndexes || [], checkedAt: evaluation.checkedAt || 0 } }; }); }
}

export function formatAlertMessage(event) {
  const text = clean(event.messageTemplate, 1000); const replacements = { '{规则名称}': event.ruleName, '{条件}': event.description, '{当前价格}': Number.isFinite(event.price) ? Number(event.price).toFixed(3) : '暂无', '{变化金额}': Number.isFinite(event.signed) ? `${event.signed >= 0 ? '+' : ''}${Number(event.signed).toFixed(3)}` : '暂无', '{触发时间}': new Date(event.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) };
  if (text) return Object.entries(replacements).reduce((value, [key, replacement]) => value.split(key).join(replacement), text);
  const lines = [`规则：${event.ruleName}`, `条件：${event.description}`, `触发时间：${new Date(event.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`, `触发价格：${Number.isFinite(event.price) ? Number(event.price).toFixed(3) : '暂无'} 元/克`];
  if (Array.isArray(event.matchedConditions) && event.matchedConditions.length) lines.push(`本次满足：${event.matchedConditions.join('；')}`);
  if (Number.isFinite(event.basePrice)) { lines.push(`基准价格：${Number(event.basePrice).toFixed(3)} 元/克`); const change = event.price - event.basePrice; const percent = event.basePrice > 0 ? change / event.basePrice * 100 : 0; lines.push(`价格变化：${change >= 0 ? '+' : ''}${change.toFixed(3)} 元/克（${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%）`); if (event.windowSeconds) lines.push(`观察窗口：${durationText(event.windowSeconds)}`); }
  if (event.kind === 'spread_above' && Number.isFinite(event.metric)) lines.push(`当前价差：${Number(event.metric).toFixed(3)} 元/克`);
  lines.push(`监测品种：${event.marketName || event.marketCode || '融通金行情'}`, `主要报价：${event.side === 'bid' ? '回购价' : '销售价'}`, '行情来源：融通金官方实时行情', '提示：本通知仅用于价格观察，不构成投资建议。'); return lines.join('\n');
}
