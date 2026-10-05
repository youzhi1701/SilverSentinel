const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.setPath('userData', path.join(__dirname, 'profile-tradingview'));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 970,
    height: 650,
    show: false,
    backgroundColor: '#071522',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  await window.loadFile(path.join(__dirname, 'tradingview-xagusd.html'));
  await new Promise(resolve => setTimeout(resolve, 12000));
  fs.writeFileSync(path.join(__dirname, '09-tradingview-1m.png'), (await window.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(__dirname, '08-tradingview-status.txt'), `URL=${window.webContents.getURL()}\nTITLE=${window.webContents.getTitle()}\n`);
  window.destroy();
  app.quit();
});
