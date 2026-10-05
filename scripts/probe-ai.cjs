const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.setPath('userData', path.join(app.getPath('appData'), 'gold-monitor-desktop'));

app.whenReady().then(async () => {
  const output = path.resolve(process.argv.find(value => value.startsWith('--output='))?.slice(9) || 'qa/ai-live-smoke.json');
  try {
    const settingsPath = path.join(app.getPath('userData'), 'ai-settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const apiKey = safeStorage.decryptString(Buffer.from(settings.apiKey, 'base64'));
    const { analyzeSilver } = await import('../src/ai.mjs');
    const result = await analyzeSilver({ apiKey, model: settings.model }, { status: 'connecting', market: '未知', quotes: [] });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ ok: true, model: result.model, horizons: result.horizons.map(item => item.label), newsCount: result.news.length, summaryLength: result.summary.length }, null, 2));
  } catch (error) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
