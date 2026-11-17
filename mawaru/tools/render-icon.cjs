// Renders build/icon.svg to build/icon.png (1024×1024) with Electron, which electron-builder turns into the .icns.
//   npx electron tools/render-icon.cjs
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const dir = join(__dirname, '..', 'build');
app.dock?.hide();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false,
    useContentSize: true, webPreferences: { offscreen: true, zoomFactor: 1 } });
  const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise(r => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  writeFileSync(join(dir, 'icon.png'), img.resize({ width: 1024, height: 1024 }).toPNG());
  console.log('build/icon.png', img.getSize());
  app.quit();
});
