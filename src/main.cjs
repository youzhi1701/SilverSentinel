const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage,
  utilityProcess, shell, dialog, powerMonitor, safeStorage, screen, Notification,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { clampUiScale, isValidClockTime } = require('./validation.cjs');

const smoke = process.argv.includes('--smoke-test');
const demo = process.argv.includes('--demo-ui');
const backgroundLaunch = process.argv.includes('--background');
const captureFlag = process.argv.find(value => value.startsWith('--capture='));
const liveCaptureFlag = process.argv.find(value => value.startsWith('--live-capture='));
const miniCaptureFlag = process.argv.find(value => value.startsWith('--capture-mini='));
const captureMode = captureFlag || liveCaptureFlag || miniCaptureFlag;
const dataFlag = process.argv.find(value => value.startsWith('--data-dir='));
if (dataFlag) app.setPath('userData', path.resolve(dataFlag.slice(11)));
// Keep Chromium hardware acceleration enabled. The dashboard continuously
// redraws a large canvas; forcing software compositing made slower computers
// noticeably less responsive and can crash recent Electron GPU fallbacks.
app.setAppUserModelId('local.goldmonitor.desktop');

const html = path.join(__dirname, 'index.html');
const miniHtml = path.join(__dirname, 'mini.html');
const taskbarHtml = path.join(__dirname, 'taskbar.html');
const taskbarHostScript = path.join(__dirname, 'taskbar-host.ps1');
const iconPath = path.join(__dirname, '../assets/shengshi-logo.png');
const windowIconPath = path.join(__dirname, '../assets/shengshi-logo.ico');
const chartUrl = 'https://i.jzj9999.com/quoteh5';
const newsUrl = 'https://oem.jin10.com/rongtonggold/index.html';
const trustedSourceDomains = ['jzj9999.com', 'ytj9999.com', 'jin10.com'];
function isTrustedSourceUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && trustedSourceDomains.some(domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
const chartIntervals = new Set(['5s', '15s', '30s', '1', '5', '15', '30', '60', '120', '240', 'day', 'week', 'month']);
const chartSizes = new Set([120, 300, 600, 1000]);
const retryDelays = [60000, 300000, 900000, 1800000, 3600000];
const ALERT_UI_BROADCAST_MS = 250;

let window;
let miniWindow;
let taskbarWindow;
let taskbarDockTimer;
let taskbarHealthTimer;
let sourceWindow;
let tray;
let worker;
let alertEngine;
let alertUiBroadcastTimer=null;
let normalizeRule;
let formatAlertMessage;
let quitting = false;
let exitReady = false;
let restarts = 0;
let seq = 0;
let moveTimer;
let windowBoundsTimer;
let adaptiveZoomTimer;
let queueTimer;
let queueBusy = false;
let aiScheduleTimer;
let aiRunBusy = false;
const activeNotifications = new Set();
const lastAlertQuoteTimes = new Map();
let hasShownBackgroundNotice = false;
let renderCrashTimes = [];
let lastStatus = { status: 'connecting', message: '正在启动采集', quotes: [], count: 0, lastMessage: 0 };
const waiting = new Map();
function openSourceWindow(url, title='融通金官方数据') {
  if (sourceWindow && !sourceWindow.isDestroyed()) { sourceWindow.setTitle(`${title} · 盛世白银`);sourceWindow.webContents.setAudioMuted(true); sourceWindow.loadURL(url); sourceWindow.show(); sourceWindow.focus(); return true; }
  sourceWindow = new BrowserWindow({ width: 1240, height: 840, minWidth: 820, minHeight: 600, show:false,title: `${title} · 盛世白银`, icon: windowIconPath, parent: window, autoHideMenuBar: true, backgroundColor:'#090f12', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  sourceWindow.webContents.setAudioMuted(true);
  sourceWindow.webContents.setWindowOpenHandler(({url: next}) => { if (isTrustedSourceUrl(next)) sourceWindow.loadURL(next); else if (/^https:\/\//i.test(next)) shell.openExternal(next); return { action: 'deny' }; });
  sourceWindow.webContents.on('will-navigate', (event, next) => { if (isTrustedSourceUrl(next)) return; event.preventDefault(); if (/^https:\/\//i.test(next)) shell.openExternal(next); });
  sourceWindow.webContents.on('did-start-loading',()=>sourceWindow?.setProgressBar(2));
  sourceWindow.webContents.on('did-stop-loading',()=>sourceWindow?.setProgressBar(-1));
  sourceWindow.webContents.on('did-fail-load',(_event,code,description)=>{sourceWindow?.setProgressBar(-1);sourceWindow?.setTitle(`加载失败：${description} · 盛世白银`);addSystemLog('外部页面','error',`${title}加载失败`,{code,description,url})});
  sourceWindow.once('ready-to-show',()=>sourceWindow?.show());
  sourceWindow.on('closed', () => { sourceWindow = null; });
  sourceWindow.loadURL(url); return true;
}

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const nowText = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const atomicWrite = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  if (fs.existsSync(file)) { try { fs.copyFileSync(file, `${file}.bak`); } catch {} }
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flush: true });
  fs.renameSync(temporary, file);
};
function readJson(file, fallback) {
  for (const candidate of [file, `${file}.bak`]) {
    try { return JSON.parse(fs.readFileSync(candidate, 'utf8')); } catch {}
  }
  return fallback();
}

const settingsPath = () => path.join(app.getPath('userData'), 'mail-settings.json');
const defaultMailSettings = () => ({
  enabled: false,
  fromName: '盛世白银预警哨兵',
  user: '',
  host: 'smtp.163.com',
  port: 465,
  password: '',
  recipients: [],
  logs: [],
  connection: { status: 'untested', time: 0, message: '尚未测试' },
});
function readSettings() {
  return { ...defaultMailSettings(), ...readJson(settingsPath(), defaultMailSettings) };
}
const writeSettings = value => atomicWrite(settingsPath(), value);
function encryptSecret(value) {
  if (!safeStorage.isEncryptionAvailable()) throw Error('当前系统无法安全保存邮箱授权码');
  return safeStorage.encryptString(value).toString('base64');
}
function decryptSecret(value, label = '密钥') {
  if (!value) return '';
  try { return safeStorage.decryptString(Buffer.from(value, 'base64')); }
  catch { throw Error(`${label}无法读取，请重新填写`); }
}
function publicSettings() {
  const value = readSettings();
  let password = '', secretError = '';
  try { password = value.password ? decryptSecret(value.password, '邮箱授权码') : ''; } catch (error) { secretError = error.message; }
  const rules = readAlertStore().rules;
  return {
    enabled: !!value.enabled,
    fromName: value.fromName,
    user: value.user,
    host: value.host,
    port: value.port,
    hasPassword: !!password,
    recipients: (Array.isArray(value.recipients) ? value.recipients : []).map(item => ({ ...item, usageCount: rules.filter(rule => Array.isArray(rule.recipientIds) && rule.recipientIds.includes(item.id)).length })),
    logs: Array.isArray(value.logs) ? value.logs.slice(0, 50) : [],
    connection: secretError ? { status: 'failed', time: Date.now(), message: secretError } : value.connection || defaultMailSettings().connection,
  };
}
function mailConfig(value = readSettings(), recipients = null) {
  const selected = recipients || (value.recipients || []).filter(item => item.enabled !== false);
  return {
    enabled: true,
    fromName: value.fromName,
    user: value.user,
    host: value.host,
    port: Number(value.port),
    password: decryptSecret(value.password, '邮箱授权码'),
    to: selected.map(item => item.email),
  };
}
function addMailLog(entry) {
  const value = readSettings();
  value.logs = [{ id: randomUUID(), time: Date.now(), ...entry }, ...(value.logs || [])].slice(0, 150);
  writeSettings(value);
  broadcast('mail-settings-changed', publicSettings());
}

const appSettingsPath = () => path.join(app.getPath('userData'), 'app-settings.json');
const defaultAppSettings = () => ({
  schemaVersion: 6,
  miniEnabled: false,
  miniAlwaysOnTop: true,
  miniPosition: 'top-right',
  rememberMiniPosition: true,
  startAtLogin: false,
  miniBounds: null,
  miniBoundsByDensity: {},
  uiScale: 1,
  autoScale: true,
  miniOpacity: 0.9,
  miniDensity: 'standard',
  miniCustomText: '盛世白银',
  miniClickThrough: false,
  miniTaskbarMode: false,
  soundEnabled: true,
  soundName: 'chime',
  soundRepeat: 1,
  desktopNotifications: true,
  speechEnabled: true,
  soundVolume: 180,
  speechVolume: 100,
  quietStart: '',
  quietEnd: '',
  windowBounds: null,
  windowMaximized: false,
});
function readAppSettings() {
  const value = { ...defaultAppSettings(), ...readJson(appSettingsPath(), defaultAppSettings) };
  value.uiScale = clampUiScale(value.uiScale);
  value.quietStart = isValidClockTime(value.quietStart) ? value.quietStart : '';
  value.quietEnd = isValidClockTime(value.quietEnd) ? value.quietEnd : '';
  return value;
}
const writeAppSettings = value => atomicWrite(appSettingsPath(), value);
const operationLogPath = () => path.join(app.getPath('userData'), 'operation-log.json');
const systemLogPath = () => path.join(app.getPath('userData'), 'system-log.json');
const safeSnapshot = value => JSON.parse(JSON.stringify(value, (key, item) => ['password','apiKey','text'].includes(key) ? undefined : item));
function readOperationLogs(){return readJson(operationLogPath(),()=>[])}
function readSystemLogs(){return readJson(systemLogPath(),()=>[])}
function addSystemLog(module,level,message,details={}){const rows=readSystemLogs(),last=rows[0];if(last&&last.module===module&&last.level===level&&last.message===message&&Date.now()-last.time<30000){last.count=Number(last.count||1)+1;last.time=Date.now()}else rows.unshift({id:randomUUID(),time:Date.now(),module,level,message,details:safeSnapshot(details),count:1});atomicWrite(systemLogPath(),rows.slice(0,500))}
function addOperationLog(module,action,before,after,restoreType=''){const rows=readOperationLogs();rows.unshift({id:randomUUID(),time:Date.now(),module,action,before:safeSnapshot(before),after:safeSnapshot(after),restoreType});atomicWrite(operationLogPath(),rows.slice(0,500));}

const aiSettingsPath = () => path.join(app.getPath('userData'), 'ai-settings.json');
const defaultAiSettings = () => ({ enabled: false, autoAnalyze: true, autoTimes: ['09:30','15:30'], lastAutoSlot: '', autoSlots: {}, apiKey: '', model: 'deepseek-v4-flash', resultsByMarket: {}, historyByMarket: {}, lastResult: null, lastError: '', lastRunAt: 0 });
function readAiSettings() {
  const value = { ...defaultAiSettings(), ...readJson(aiSettingsPath(), defaultAiSettings) };
  const times = Array.isArray(value.autoTimes) ? value.autoTimes.filter(isValidClockTime) : [];
  value.autoTimes = times.length === 2 && times[0] !== times[1] ? times.sort() : ['09:30','15:30'];
  const slots = value.autoSlots && typeof value.autoSlots === 'object' && !Array.isArray(value.autoSlots) ? Object.entries(value.autoSlots) : [];
  value.autoSlots = Object.fromEntries(slots.sort((a,b)=>String(b[0]).localeCompare(String(a[0]))).slice(0,120));
  const histories = value.historyByMarket && typeof value.historyByMarket === 'object' && !Array.isArray(value.historyByMarket) ? value.historyByMarket : {};
  value.historyByMarket = Object.fromEntries(Object.entries(histories).map(([code,rows])=>[code,Array.isArray(rows)?rows.slice(0,50):[]]));
  return value;
}
const writeAiSettings = value => atomicWrite(aiSettingsPath(), value);
function publicAiSettings() {
  const value = readAiSettings();
  let apiKey = '', secretError = '';
  try { apiKey = value.apiKey ? decryptSecret(value.apiKey, 'DeepSeek API Key') : ''; } catch (error) { secretError = error.message; }
  return { enabled: !!value.enabled, autoAnalyze: value.autoAnalyze !== false, autoTimes: Array.isArray(value.autoTimes)?value.autoTimes:['09:30','15:30'], autoSlots: value.autoSlots || {}, apiKey: '', hasApiKey: !!apiKey, keyTail: apiKey ? apiKey.slice(-4) : '', model: value.model, resultsByMarket: value.resultsByMarket || {}, historyByMarket: value.historyByMarket || {}, lastResult: value.lastResult || null, lastError: secretError || value.lastError || '', lastRunAt: value.lastRunAt || 0 };
}

const alertPath = () => path.join(app.getPath('userData'), 'alert-settings.json');
const defaultAlertStore = () => ({ rules: [], states: {}, events: [], queue: [] });
function readAlertStore() {
  try {
    const value = readJson(alertPath(), defaultAlertStore);
    return {
      rules: Array.isArray(value.rules) ? value.rules : [],
      states: value.states && typeof value.states === 'object' ? value.states : {},
      events: Array.isArray(value.events) ? value.events : [],
      queue: Array.isArray(value.queue) ? value.queue : [],
    };
  } catch { return defaultAlertStore(); }
}
const writeAlertStore = value => atomicWrite(alertPath(), value);
function publicAlerts() {
  const stored = readAlertStore();
  const settings = readSettings();
  const recipients = Array.isArray(settings.recipients) ? settings.recipients : [];
  const rules = (alertEngine ? alertEngine.publicRules() : stored.rules).map(rule => {
    if (!rule.notifyEmail) return { ...rule, delivery: { status: 'local', message: '使用本地提醒' } };
    const selected = recipientsForIds(settings, rule.recipientIds);
    if (!settings.enabled) return { ...rule, delivery: { status: 'warning', message: '邮件提醒已暂停' } };
    if (!selected.length) return { ...rule, delivery: { status: 'error', message: '没有有效收件人' } };
    if (settings.connection?.status !== 'success') return { ...rule, delivery: { status: 'warning', message: '邮箱连接未验证' } };
    return { ...rule, delivery: { status: 'ready', message: `邮件就绪 · ${selected.length}位收件人` } };
  });
  return {
    rules,
    events: stored.events.slice(0, 100),
    queue: stored.queue.slice(0, 100).map(item => ({ ...item, text: undefined })),
  };
}
function persistEngineState() {
  if (!alertEngine) return;
  const stored = readAlertStore();
  stored.rules = alertEngine.rules;
  stored.states = alertEngine.snapshotStates();
  writeAlertStore(stored);
}

const senderRole = event => event.sender === window?.webContents && event.senderFrame?.url.startsWith(pathToFileURL(html).href) ? 'main'
  : event.sender === miniWindow?.webContents && event.senderFrame?.url.startsWith(pathToFileURL(miniHtml).href) ? 'mini'
  : event.sender === taskbarWindow?.webContents && event.senderFrame?.url.startsWith(pathToFileURL(taskbarHtml).href) ? 'taskbar' : '';
const broadcast = (channel, value) => {
  for (const target of [window, miniWindow, taskbarWindow]) {
    if (target && !target.isDestroyed()) target.webContents.send(channel, value);
  }
};
const broadcastVisible = (channel, value) => {
  for (const target of [window, miniWindow, taskbarWindow]) {
    if (target && !target.isDestroyed() && target.isVisible()) target.webContents.send(channel, value);
  }
};
function register(name, fn, roles = ['main']) {
  ipcMain.handle(name, async (event, args) => {
    if (!roles.includes(senderRole(event))) throw Error('请求来源无效');
    return fn(args, event);
  });
}
function showWindow() {
  if (!window) return;
  window.show();
  window.focus();
}
function showMainPanel(panel='market'){showWindow();if(window&&!window.isDestroyed())window.webContents.send('navigate-panel',panel)}
function applyMainZoom() {
  if (!window || window.isDestroyed()) return;
  const saved = readAppSettings();
  const effective = saved.autoScale === false ? clampUiScale(saved.uiScale) : 1;
  if (Math.abs(window.webContents.getZoomFactor() - effective) < 0.001) return;
  window.webContents.setZoomFactor(effective);
  setTimeout(() => window?.webContents.executeJavaScript("window.dispatchEvent(new Event('resize'))").catch(() => {}), 50);
}

function visibleMiniBounds(bounds) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
  return screen.getAllDisplays().some(display => {
    const area = display.workArea;
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    return overlapX >= 100 && overlapY >= 60;
  });
}
function visibleWindowBounds(bounds) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
  return screen.getAllDisplays().some(display => {
    const area = display.workArea;
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    return overlapX >= 320 && overlapY >= 240;
  });
}
function preferredDisplay() {
  if (window && !window.isDestroyed()) return screen.getDisplayMatching(window.getBounds());
  return screen.getPrimaryDisplay();
}
function positionMini(position, bounds) {
  if (!miniWindow) return;
  if (visibleMiniBounds(bounds)) {
    miniWindow.setPosition(bounds.x, bounds.y);
    return;
  }
  const area = preferredDisplay().workArea;
  const margin = 18;
  const size = miniWindow.getBounds();
  const x = position.endsWith('right') ? area.x + area.width - size.width - margin : area.x + margin;
  const y = position.startsWith('bottom') ? area.y + area.height - size.height - margin : area.y + margin;
  miniWindow.setPosition(x, y);
}
function resolvedTaskbarHostScript() {
  return app.isPackaged ? taskbarHostScript.replace('app.asar', 'app.asar.unpacked') : taskbarHostScript;
}
function nativeHandleNumber(target) {
  const value = target.getNativeWindowHandle();
  return process.arch === 'x64' ? value.readBigUInt64LE(0).toString() : String(value.readUInt32LE(0));
}
function fallbackTaskbarPlacement(reason = '') {
  if (!taskbarWindow || taskbarWindow.isDestroyed()) return;
  const display = preferredDisplay(), area = display.workArea, bounds = display.bounds;
  const bottom = Math.max(0, bounds.y + bounds.height - area.y - area.height);
  const top = Math.max(0, area.y - bounds.y);
  const height = Math.max(36, bottom || top || 40), width = Math.min(380, Math.max(310, Math.round(bounds.width * .2)));
  const x = Math.max(bounds.x, bounds.x + bounds.width - width - 260);
  const y = top > bottom ? bounds.y : bounds.y + bounds.height - height;
  taskbarWindow.setBounds({ x, y, width, height }, false);
  taskbarWindow.setAlwaysOnTop(true, 'screen-saver');
  taskbarWindow.showInactive();
  if (reason) addSystemLog('悬浮窗', 'warn', '任务栏原生承载失败，已启用可见回退位置', { reason });
}
function dockTaskbarWindow() {
  if (!taskbarWindow || taskbarWindow.isDestroyed() || process.platform !== 'win32') return;
  clearTimeout(taskbarDockTimer);
  taskbarDockTimer = setTimeout(() => {
    if (!taskbarWindow || taskbarWindow.isDestroyed()) return;
    const handle = nativeHandleNumber(taskbarWindow);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolvedTaskbarHostScript(), '-ChildHandle', handle, '-PreferredWidth', '360'], { windowsHide: true, timeout: 8000 }, (error, stdout, stderr) => {
      if (!taskbarWindow || taskbarWindow.isDestroyed()) return;
      if (error) return fallbackTaskbarPlacement(clean(stderr || error.message, 300));
      try {
        const result = JSON.parse(String(stdout).trim());
        if (!result.ok) throw Error('Windows未确认任务栏承载');
        taskbarWindow.showInactive();
      } catch (parseError) { fallbackTaskbarPlacement(parseError.message); }
    });
  }, 120);
}
function applyMiniSettings(value = readAppSettings(), reposition = false) {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  miniWindow.setAlwaysOnTop(value.miniAlwaysOnTop !== false, 'floating');
  miniWindow.setOpacity(Math.min(1, Math.max(.7, Number(value.miniOpacity) || .9)));
  miniWindow.setIgnoreMouseEvents(!!value.miniClickThrough, { forward: true });
  miniWindow.setSkipTaskbar(true);
  miniWindow.setFocusable(true);
  miniWindow.setVisibleOnAllWorkspaces(false);
  if(reposition)positionMini(value.miniPosition || 'top-right', value.rememberMiniPosition ? value.miniBoundsByDensity?.[value.miniDensity] || value.miniBounds : null);
}
function updateMiniPreference(patch, reposition = false) {
  const value = { ...readAppSettings(), ...patch };
  writeAppSettings(value);
  applyMiniSettings(value, reposition);
  syncFloatingWindows(value, reposition);
  broadcast('app-settings-changed', value);
  return value;
}
function showMiniContextMenu() {
  const value = readAppSettings();
  Menu.buildFromTemplate([
    { label: '打开主面板', click: () => showMainPanel('market') },
    { label: '查看预警规则', click: () => showMainPanel('alerts') },
    { label: '悬浮窗设置', click: () => showMainPanel('settings') },
    { type: 'separator' },
    { label: '始终置顶', type: 'checkbox', checked: value.miniAlwaysOnTop !== false, click: item => updateMiniPreference({ miniAlwaysOnTop: item.checked }) },
    { label: '鼠标穿透', type: 'checkbox', checked: !!value.miniClickThrough, click: item => updateMiniPreference({ miniClickThrough: item.checked }) },
    { label: '在任务栏显示实时价格', type: 'checkbox', checked: !!value.miniTaskbarMode, click: item => updateMiniPreference({ miniTaskbarMode: item.checked }, true) },
    { label: '显示密度', submenu: ['strip','compact','standard','expanded'].map(id => ({ label: ({strip:'超窄',compact:'紧凑',standard:'标准',expanded:'扩展'})[id], type: 'radio', checked: value.miniDensity === id, click: () => updateMiniPreference({ miniDensity: id, miniTaskbarMode: false }, true) })) },
    { label: '透明度', submenu: [70,80,90,100].map(percent => ({ label: `${percent}%`, type: 'radio', checked: Math.round((value.miniOpacity || .9) * 100) === percent, click: () => updateMiniPreference({ miniOpacity: percent / 100 }) })) },
    { label: '恢复推荐位置', click: () => updateMiniPreference({ miniBounds: null, miniBoundsByDensity: {}, miniTaskbarMode: false }, true) },
    { type: 'separator' },
    { label: '隐藏悬浮窗', click: () => { updateMiniPreference({ miniEnabled: false, miniClickThrough: false }); miniWindow?.hide(); } },
  ]).popup({ window: miniWindow });
}
function syncMiniEnabled(enabled) {
  const value = readAppSettings();
  value.miniEnabled = enabled;
  writeAppSettings(value);
  broadcast('app-settings-changed', value);
}
function createMiniWindow() {
  if (miniWindow) return miniWindow;
  const settings = readAppSettings();
  const densityBounds = settings.miniBoundsByDensity?.[settings.miniDensity];
  const savedCandidate = densityBounds || settings.miniBounds;
  const savedSize = savedCandidate && Number.isFinite(savedCandidate.width) && Number.isFinite(savedCandidate.height) ? savedCandidate : null;
  const strip = settings.miniDensity === 'strip';
  miniWindow = new BrowserWindow({
    width: Math.min(760, Math.max(240, savedSize?.width || (strip ? 500 : 320))), height: Math.min(260, Math.max(36, savedSize?.height || (strip ? 40 : 132))),
    minWidth: 240, minHeight: 36, maxWidth: 760, maxHeight: 260,
    show: false, frame: false, resizable: true, skipTaskbar: true,
    alwaysOnTop: settings.miniAlwaysOnTop !== false, backgroundColor: '#071522', icon: windowIconPath,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  miniWindow.setAlwaysOnTop(settings.miniAlwaysOnTop !== false, 'floating');
  miniWindow.setOpacity(Math.min(1, Math.max(0.7, Number(settings.miniOpacity) || 0.9)));
  miniWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  miniWindow.webContents.on('will-navigate', event => event.preventDefault());
  miniWindow.webContents.on('context-menu', showMiniContextMenu);
  miniWindow.loadFile(miniHtml, { query: demo || captureMode ? { demo: '1' } : undefined });
  miniWindow.once('ready-to-show', () => {
    applyMiniSettings(settings, true);
    if (settings.miniEnabled && !captureMode) miniWindow.showInactive();
  });
  const saveMiniBounds = () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const value = readAppSettings();
      if (value.rememberMiniPosition && !quitting) {
        const bounds = miniWindow.getBounds();
        value.miniBounds = bounds;
        value.miniBoundsByDensity = { ...(value.miniBoundsByDensity || {}), [value.miniDensity]: bounds };
        writeAppSettings(value);
      }
    }, 300);
  };
  miniWindow.on('move', saveMiniBounds);
  miniWindow.on('resize', saveMiniBounds);
  miniWindow.on('close', event => {
    if (!quitting) {
      event.preventDefault();
      miniWindow.hide();
      syncMiniEnabled(false);
    }
  });
  return miniWindow;
}
function showTaskbarContextMenu() {
  Menu.buildFromTemplate([
    { label: '打开主面板', click: () => showMainPanel('market') },
    { label: '查看预警规则', click: () => showMainPanel('alerts') },
    { label: '悬浮窗与任务栏设置', click: () => showMainPanel('settings') },
    { type: 'separator' },
    { label: '退出任务栏价格条', click: () => updateMiniPreference({ miniTaskbarMode: false }, true) },
    { label: '隐藏全部悬浮显示', click: () => updateMiniPreference({ miniEnabled: false, miniTaskbarMode: false, miniClickThrough: false }) },
  ]).popup({ window: taskbarWindow });
}
function createTaskbarWindow() {
  if (taskbarWindow && !taskbarWindow.isDestroyed()) return taskbarWindow;
  taskbarWindow = new BrowserWindow({
    width: 360, height: 40, minWidth: 300, minHeight: 30,
    show: false, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    type: 'toolbar', focusable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#151b1f',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  taskbarWindow.setMenuBarVisibility(false);
  taskbarWindow.setSkipTaskbar(true);
  taskbarWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  taskbarWindow.webContents.on('will-navigate', event => event.preventDefault());
  taskbarWindow.webContents.on('context-menu', showTaskbarContextMenu);
  taskbarWindow.loadFile(taskbarHtml, { query: demo || captureMode ? { demo: '1' } : undefined });
  taskbarWindow.once('ready-to-show', () => {
    dockTaskbarWindow();
  });
  taskbarWindow.on('closed', () => { taskbarWindow = null; });
  return taskbarWindow;
}
function syncFloatingWindows(value = readAppSettings(), reposition = false) {
  if (!value.miniEnabled) {
    clearInterval(taskbarHealthTimer); taskbarHealthTimer = null;
    miniWindow?.hide();
    taskbarWindow?.hide();
    return;
  }
  if (value.miniTaskbarMode) {
    miniWindow?.hide();
    createTaskbarWindow();
    dockTaskbarWindow();
    if (!taskbarHealthTimer) taskbarHealthTimer = setInterval(() => {
      const current = readAppSettings();
      if (current.miniEnabled && current.miniTaskbarMode) dockTaskbarWindow();
    }, 60000);
    return;
  }
  clearInterval(taskbarHealthTimer); taskbarHealthTimer = null;
  taskbarWindow?.hide();
  const mini = createMiniWindow();
  applyMiniSettings(value, reposition);
  const current = mini.getBounds();
  if (value.miniDensity === 'strip' && current.height > 48) mini.setSize(Math.max(380, current.width), 40);
  if (value.miniDensity !== 'strip' && current.height < 88) mini.setSize(Math.max(270, current.width), 105);
  if (!value.rememberMiniPosition || reposition) positionMini(value.miniPosition, value.rememberMiniPosition ? value.miniBoundsByDensity?.[value.miniDensity] || null : null);
  mini.showInactive();
}

function rpc(type, args = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const send = () => {
      if (!worker) {
        if (Date.now() - started >= 5000) return reject(Error('采集服务尚未就绪'));
        return setTimeout(send, 50);
      }
      const id = ++seq;
      const timer = setTimeout(() => { waiting.delete(id); reject(Error('读取超时，请稍后重试')); }, 15000);
      waiting.set(id, { resolve, reject, timer });
      worker.postMessage({ type, id, ...args });
    };
    send();
  });
}

async function runAiAnalysis(code='JZJ_ag', automatic=false) {
  if (aiRunBusy) throw Error('AI分析正在进行中');
  aiRunBusy = true;
  const startedAt=Date.now();broadcast('ai-analysis-progress',{stage:'market',message:'正在确认最新官方行情…',startedAt});
  const value=readAiSettings();
  if(!value.enabled) { aiRunBusy=false; throw Error('请先启用 AI 行情分析'); }
  try {
    const { analyzeMarket }=await import('./ai.mjs');
    const feed=await rpc('news',{limit:120});broadcast('ai-analysis-progress',{stage:'news',message:`已获取 ${feed.items?.length||0} 条实时资讯，正在筛选相关事件…`,startedAt});
    const quote=lastStatus?.quotes?.find(item=>item.code===code)||{},side=Number.isFinite(Number(quote.ask))?'ask':'bid';
    const periods=await Promise.all(['1','60','day'].map(period=>rpc('candles',{code,side,interval:period,size:period==='1'?120:90}).catch(()=>null)));
    const marketStructure=Object.fromEntries(['minute','hour','day'].map((label,index)=>{const rows=periods[index]?.candles||[],last=rows.at(-1),first=rows[0],high=rows.length?Math.max(...rows.map(x=>Number(x.high)||-Infinity)):null,low=rows.length?Math.min(...rows.map(x=>Number(x.low)||Infinity)):null;return[label,{count:rows.length,from:first?.time||null,to:last?.time||null,open:first?.open??null,close:last?.close??null,high:Number.isFinite(high)?high:null,low:Number.isFinite(low)?low:null,change:first&&last&&Number(first.open)?(Number(last.close)-Number(first.open))/Number(first.open)*100:null}] }));
    const previousResult=value.resultsByMarket?.[code]||null;
    broadcast('ai-analysis-progress',{stage:'analysis',message:'正在结合多周期行情结构与新增事件生成判断…',startedAt});const result=await analyzeMarket({apiKey:decryptSecret(value.apiKey,'DeepSeek API Key'),model:value.model},lastStatus,{code,news:feed.items,previousResult,marketStructure});result.lastCheckedAt=Date.now();result.analysisMs=Date.now()-startedAt;result.inputNewsCount=Number(feed.items?.length||0);
    value.resultsByMarket={...(value.resultsByMarket||{}),[code]:result};value.historyByMarket={...(value.historyByMarket||{}),[code]:[result,...(value.historyByMarket?.[code]||[]).filter(item=>item.id!==result.id&&item.generatedAt!==result.generatedAt)].slice(0,50)};value.lastResult=result;value.lastError='';value.lastRunAt=Date.now();
    if(automatic){value.lastAutoSlot=automatic;value.autoSlots={...(value.autoSlots||{}),[automatic]:{status:'success',completedAt:Date.now(),attempts:Number(value.autoSlots?.[automatic]?.attempts||0)+1}}}
    writeAiSettings(value);broadcast('ai-settings-changed',publicAiSettings());broadcast('ai-analysis-progress',{stage:'complete',message:`分析完成 · 用时 ${((Date.now()-startedAt)/1000).toFixed(1)}秒 · ${feed.items?.length||0}条资讯 · ${result.model||value.model}`,startedAt});return publicAiSettings();
  } catch(error) {
    value.lastError=clean(error.message,240);value.lastRunAt=Date.now();if(automatic)value.autoSlots={...(value.autoSlots||{}),[automatic]:{status:'failed',failedAt:Date.now(),attempts:Number(value.autoSlots?.[automatic]?.attempts||0)+1,lastError:value.lastError,nextRetryAt:Date.now()+5*60000}};writeAiSettings(value);broadcast('ai-settings-changed',publicAiSettings());throw error;
  } finally { aiRunBusy=false; }
}
function beijingScheduleParts(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()).reduce((o,p)=>(o[p.type]=p.value,o),{});return {day:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`}}
async function checkAiSchedule(){const value=readAiSettings();if(!value.enabled||value.autoAnalyze===false||!value.apiKey||aiRunBusy)return;const {day,time}=beijingScheduleParts(),times=(Array.isArray(value.autoTimes)?value.autoTimes:[]).filter(isValidClockTime).sort(),slots=times.filter(x=>x<=time).map(x=>`${day} ${x}`),now=Date.now();const slot=slots.find(key=>{const state=value.autoSlots?.[key];return state?.status!=='success'&&Number(state?.attempts||0)<4&&Number(state?.nextRetryAt||0)<=now});if(!slot)return;try{await runAiAnalysis('JZJ_ag',slot)}catch(error){console.error('Automatic AI analysis failed:',error.message)}}

function recipientsForIds(settings, ids) {
  const enabled = (settings.recipients || []).filter(item => item.enabled !== false);
  if (!Array.isArray(ids) || !ids.length) return enabled;
  const wanted = new Set(ids);
  return enabled.filter(item => wanted.has(item.id));
}
function fireLocalNotifications(event) {
  const settings = readAppSettings();
  const delivered = [];
  if (event.notifyDesktop && settings.desktopNotifications !== false && Notification.isSupported()) {
    try {
      const notice = new Notification({ title: `${event.marketName || '融通金行情'}预警 · ${event.ruleName}`, body: `${event.description}\n当前价格 ${Number(event.price).toFixed(3)} 元/克`, icon: iconPath, silent: true });
      activeNotifications.add(notice);
      notice.on('click', showWindow);
      notice.on('close', () => activeNotifications.delete(notice));
      notice.show();
      delivered.push('系统通知');
    } catch {}
  }
  if (event.notifySound && settings.soundEnabled !== false) {
    const repeats = Math.min(3, Math.max(1, Number(settings.soundRepeat) || 1));
    const ruleVolume=Number(event.soundVolume ?? 100),globalVolume=Number(settings.soundVolume ?? 100),volume=Math.min(300,Math.max(0,ruleVolume*globalVolume/100));
    broadcast('play-alert-sound', { name: event.soundName || settings.soundName || 'chime', volume, repeats });
    delivered.push(`声音${repeats > 1 ? `×${repeats}` : ''}`);
  }
  if (event.notifySpeech && settings.speechEnabled !== false) {
    const speech = clean(event.speechText || `${event.ruleName}，当前价格${Number(event.price).toFixed(3)}元每克`, 300);
    broadcast('speak-alert', { text: speech, volume: Number(settings.speechVolume ?? 100) });
    delivered.push('语音播报');
  }
  return delivered;
}
function queueAlert(event) {
  const mail = readSettings();
  const recipients = recipientsForIds(mail, event.recipientIds);
  const localDelivered = fireLocalNotifications(event);
  const wantsEmail = event.notifyEmail !== false;
  const emailReady = wantsEmail && mail.enabled && recipients.length;
  const stored = readAlertStore();
  const record = {
    id: event.id,
    ruleId: event.ruleId,
    ruleName: event.ruleName,
    description: event.description,
    price: event.price,
    time: event.time,
    status: emailReady ? 'pending' : localDelivered.length ? 'local' : 'skipped',
    recipients: recipients.map(item => item.name || item.email),
    channels: localDelivered,
    snapshot: {
      marketStatus: lastStatus?.market || lastStatus?.status || '未知',
      bid: lastStatus?.quotes?.find(item => item.code === event.marketCode)?.bid,
      ask: lastStatus?.quotes?.find(item => item.code === event.marketCode)?.ask,
      high: lastStatus?.quotes?.find(item => item.code === event.marketCode)?.askHigh,
      low: lastStatus?.quotes?.find(item => item.code === event.marketCode)?.askLow,
      sourceTime: event.sourceTime || 0,
    },
    message: emailReady ? `等待发送${localDelivered.length ? `，已${localDelivered.join('、')}提醒` : ''}`
      : localDelivered.length ? `已${localDelivered.join('、')}提醒`
        : !wantsEmail ? '本地提醒已关闭' : !mail.enabled ? '邮件提醒已暂停' : '没有可用收件人',
  };
  stored.events = [record, ...stored.events].slice(0, 300);
  if (emailReady) {
    stored.queue.push({
      id: randomUUID(), eventId: event.id, ruleId: event.ruleId,
      recipientIds: recipients.map(item => item.id), recipients: record.recipients,
      subject: clean(event.emailSubject, 160) || `${event.marketName || '融通金行情'}预警 · ${event.ruleName}`,
      text: formatAlertMessage(event), attempts: 0, nextAttemptAt: Date.now(), status: 'pending', createdAt: Date.now(),
    });
  }
  stored.states = alertEngine.snapshotStates();
  stored.rules = alertEngine.rules;
  writeAlertStore(stored);
  broadcast('alerts-changed', publicAlerts());
  processMailQueue();
}
async function processMailQueue() {
  if (queueBusy) return;
  queueBusy = true;
  clearTimeout(queueTimer);
  let nextDelay = null;
  try {
    const stored = readAlertStore();
    const job = stored.queue.find(item => item.status === 'pending' && Number(item.nextAttemptAt) <= Date.now());
    if (!job) {
      const next = stored.queue.filter(item => item.status === 'pending').sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
      if (next) nextDelay = Math.max(1000, Math.min(60000, next.nextAttemptAt - Date.now()));
      return;
    }
    const settings = readSettings();
    if (!settings.enabled) {
      nextDelay = 60000;
      return;
    }
    const recipients = recipientsForIds(settings, job.recipientIds);
    let outcome;
    try {
      if (!recipients.length) throw Error('没有可用收件人');
      const { sendAlert } = await import('./mail.mjs');
      const results = await sendAlert(mailConfig(settings, recipients), { subject: job.subject, text: job.text });
      outcome = { success: true, completedAt: Date.now(), results };
    } catch (error) {
      outcome = { success: false, error: clean(error.message, 300), results: Array.isArray(error.results) ? error.results : [] };
    }
    // Sending can take several seconds. Reload before committing so a quote that
    // arrives during SMTP delivery cannot be overwritten by this older snapshot.
    const latest = readAlertStore();
    const latestJob = latest.queue.find(item => item.id === job.id);
    const latestEvent = latest.events.find(item => item.id === job.eventId);
    if (latestJob && outcome.success) {
      latestJob.status = 'success';
      latestJob.completedAt = outcome.completedAt;
      if (latestEvent) Object.assign(latestEvent, { status: 'success', message: '发送成功', completedAt: outcome.completedAt });
      addMailLog({ status: 'success', recipients: job.recipients, message: `预警已发送：${latestEvent?.ruleName || job.subject}` });
      if (latestEvent) latestEvent.deliveryResults = outcome.results;
    } else if (latestJob) {
      const failedEmails = new Set(outcome.results.filter(item => !item.success).map(item => item.recipient));
      const succeeded = outcome.results.filter(item => item.success);
      if (failedEmails.size) {
        const remaining = recipients.filter(item => failedEmails.has(item.email));
        latestJob.recipientIds = remaining.map(item => item.id);
        latestJob.recipients = remaining.map(item => item.name || item.email);
      }
      latestJob.attempts = Number(latestJob.attempts || 0) + 1;
      latestJob.lastError = outcome.error;
      const terminal = !recipients.length || latestJob.attempts >= retryDelays.length;
      latestJob.status = terminal ? 'failed' : 'pending';
      latestJob.nextAttemptAt = terminal ? 0 : Date.now() + retryDelays[latestJob.attempts - 1];
      if (latestEvent) Object.assign(latestEvent, { status: terminal ? 'failed' : 'retrying', deliveryResults: [...(latestEvent.deliveryResults || []), ...outcome.results], message: terminal ? `发送失败：${latestJob.lastError}` : `${succeeded.length ? `已有 ${succeeded.length} 位发送成功；` : ''}失败地址将自动重试（${latestJob.attempts}/${retryDelays.length}）` });
      addMailLog({ status: terminal ? 'failed' : 'retrying', recipients: job.recipients, message: terminal ? `预警发送失败：${latestJob.lastError}` : `预警发送失败，已安排重试：${latestJob.lastError}` });
    }
    latest.queue = latest.queue.slice(-300);
    writeAlertStore(latest);
    broadcast('alerts-changed', publicAlerts());
    nextDelay = 1500;
  } finally {
    queueBusy = false;
    if (nextDelay !== null) queueTimer = setTimeout(processMailQueue, nextDelay);
  }
}

function processSnapshot(data) {
  if (!alertEngine) return;
  let stateOnlyChanged = false, liveEvaluationChanged=false;
  for (const quote of data.quotes || []) {
  if (!quote?.code || !quote.available) continue;
  const time = Date.now();
  const bidTime = Number(quote.bidTime || 0), askTime = Number(quote.askTime || 0);
  const sideFresh = { bid: bidTime > 0 && time - bidTime <= 50000, ask: askTime > 0 && time - askTime <= 50000 };
  const stale = data.status !== 'connected' || (!sideFresh.bid && !sideFresh.ask);
  const alertQuote = { code: quote.code, time, bidSourceTime: Number(quote.bidSourceTime || bidTime), askSourceTime: Number(quote.askSourceTime || askTime), session: data.session };
  const bidKey=`${quote.code}/bid`,askKey=`${quote.code}/ask`,bidChanged=bidTime>0&&lastAlertQuoteTimes.get(bidKey)!==bidTime,askChanged=askTime>0&&lastAlertQuoteTimes.get(askKey)!==askTime;
  if (bidChanged && quote.bid !== null && quote.bid !== undefined && Number.isFinite(Number(quote.bid))) { alertQuote.bid = Number(quote.bid); lastAlertQuoteTimes.set(bidKey,bidTime); }
  if (askChanged && quote.ask !== null && quote.ask !== undefined && Number.isFinite(Number(quote.ask))) { alertQuote.ask = Number(quote.ask); lastAlertQuoteTimes.set(askKey,askTime); }
  if (!bidChanged && !askChanged) continue;
  liveEvaluationChanged=true;
  const result = alertEngine.pushQuote(alertQuote, {
    code: quote.code, connected: data.status === 'connected', stale, sideFresh,
    preClose: { bid: Number(quote.bidPreClose), ask: Number(quote.askPreClose) },
    high: { bid: Number(quote.bidHigh), ask: Number(quote.askHigh) }, low: { bid: Number(quote.bidLow), ask: Number(quote.askLow) },
    quoteSkewMs: Math.abs(bidTime - askTime),
    spread: Number.isFinite(Number(quote.ask)) && Number.isFinite(Number(quote.bid)) && Number(quote.ask) >= Number(quote.bid) ? Number(quote.ask) - Number(quote.bid) : NaN,
  });
  if (result.stateChanged && !result.events.length) { persistEngineState(); stateOnlyChanged = true; }
  for (const event of result.events) { addSystemLog('预警','info',`规则命中：${event.ruleName}`,{sourceTime:event.sourceTime,judgedAt:Date.now(),ruleId:event.ruleId,marketCode:event.marketCode,side:event.side}); queueAlert(event); }
  }
  if (liveEvaluationChanged&&!alertUiBroadcastTimer)alertUiBroadcastTimer=setTimeout(()=>{alertUiBroadcastTimer=null;broadcastVisible('alerts-changed',publicAlerts())},ALERT_UI_BROADCAST_MS);
  else if (stateOnlyChanged) broadcast('alerts-changed', publicAlerts());
}

function launchWorker() {
  addSystemLog('启动','info','行情采集进程启动');
  worker = utilityProcess.fork(path.join(__dirname, 'worker.mjs'), [path.join(app.getPath('userData'), 'prices')], {
    serviceName: 'Silver price collector', stdio: 'pipe',
  });
  worker.on('message', message => {
    if (message.type === 'snapshot') {
      const previousStatus=lastStatus.status;
      lastStatus = message.data;
      if(previousStatus!==message.data.status)addSystemLog('行情',message.data.status==='connected'?'info':'warning',message.data.message||message.data.status,{from:previousStatus,to:message.data.status});
      if (message.data.status === 'connected') restarts = 0;
      if (tray) tray.setToolTip(`盛世白银 · ${message.data.message}`);
      broadcastVisible('status-changed', { ...lastStatus, version: app.getVersion() });
      processSnapshot(message.data);
    }
    if (message.type === 'fatal') { addSystemLog('错误','error',message.message||'行情采集发生严重错误'); lastStatus = { ...lastStatus, status: 'error', message: message.message }; broadcastVisible('status-changed', { ...lastStatus, version: app.getVersion() }); }
    if (message.type === 'stopped') { exitReady = true; app.quit(); }
    if (message.type === 'reply') {
      const pending = waiting.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        waiting.delete(message.id);
        message.error ? pending.reject(Error(message.error)) : pending.resolve(message.data);
      }
    }
  });
  worker.on('exit', () => {
    worker = null;
    for (const pending of waiting.values()) {
      clearTimeout(pending.timer);
      pending.reject(Error('采集服务已停止'));
    }
    waiting.clear();
    if (quitting) { exitReady = true; app.quit(); return; }
    lastStatus = { ...lastStatus, status: 'error', message: '采集进程已停止，正在恢复' };
    addSystemLog('行情','error','采集进程已停止，正在恢复',{restart:restarts+1});
    broadcastVisible('status-changed', { ...lastStatus, version: app.getVersion() });
    if (restarts++ < 5) setTimeout(launchWorker, 3000);
    else lastStatus.message = '采集多次失败，请退出后重新打开软件';
  });
  worker.stderr.on('data', data => console.error(String(data)));
}

function registerIpc() {
  register('status', () => ({ ...lastStatus, version: app.getVersion() }), ['main', 'mini', 'taskbar']);
  register('candles', args => {
    if (!args || !/^[A-Za-z0-9_]+$/.test(String(args.code||'')) || !['bid', 'ask'].includes(args.side) || !chartIntervals.has(String(args.interval)) || !chartSizes.has(Number(args.size))) throw Error('查询参数无效');
    return rpc('candles', args);
  });
  register('news', args => rpc('news', { limit: Math.min(300, Math.max(1, Number(args?.limit) || 100)) }));
  register('reconnect', () => { worker?.postMessage({ type: 'reconnect' }); return true; });
  register('open-source', () => openSourceWindow(chartUrl,'融通金官方行情'));
  register('open-chart', () => openSourceWindow(chartUrl,'融通金官方行情'));
  register('open-news-source', () => openSourceWindow(newsUrl,'融通金资讯与分析'));
  register('open-data', () => shell.openPath(path.join(app.getPath('userData'), 'prices')));
  register('quit', () => app.quit());
  register('window-minimize', () => window.minimize());
  register('window-maximize', () => window.isMaximized() ? window.unmaximize() : window.maximize());
  register('window-close', () => window.close());
  register('show-main', args => { showMainPanel(clean(args?.panel||'market',20)); return true; }, ['mini', 'taskbar']);
  register('close-mini', () => { miniWindow?.hide(); syncMiniEnabled(false); return true; }, ['mini']);

  register('app-settings', () => readAppSettings(), ['main', 'mini']);
  register('display-info', () => {
    const bounds = window && !window.isDestroyed() ? window.getBounds() : null;
    const display = bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay();
    return { id: String(display.id), bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor, rotation: display.rotation, windowBounds: bounds };
  }, ['main']);
  register('operation-logs', () => readOperationLogs().map(({before,...item})=>item), ['main']);
  register('system-logs', () => readSystemLogs(), ['main']);
  register('log-system-event', args => { addSystemLog(clean(args?.module||'界面',20),clean(args?.level||'info',12),clean(args?.message||'界面事件',120),args?.details||{}); return true; }, ['main']);
  register('log-operation', args => {
    const module=clean(args?.module,60)||'页面布局',action=clean(args?.action,120)||'调整设置',restoreType=args?.restoreType==='client-layout'?'client-layout':'';
    addOperationLog(module,action,args?.before||{},args?.after||{},restoreType);
    return readOperationLogs().map(({before,...item})=>item);
  }, ['main']);
  register('restore-operation', args => {
    const entry=readOperationLogs().find(item=>item.id===args?.id);
    if(!entry||!entry.restoreType||!entry.before)throw Error('这条记录不能还原');
    if(entry.restoreType==='app'){
      const current=readAppSettings(),next={...current,...entry.before};writeAppSettings(next);applyMainZoom();broadcast('app-settings-changed',next);
    }else if(entry.restoreType==='alerts'){
      const current=readAlertStore(),next={...current,rules:Array.isArray(entry.before.rules)?entry.before.rules:current.rules};alertEngine.setRules(next.rules,next.states);writeAlertStore(next);broadcast('alerts-changed',publicAlerts());
    }else if(entry.restoreType==='ai'){
      const current=readAiSettings(),next={...current,...entry.before,apiKey:current.apiKey};writeAiSettings(next);broadcast('ai-settings-changed',publicAiSettings());
    }else if(entry.restoreType==='client-layout'){
      addOperationLog('页面布局','还原操作记录',entry.after,entry.before,'');
      return {ok:true,clientRestore:entry.before,logs:readOperationLogs().map(({before,...item})=>item)};
    }else throw Error('这条记录不能还原');
    addOperationLog('系统','还原操作记录',entry.after,entry.before,'');
    return {ok:true,logs:readOperationLogs().map(({before,...item})=>item)};
  }, ['main']);
  register('save-app-settings', args => {
    const value = readAppSettings(),before={...value};
    value.miniEnabled = !!args?.miniEnabled;
    value.miniAlwaysOnTop = args?.miniAlwaysOnTop !== false;
    value.rememberMiniPosition = args?.rememberMiniPosition !== false;
    value.startAtLogin = !!args?.startAtLogin;
    value.uiScale = clampUiScale(args?.uiScale);
    value.autoScale = args?.autoScale !== false;
    value.miniOpacity = Math.min(1, Math.max(0.7, Number(args?.miniOpacity) || 0.9));
    value.miniDensity = ['strip', 'compact', 'standard', 'expanded'].includes(args?.miniDensity) ? args.miniDensity : 'standard';
    value.miniCustomText = clean(args?.miniCustomText || '盛世白银', 30);
    if (Object.prototype.hasOwnProperty.call(args || {}, 'miniClickThrough')) value.miniClickThrough = !!args.miniClickThrough;
    if (Object.prototype.hasOwnProperty.call(args || {}, 'miniTaskbarMode')) value.miniTaskbarMode = !!args.miniTaskbarMode;
    value.soundEnabled = args?.soundEnabled !== false;
    value.soundName = ['gentle','chime','urgent'].includes(args?.soundName) ? args.soundName : 'chime';
    value.soundRepeat = [1, 2, 3].includes(Number(args?.soundRepeat)) ? Number(args.soundRepeat) : 1;
    value.desktopNotifications = args?.desktopNotifications !== false;
    value.speechEnabled = args?.speechEnabled !== false;
    value.soundVolume = Number.isFinite(Number(args?.soundVolume)) ? Math.min(300, Math.max(0, Number(args.soundVolume))) : 180;
    if (Object.prototype.hasOwnProperty.call(args || {}, 'speechVolume')) value.speechVolume = Math.min(100, Math.max(0, Number(args.speechVolume)));
    value.quietStart = isValidClockTime(args?.quietStart) ? args.quietStart : '';
    value.quietEnd = isValidClockTime(args?.quietEnd) ? args.quietEnd : '';
    value.miniPosition = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(args?.miniPosition) ? args.miniPosition : 'top-right';
    if (!value.rememberMiniPosition) { value.miniBounds = null; value.miniBoundsByDensity = {}; }
    writeAppSettings(value);
    addOperationLog('显示与系统','保存系统设置',before,value,'app');
    const startupPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    app.setLoginItemSettings({ openAtLogin: value.startAtLogin, path: startupPath, args: ['--background'] });
    applyMainZoom();
    syncFloatingWindows(value, !!args?.reposition || before.miniDensity !== value.miniDensity || before.miniTaskbarMode !== value.miniTaskbarMode);
    broadcast('app-settings-changed', value);
    return value;
  });
  register('test-sound', args => {
    const repeats = Math.min(3, Math.max(1, Number(args?.repeats) || 1));
    if (args?.speech) broadcast('speak-alert', { text: clean(args?.text || '盛世白银语音预警试听，当前音量设置已生效。', 120), volume: Number(args?.volume ?? 100) });
    else broadcast('play-alert-sound', { name: args?.name || 'chime', volume: Number(args?.volume ?? 120), repeats });
    return true;
  });
  register('audio-status', () => ({ available: !!window && !window.isDestroyed(), muted: !!window?.webContents?.isAudioMuted(), audible: !!window?.webContents?.isCurrentlyAudible() }));

  register('mail-settings', () => publicSettings());
  register('save-mail-settings', args => {
    const value = readSettings();
    const nextUser = clean(args?.user).toLowerCase();
    const nextHost = clean(args?.host).toLowerCase();
    const nextPort = Number(args?.port) === 587 ? 587 : 465;
    const connectionChanged = value.user !== nextUser || value.host !== nextHost || Number(value.port) !== nextPort || !!clean(args?.password);
    value.fromName = clean(args?.fromName) || '盛世白银预警哨兵';
    value.user = nextUser;
    value.host = nextHost;
    value.port = nextPort;
    if (clean(args?.password)) value.password = encryptSecret(clean(args.password));
    if (connectionChanged) value.connection = { status: 'untested', time: Date.now(), message: '连接信息已更新，请重新测试' };
    writeSettings(value);
    broadcast('mail-settings-changed', publicSettings());
    return publicSettings();
  });
  register('toggle-mail', async args => {
    const value = readSettings();
    if (args?.enabled) {
      const { validateMailbox } = await import('./mail.mjs');
      validateMailbox(mailConfig(value));
    }
    value.enabled = !!args?.enabled;
    writeSettings(value);
    broadcast('mail-settings-changed', publicSettings());
    if (value.enabled) processMailQueue();
    return publicSettings();
  });
  register('save-recipient', args => {
    const name = clean(args?.name);
    const email = clean(args?.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('请输入有效的收件邮箱');
    const value = readSettings();
    value.recipients = value.recipients || [];
    const duplicate = value.recipients.find(item => item.email.toLowerCase() === email && item.id !== args?.id);
    if (duplicate) throw Error('这个收件邮箱已经添加');
    const found = value.recipients.find(item => item.id === args?.id);
    if (found) Object.assign(found, { name: name || '未备注', email, enabled: args?.enabled !== false });
    else value.recipients.push({ id: randomUUID(), name: name || '未备注', email, enabled: true });
    writeSettings(value);
    broadcast('mail-settings-changed', publicSettings());
    return publicSettings();
  });
  register('toggle-recipient', args => {
    const value = readSettings();
    const found = (value.recipients || []).find(item => item.id === args?.id);
    if (!found) throw Error('找不到这个收件人');
    found.enabled = !!args?.enabled;
    writeSettings(value);
    broadcast('mail-settings-changed', publicSettings());
    return publicSettings();
  });
  register('delete-recipient', args => {
    const value = readSettings();
    value.recipients = (value.recipients || []).filter(item => item.id !== args?.id);
    writeSettings(value);
    broadcast('mail-settings-changed', publicSettings());
    return publicSettings();
  });
  register('test-mail-connection', async args => {
    const value = readSettings();
    const testUser = clean(args?.user).toLowerCase() || value.user;
    const testHost = clean(args?.host).toLowerCase() || value.host;
    const testPort = Number(args?.port) === 587 ? 587 : 465;
    const suppliedPassword = clean(args?.password, 300);
    const savedMatch = testUser === value.user && testHost === value.host && testPort === Number(value.port) && !suppliedPassword;
    try {
      const { verifyMailbox } = await import('./mail.mjs');
      const password = suppliedPassword || decryptSecret(value.password);
      await verifyMailbox({ enabled: true, fromName: clean(args?.fromName) || value.fromName, user: testUser, host: testHost, port: testPort, password, to: [] });
      const result = { status: 'success', time: Date.now(), message: savedMatch ? 'SMTP 连接成功' : '当前填写内容连接成功；保存后需再次确认' };
      if (savedMatch) { value.connection = result; writeSettings(value); broadcast('mail-settings-changed', publicSettings()); }
      return result;
    } catch (error) {
      if (savedMatch) {
        value.connection = { status: 'failed', time: Date.now(), message: clean(error.message, 200) || 'SMTP连接失败' };
        writeSettings(value); broadcast('mail-settings-changed', publicSettings());
      }
      throw error;
    }
  });
  register('send-test-mail', async () => {
    const value = readSettings();
    const recipients = (value.recipients || []).filter(item => item.enabled !== false);
    try {
      const { sendAlert } = await import('./mail.mjs');
      await sendAlert(mailConfig(value, recipients), {
        subject: '盛世白银 · 邮件通知测试',
        text: '这是一封测试邮件。收到此邮件，说明发件设置和收件人配置可以正常使用。',
      });
      addMailLog({ status: 'success', recipients: recipients.map(item => item.name || item.email), message: '测试邮件发送成功' });
      return publicSettings();
    } catch (error) {
      addMailLog({ status: 'failed', recipients: recipients.map(item => item.name || item.email), message: `测试邮件发送失败：${clean(error.message, 160)}` });
      throw error;
    }
  });

  register('alerts', () => publicAlerts(), ['main','mini']);
  register('save-alert-rule', args => {
    const stored = readAlertStore();
    const before=safeSnapshot({rules:stored.rules});
    const found = stored.rules.find(item => item.id === args?.id);
    const rule = normalizeRule(args, found || null);
    if (found) stored.rules[stored.rules.indexOf(found)] = rule;
    else stored.rules.push(rule);
    alertEngine.setRules(stored.rules, stored.states);
    stored.states = alertEngine.snapshotStates();
    writeAlertStore(stored);
    addOperationLog('预警规则',found?'修改预警规则':'新建预警规则',before,{rules:stored.rules},'alerts');
    broadcast('alerts-changed', publicAlerts());
    return publicAlerts();
  });
  register('toggle-alert-rule', args => {
    const stored = readAlertStore();
    const before=safeSnapshot({rules:stored.rules});
    const found = stored.rules.find(item => item.id === args?.id);
    if (!found) throw Error('找不到这条预警规则');
    found.enabled = !!args?.enabled;
    found.updatedAt = Date.now();
    if (!found.enabled) {
      const cancelled = new Set(stored.queue.filter(item => item.ruleId === found.id && item.status === 'pending').map(item => item.eventId));
      stored.queue = stored.queue.filter(item => !(item.ruleId === found.id && item.status === 'pending'));
      for (const event of stored.events) if (cancelled.has(event.id) && ['pending', 'retrying'].includes(event.status)) Object.assign(event, { status: 'skipped', message: '规则已暂停，待发邮件已取消' });
    }
    alertEngine.setRules(stored.rules, stored.states);
    stored.states = alertEngine.snapshotStates();
    writeAlertStore(stored);
    addOperationLog('预警规则',found.enabled?'启用预警规则':'暂停预警规则',before,{rules:stored.rules},'alerts');
    broadcast('alerts-changed', publicAlerts());
    return publicAlerts();
  });
  register('delete-alert-rule', args => {
    const stored = readAlertStore();
    const before=safeSnapshot({rules:stored.rules});
    const cancelled = new Set(stored.queue.filter(item => item.ruleId === args?.id && item.status === 'pending').map(item => item.eventId));
    stored.rules = stored.rules.filter(item => item.id !== args?.id);
    stored.queue = stored.queue.filter(item => !(item.ruleId === args?.id && item.status === 'pending'));
    for (const event of stored.events) if (cancelled.has(event.id) && ['pending', 'retrying'].includes(event.status)) Object.assign(event, { status: 'skipped', message: '规则已删除，待发邮件已取消' });
    delete stored.states[args?.id];
    alertEngine.setRules(stored.rules, stored.states);
    writeAlertStore(stored);
    addOperationLog('预警规则','删除预警规则',before,{rules:stored.rules},'alerts');
    broadcast('alerts-changed', publicAlerts());
    return publicAlerts();
  });
  register('clear-alert-events', () => {
    const stored = readAlertStore();
    const activeEventIds = new Set(stored.queue.filter(item => item.status === 'pending').map(item => item.eventId));
    stored.events = stored.events.filter(item => activeEventIds.has(item.id) || ['pending', 'retrying'].includes(item.status));
    stored.queue = stored.queue.filter(item => item.status === 'pending');
    writeAlertStore(stored);
    broadcast('alerts-changed', publicAlerts());
    return publicAlerts();
  });
  register('ai-settings', () => publicAiSettings());
  register('save-ai-settings', args => {
    const value = readAiSettings(),before=safeSnapshot(readAiSettings());
    value.enabled = !!args?.enabled;
    value.autoAnalyze = args?.autoAnalyze !== false;
    const requestedTimes = [args?.autoTime1,args?.autoTime2].map(x=>clean(x,5));
    if(!requestedTimes.every(isValidClockTime)) throw Error('请输入有效的自动分析时间');
    if(requestedTimes[0]===requestedTimes[1])throw Error('两次自动分析时间不能相同');
    value.autoTimes = requestedTimes.sort();
    value.model = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'].includes(args?.model) ? (args.model === 'deepseek-flash' ? 'deepseek-v4-flash' : args.model) : 'deepseek-v4-flash';
    if (clean(args?.apiKey, 300)) value.apiKey = encryptSecret(clean(args.apiKey, 300));
    writeAiSettings(value);
    addOperationLog('AI分析','保存AI分析设置',before,safeSnapshot(value),'ai');
    return publicAiSettings();
  });
  register('analyze-ai', async args => {
    return runAiAnalysis(clean(args?.code,80)||'JZJ_ag');
  });
  register('open-external', args => {
    const url = clean(args?.url, 600); let parsed; try { parsed = new URL(url); } catch { throw Error('链接无效'); }
    if (parsed.protocol !== 'https:') throw Error('只允许打开安全网页链接');
    shell.openExternal(parsed.href); return true;
  });
}

async function captureMain(file) {
  if (file.includes('chart-5s')) {
    await new Promise(resolve => setTimeout(resolve, 700));
    await window.webContents.executeJavaScript(`document.querySelector('#chart-period').value='5s';document.querySelector('#chart-period').dispatchEvent(new Event('change',{bubbles:true}))`);
  }
  if (file.includes('chart-bid')) {
    await new Promise(resolve => setTimeout(resolve, 700));
    await window.webContents.executeJavaScript(`document.querySelector('[data-chart-side="bid"]').click()`);
  }
  if (file.includes('ai-settings')) {
    await new Promise(resolve => setTimeout(resolve, 700));
    await window.webContents.executeJavaScript(`(() => { const key=document.getElementById('ai-key'); key.value='sk-demo-key-is-masked'; key.type='password'; const state=document.getElementById('ai-state'); state.className='notice bad'; state.innerHTML='<i class="ph ph-warning"></i><span>分析结果生成不完整，请重新分析</span>'; })()`);
  }
  if (file.includes('rule-multi')) {
    await new Promise(resolve => setTimeout(resolve, 700));
    await window.webContents.executeJavaScript(`(() => {
      document.getElementById('add-condition').click(); document.getElementById('add-condition').click();
      let rows = document.querySelectorAll('.condition-card');
      rows[0].querySelector('[data-field="kind"]').value = 'day_up_percent';
      rows[0].querySelector('[data-field="kind"]').dispatchEvent(new Event('change', {bubbles:true}));
      rows = document.querySelectorAll('.condition-card'); rows[0].querySelector('[data-field="threshold"]').value = '1.5';
      rows[1].querySelector('[data-field="side"]').value = 'bid'; rows[1].querySelector('[data-field="kind"]').value = 'level_above';
      rows[1].querySelector('[data-field="kind"]').dispatchEvent(new Event('change', {bubbles:true}));
      rows = document.querySelectorAll('.condition-card'); rows[1].querySelector('[data-field="threshold"]').value = '14.8';
      rows[2].querySelector('[data-field="side"]').value = 'ask'; rows[2].querySelector('[data-field="kind"]').value = 'move_down_amount';
      rows[2].querySelector('[data-field="kind"]').dispatchEvent(new Event('change', {bubbles:true}));
      rows = document.querySelectorAll('.condition-card'); rows[2].querySelector('[data-field="threshold"]').value = '0.2'; rows[2].querySelector('[data-field="windowValue"]').value = '5'; rows[2].querySelector('[data-field="windowUnit"]').value = '60';
    })()`);
  }
  await new Promise(resolve => setTimeout(resolve, file.includes('rule-multi') ? 5800 : liveCaptureFlag ? 15000 : 6500));
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    const layout = await window.webContents.executeJavaScript(`(() => { const dialog=document.getElementById('rule-dialog'); const form=document.getElementById('rule-form'); const cards=[...document.querySelectorAll('.condition-card')]; const origin=dialog?.getBoundingClientRect().left||0; const wide=dialog?[...dialog.querySelectorAll('*')].map(x=>{const r=x.getBoundingClientRect();return {tag:x.tagName,id:x.id,cls:x.className?.toString?.().slice(0,80)||'',left:Math.round(r.left-origin),right:Math.round(r.right-origin),width:Math.round(r.width),scrollWidth:x.scrollWidth}}).sort((a,b)=>b.right-a.right).slice(0,12):[]; return { viewport:[innerWidth,innerHeight], dialog:dialog?{clientWidth:dialog.clientWidth,scrollWidth:dialog.scrollWidth}:null, form:form?{clientWidth:form.clientWidth,scrollWidth:form.scrollWidth}:null, cards:cards.map(x=>({clientWidth:x.clientWidth,scrollWidth:x.scrollWidth})),wide }; })()`);
    fs.writeFileSync(target.replace(/\.png$/i, '.layout.json'), JSON.stringify(layout, null, 2));
    if (liveCaptureFlag) {
      const diagnostic = await window.webContents.executeJavaScript(`Promise.all([window.monitor.status(),window.monitor.news(5)]).then(([status,news])=>({status,news}))`);
      fs.writeFileSync(target.replace(/\.png$/i, '.data.json'), JSON.stringify(diagnostic, null, 2));
    }
    try {
      const mainImage = await window.webContents.capturePage();
      fs.writeFileSync(target, mainImage.toPNG());
    } catch {
      const bounds = window.getContentBounds();
      const pdf = await window.webContents.printToPDF({ printBackground: true, pageSize: { width: Math.round(bounds.width * 25400 / 96), height: Math.round(bounds.height * 25400 / 96) }, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      fs.writeFileSync(target.replace(/\.png$/i, '.pdf'), pdf);
    }
  } catch (error) {
    fs.writeFileSync(target.replace(/\.png$/i, '.capture-error.txt'), String(error?.stack || error));
  } finally {
    quitting = true;
    exitReady = true;
    app.quit();
  }
}

if (!captureMode && !smoke && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    const alertsModule = await import('./alerts.mjs');
    normalizeRule = alertsModule.normalizeRule;
    formatAlertMessage = alertsModule.formatAlertMessage;
    const storedAlerts = readAlertStore();
    alertEngine = new alertsModule.AlertEngine(storedAlerts.rules, storedAlerts.states);

    Menu.setApplicationMenu(null);
    const startupPrefs = readAppSettings();
    const savedWindow = visibleWindowBounds(startupPrefs.windowBounds) ? startupPrefs.windowBounds : null;
    const compactCapture = !!(captureFlag || liveCaptureFlag)?.includes('small');
    const largeCapture = !!(captureFlag || liveCaptureFlag)?.includes('1920');
    window = new BrowserWindow({
      width: compactCapture ? 980 : largeCapture ? 1920 : Math.max(760, savedWindow?.width || 1500), height: compactCapture ? 700 : largeCapture ? 1080 : Math.max(600, savedWindow?.height || 920),
      ...(savedWindow ? { x: savedWindow.x, y: savedWindow.y } : {}), minWidth: 760, minHeight: 600,
      title: '盛世白银·预警哨兵', backgroundColor: '#061321', show: !!captureFlag || (!smoke && !captureMode && !backgroundLaunch),
      frame: false, icon: windowIconPath,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('console-message', (_event, level, message, line, source) => {
      if (level >= 2) console.error(`Renderer: ${message} (${source}:${line})`);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      if (quitting || details.reason === 'clean-exit') return;
      const now = Date.now();
      renderCrashTimes = renderCrashTimes.filter(time => now - time < 60000);
      renderCrashTimes.push(now);
      addSystemLog('界面','error','渲染进程异常退出',{reason:details.reason,exitCode:details.exitCode,recentCrashes:renderCrashTimes.length});
      if (renderCrashTimes.length <= 3) window.webContents.reload();
      else dialog.showErrorBox('盛世白银界面反复异常', '界面在一分钟内连续异常退出。行情后台已停止自动重载，请退出软件后重新打开。');
    });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.on('did-finish-load', () => {
      applyMainZoom();
      setTimeout(() => window?.webContents.executeJavaScript("document.getElementById('startup-screen')?.remove()", true).catch(() => {}), 10000).unref();
    });
    window.webContents.on('before-input-event', (event, input) => {
      if (!input.control || input.type !== 'keyDown' || !['+', '=', '-', '0'].includes(input.key)) return;
      event.preventDefault();
      const settings = readAppSettings();
      settings.uiScale = input.key === '0' ? 1 : clampUiScale((Number(settings.uiScale) || 1) + (input.key === '-' ? -0.05 : 0.05)); settings.autoScale=false;
      writeAppSettings(settings);
      applyMainZoom();
      broadcast('app-settings-changed', settings);
    });
    const rememberWindow = () => {
      clearTimeout(adaptiveZoomTimer);
      adaptiveZoomTimer = setTimeout(applyMainZoom, 80);
      if (captureMode || smoke || quitting) return;
      clearTimeout(windowBoundsTimer);
      windowBoundsTimer = setTimeout(() => {
        const settings = readAppSettings();
        settings.windowMaximized = window.isMaximized();
        if (!window.isMaximized() && !window.isMinimized()) settings.windowBounds = window.getBounds();
        writeAppSettings(settings);
      }, 400);
    };
    window.on('resize', rememberWindow);
    window.on('move', rememberWindow);
    window.on('maximize', rememberWindow);
    window.on('unmaximize', rememberWindow);
    registerIpc();
    if (miniCaptureFlag) createMiniWindow();
    else if (startupPrefs.miniEnabled) syncFloatingWindows(startupPrefs, true);
    const redockTaskbar=()=>{const value=readAppSettings();if(value.miniTaskbarMode&&taskbarWindow&&!taskbarWindow.isDestroyed())dockTaskbarWindow()};
    screen.on('display-metrics-changed',redockTaskbar);screen.on('display-added',redockTaskbar);screen.on('display-removed',redockTaskbar);

    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 }));
    tray.setToolTip('盛世白银·预警哨兵');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开主面板', click: showWindow },
      { label: '显示迷你悬浮窗', click: () => updateMiniPreference({ miniEnabled: true, miniTaskbarMode: false }, true) },
      { label: '隐藏全部悬浮显示', click: () => updateMiniPreference({ miniEnabled: false, miniTaskbarMode: false, miniClickThrough: false }) },
      { label: '关闭悬浮窗鼠标穿透', click: () => updateMiniPreference({ miniClickThrough: false }) },
      { label: '切换任务栏实时价格', click: () => { const value=readAppSettings(); updateMiniPreference({ miniEnabled: true, miniTaskbarMode: !value.miniTaskbarMode }, true); } },
      { label: '重新连接行情', click: () => worker?.postMessage({ type: 'reconnect' }) },
      { type: 'separator' },
      { label: '退出并停止监控', click: () => app.quit() },
    ]));
    tray.on('double-click', showWindow);
    window.on('close', event => {
      if (!quitting) {
        event.preventDefault();
        window.hide();
        if (!hasShownBackgroundNotice && !smoke && !captureMode) {
          hasShownBackgroundNotice = true;
          tray.displayBalloon({ title: '盛世白银仍在运行', content: '行情采集、预警规则和迷你悬浮窗继续运行。', noSound: true });
        }
      }
    });

    const mainCaptureFlag = captureFlag || liveCaptureFlag;
    const capturePanel = mainCaptureFlag?.includes('ai-') ? 'analysis' : mainCaptureFlag?.includes('settings') ? 'settings' : mainCaptureFlag?.includes('rule') ? 'rule' : mainCaptureFlag?.includes('mail') ? 'mail' : mainCaptureFlag?.includes('logs') ? 'logs' : '';
    const query = demo || (captureMode && !liveCaptureFlag) ? { demo: '1', ...(capturePanel ? { panel: capturePanel } : {}) } : capturePanel ? { panel: capturePanel } : undefined;
    if (captureFlag || liveCaptureFlag) window.webContents.once('did-finish-load', () => captureMain((captureFlag || liveCaptureFlag).split('=').slice(1).join('=')));
    window.loadFile(html, { query });
    if (startupPrefs.windowMaximized && !captureMode && !smoke) window.once('ready-to-show', () => window.maximize());
    if (!demo && (!captureMode || liveCaptureFlag) && !smoke) {
      launchWorker();
      processMailQueue();
      clearInterval(aiScheduleTimer);
      aiScheduleTimer=setInterval(checkAiSchedule,60000);
      setTimeout(checkAiSchedule,12000).unref();
    }
    powerMonitor.on('resume', () => worker?.postMessage({ type: 'reconnect' }));

    if (miniCaptureFlag) miniWindow.webContents.once('did-finish-load', () => setTimeout(async () => {
      const target = path.resolve(miniCaptureFlag.slice(15));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        const image = await miniWindow.webContents.capturePage();
        fs.writeFileSync(target, image.toPNG());
      } catch {
        const bounds = miniWindow.getContentBounds();
        const pdf = await miniWindow.webContents.printToPDF({ printBackground: true, pageSize: { width: Math.round(bounds.width * 25400 / 96), height: Math.round(bounds.height * 25400 / 96) }, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
        fs.writeFileSync(target.replace(/\.png$/i, '.pdf'), pdf);
      }
      quitting = true;
      exitReady = true;
      app.quit();
    }, 1200));
    if (smoke) {
      launchWorker();
      const started = Date.now();
      const check = setInterval(async () => {
        if (lastStatus.count > 0 || Date.now() - started > 45000) {
          clearInterval(check);
          let candles = [];
          try { candles = await rpc('candles', { code: 'JZJ_ag', side: 'ask', hours: 1, interval: 5 }); } catch {}
          fs.writeFileSync(path.join(app.getPath('userData'), 'smoke-result.json'), JSON.stringify({ packaged: app.isPackaged, electron: process.versions.electron, status: lastStatus, candles, alertRules: alertEngine.rules.length }, null, 2));
          app.quit();
        }
      }, 1000);
    }
  }).catch(error => {
    dialog.showErrorBox('盛世白银启动失败', error.message);
    app.quit();
  });
  app.on('before-quit', event => {
    quitting = true;
    clearTimeout(queueTimer);
    if (!exitReady && worker) {
      event.preventDefault();
      worker.postMessage({ type: 'shutdown' });
      setTimeout(() => { exitReady = true; worker?.kill(); app.quit(); }, 5000).unref();
    }
  });
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
}



