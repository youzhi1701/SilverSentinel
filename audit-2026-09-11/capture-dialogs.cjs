const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(__dirname, 'profile-dialogs'));
app.disableHardwareAcceleration();

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    frame: false,
    backgroundColor: '#061321',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  await window.loadFile(path.join(root, 'src', 'index.html'), { query: { demo: '1' } });
  await wait(1200);

  await window.webContents.executeJavaScript("document.querySelector('[data-interval=\"1\"]').click(); document.querySelector('[data-hours=\"168\"]').click();");
  await wait(250);
  fs.writeFileSync(path.join(__dirname, '04-kline-controls.png'), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript("document.getElementById('mail-settings-button').click()");
  await wait(250);
  fs.writeFileSync(path.join(__dirname, '05-email-settings.png'), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript("document.getElementById('mail-dialog').close(); document.getElementById('add-recipient').click()");
  await wait(250);
  fs.writeFileSync(path.join(__dirname, '06-add-recipient.png'), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript("document.getElementById('recipient-dialog').close(); document.getElementById('mail-enabled').click()");
  await wait(250);
  fs.writeFileSync(path.join(__dirname, '07-mail-toggle-state.png'), (await window.webContents.capturePage()).toPNG());

  window.destroy();
  app.quit();
});
