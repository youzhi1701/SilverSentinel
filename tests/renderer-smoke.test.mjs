import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const renderer = fs.readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/v04.css', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.cjs', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const taskbarHtml = fs.readFileSync(new URL('../src/taskbar.html', import.meta.url), 'utf8');
const taskbarHost = fs.readFileSync(new URL('../src/taskbar-host.ps1', import.meta.url), 'utf8');

test('AI renderer defines every helper used by renderAi', () => {
  for (const name of ['currentAiResult', 'renderProbabilities', 'renderAiHistory']) {
    assert.match(renderer, new RegExp(`function\\s+${name}\\s*\\(`));
  }
});

test('secondary market position uses its own live range and updates fill plus marker', () => {
  assert.match(renderer, /quotePosition\(x\.ask,x\.askLow,x\.askHigh\)/);
  assert.match(renderer, /positionBox\?\.style\.setProperty\('--position'/);
  assert.match(renderer, /fill\.style\.setProperty\('width'/);
  assert.match(styles, /\.aux-position \.position-track \.position-fill/);
  assert.match(styles, /position-track i\{left:calc\(var\(--position/);
});

test('visual editor exposes nested modules and fine adjustment controls', () => {
  for (const id of ['marketPrimary', 'marketGold', 'marketPlatinum', 'newsList', 'aiSummary', 'chartCanvas', 'chartTape']) {
    assert.match(renderer, new RegExp(`id:'${id}'`));
  }
  assert.match(renderer, /function bindAdjustmentSteppers\(/);
  for (const id of ['module-x','module-y','module-margin','module-max-height','module-font-size','module-font-weight','module-line-height','module-letter-spacing','module-color','module-z-index','module-collapse']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(renderer, /translate\(\$\{Number\(value\.x\)/);
  assert.match(renderer, /function migrateDisplayLayout\(/);
  assert.match(renderer, /DISPLAY_LAYOUT_SCHEMA=3/);
  assert.match(renderer, /layout-compact-all/);
  assert.match(renderer, /layout-restore-visible/);
});

test('all chart periods normalize history and merge the live quote into the active bucket', () => {
  assert.match(renderer, /function normalizeChartCandles\(/);
  assert.match(renderer, /beijingBucket\(stamp\)/);
  assert.match(renderer, /chartCandles=normalizeChartCandles/);
  assert.match(renderer, /mergeLiveQuoteIntoChart\(quote\(\)\)/);
});

test('rule editor uses automatic content and the list switch is isolated from row editing', () => {
  assert.match(renderer, /function automaticRuleContent\(/);
  assert.match(renderer, /function syncAutomaticRuleContent\(/);
  assert.match(renderer, /if\(switchLabel\)\{/);
  assert.match(renderer, /e\.stopPropagation\(\)/);
});

test('settings are grouped and imported layouts are adapted to the current viewport', () => {
  assert.match(renderer, /function bindSettingsTabs\(/);
  assert.match(renderer, /function adaptImportedLayout\(/);
  assert.match(renderer, /layoutLocked:false/);
});

test('floating window and native taskbar ticker use separate windows and recovery controls', () => {
  assert.match(main, /showMiniContextMenu/);
  assert.match(main, /setIgnoreMouseEvents/);
  assert.match(main, /createTaskbarWindow/);
  assert.match(main, /dockTaskbarWindow/);
  assert.match(main, /syncFloatingWindows/);
  assert.match(taskbarHost, /SetParent/);
  assert.match(taskbarHost, /Shell_TrayWnd/);
  assert.match(taskbarHtml, /id="bid"/);
  assert.match(taskbarHtml, /id="ask"/);
  assert.match(main, /关闭悬浮窗鼠标穿透/);
  assert.match(html, /id="mini-click-through"/);
  assert.match(html, /id="mini-taskbar-mode"/);
  assert.match(main, /Math\.max\(0\.7, Number\(settings\.miniOpacity\)/);
});

test('sound and speech use separate effective volume paths', () => {
  assert.match(renderer, /speech-volume/);
  assert.match(renderer, /function alertGain/);
  assert.match(main, /isCurrentlyAudible/);
  assert.match(main, /speechVolume/);
  assert.match(main, /ruleVolume\*globalVolume\/100/);
  assert.match(main, /backgroundThrottling: false/);
  assert.match(main, /autoplayPolicy: 'no-user-gesture-required'/);
  assert.match(html, /试听语音播报/);
  assert.match(html, /100%为原始电平，300%为3倍电平/);
});

test('live alert updates treat events as newest-first and avoid stale tail comparisons', () => {
  assert.match(renderer, /slice\(0,3\)\.map\(e=>\[e\.id,e\.status,e\.time\]\)/);
  assert.match(renderer, /const latest=\(value\.events\|\|\[\]\)\[0\]/);
  assert.doesNotMatch(renderer, /slice\(-3\)\.map\(e=>\[e\.id,e\.status,e\.time\]\)/);
});

test('high-frequency market rendering is guarded by stable signatures', () => {
  assert.match(renderer, /lastSessionSignature/);
  assert.match(renderer, /if\(signature===lastSessionSignature\)return/);
  assert.match(renderer, /if\(signature===lastChoiceSignature\)return/);
  assert.match(renderer, /if\(auxCodes\.join\('\|'\)!==previousAuxCodes\)localStorage\.setItem\('aux-markets'/);
});

test('detail editor uses one persisted scale model without compounding inline font sizes', () => {
  assert.match(renderer, /function detailLayoutKey\(\)\{return `detail-layout:\$\{stableDisplayKey\|\|'fallback'\}`\}/);
  assert.match(renderer, /panel\.style\.setProperty\('--panel-scale',next\)/);
  assert.doesNotMatch(renderer, /style\.fontSize=`calc\(/);
  assert.match(styles, /\.nova-market \.chart-panel>\* \{zoom:var\(--panel-scale,1\)\}/);
});

