// Mawaru as a desktop app: one window that loads the production build (dist/) from a private
// app:// scheme. The scheme is registered as secure, so WebCodecs (video export) works the same
// as on 127.0.0.1, and /local-models/ is served from a folder on disk, outside the app bundle.
//   npm run desktop        build + open the window
//   MAWARU_DEV_URL=http://127.0.0.1:5173 npx electron .   load the Vite dev server instead
const { app, BrowserWindow, Menu, protocol, net, shell, session } = require('electron');
const { join, normalize, sep } = require('node:path');
const { existsSync, mkdirSync, statSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const ORIGIN = 'app://mawaru';
const DEV_URL = process.env.MAWARU_DEV_URL;

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true },
}]);

// Where imported models live. They never ship inside the app: each machine brings its own.
// 1. $MAWARU_MODELS  2. ~/Library/Application Support/Mawaru/local-models  3. the repo's local-models/ (unpackaged runs)
function userModelsDir(){ return join(app.getPath('userData'), 'local-models'); }
function modelsDir(){
  const dirs = [process.env.MAWARU_MODELS, userModelsDir(), app.isPackaged ? null : join(ROOT, 'local-models')].filter(Boolean);
  return dirs.find(d => existsSync(join(d, 'manifest.json'))) ?? dirs.find(d => existsSync(d)) ?? null;
}

// Resolves a URL path inside base, refusing anything that escapes it
function resolveIn(base, path){
  const p = normalize(join(base, decodeURIComponent(path)));
  return p === base || p.startsWith(base + sep) ? p : null;
}

function serve(req){
  const { pathname } = new URL(req.url);
  let file;
  if (pathname.startsWith('/local-models/')) {
    const dir = modelsDir();
    file = dir && resolveIn(dir, pathname.slice('/local-models/'.length));
  } else {
    file = resolveIn(DIST, pathname === '/' ? 'index.html' : pathname.slice(1));
  }
  try { if (file && statSync(file).isFile()) return net.fetch(pathToFileURL(file).toString()); } catch {}
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

let win;
function createWindow(){
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640,
    title: 'Mawaru', backgroundColor: '#111114', show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // links to other sites open in the default browser, never inside the editor
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(DEV_URL ?? ORIGIN)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  win.on('closed', () => { win = null; });
  win.loadURL(DEV_URL ?? ORIGIN + '/');
}

// Runs a page button as if the user clicked it (user gesture, so the file picker may open)
const click = id => win?.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)})?.click()`, true);
// Undo/redo: text fields keep their own history; everywhere else it's the project history
const history = (dir) => win?.webContents.executeJavaScript(
  `document.activeElement?.matches?.('input, textarea') ? document.execCommand(${JSON.stringify(dir)}) : document.getElementById(${JSON.stringify(dir)})?.click()`, true);

function buildMenu(){
  const isMac = process.platform === 'darwin';
  // The page already handles ⌘S/⌘O/⌘Z itself (and calls preventDefault), so these accelerators
  // only fire from the menu bar or when the page leaves the key alone.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu', label: 'Mawaru' }] : []),
    { label: 'Archivo', submenu: [
      { label: 'Nuevo…', accelerator: 'CmdOrCtrl+N', click: () => click('newProj') },
      { label: 'Abrir…', accelerator: 'CmdOrCtrl+O', click: () => click('openProj') },
      { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: () => click('saveProj') },
      { type: 'separator' },
      { label: 'Mostrar carpeta de modelos', click: () => { mkdirSync(userModelsDir(), { recursive: true }); shell.openPath(userModelsDir()); } },
      { type: 'separator' },
      isMac ? { role: 'close', label: 'Cerrar ventana' } : { role: 'quit', label: 'Salir' },
    ] },
    { label: 'Edición', submenu: [
      { label: 'Deshacer', accelerator: 'CmdOrCtrl+Z', click: () => history('undo') },
      { label: 'Rehacer', accelerator: 'Shift+CmdOrCtrl+Z', click: () => history('redo') },
      { type: 'separator' },
      { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' },
      { role: 'selectAll', label: 'Seleccionar todo' },
    ] },
    { label: 'Visualización', submenu: [
      { role: 'reload', label: 'Recargar' },
      { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Pantalla completa' },
    ] },
    { role: 'windowMenu', label: 'Ventana' },
  ]));
}

// A second launch focuses the existing window instead of opening another app instance
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    protocol.handle('app', serve);
    // exports and saved projects: native "Save as" dialog, starting in Downloads
    session.defaultSession.on('will-download', (_e, item) => {
      item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), item.getFilename()) });
    });
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
