// GA Election Night desktop shell (Electron). Loads the built web app from dist/ and gives it
// what a browser can't: access to IPTV hosts and the Georgia SOS results API, which don't send
// CORS headers, plus the bundled ffmpeg decoder for broadcast audio (AC-3) Chromium can't play.
const { app, BrowserWindow, ipcMain, session, shell, Menu, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const decoder = require('./decoder.cjs');
const installer = require('./installer.cjs');
const { cleanHeader, VLC_UA } = decoder;

const isDev = !app.isPackaged && process.env.GAEN_DEV_URL;
// Separate profile (data + single-instance lock) for testing next to an installed copy.
if (process.env.GAEN_PROFILE) app.setPath('userData', path.join(app.getPath('temp'), 'ga-election-' + process.env.GAEN_PROFILE));
let win;
const appContents = new Set();
const APP_INDEX = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;

/** Per-stream request headers from the playlist (User-Agent / Referer / Origin / Cookie). */
const byUrl = new Map();
const byOrigin = new Map();
const MAX_ENTRIES = 256;
const remember = (map, key, value) => {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
};
const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
const isSecret = (name) => /^(authorization|cookie)$/i.test(name);

function sanitizeHeaders(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw).slice(0, 32)) {
    const val = cleanHeader(v);
    if (val && /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(k) && !/^(host|content-length|connection|transfer-encoding|upgrade|te|keep-alive|proxy-.*)$/i.test(k)) out[k] = val;
  }
  return out;
}

ipcMain.handle('gaen:stream-headers', (e, url, headers) => {
  if (!appContents.has(e.sender.id) || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  const origin = originOf(url);
  if (!origin) return false;
  const h = sanitizeHeaders(headers);
  remember(byUrl, url, h);
  remember(byOrigin, origin, h);
  return true;
});

function setHeader(h, name, value) {
  for (const k of Object.keys(h)) if (k.toLowerCase() === name.toLowerCase()) delete h[k];
  h[name] = value;
}
const getHeader = (h, name) => Object.entries(h).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

const fromApp = (d) => d.webContentsId === undefined || appContents.has(d.webContentsId);
const STREAM_TYPES = new Set(['xhr', 'media', 'other']);

/** Permissive CORS for the app's own fetch/XHR/media requests; playlist headers on stream requests. */
function allowCrossOrigin() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    if (!fromApp(details) || !STREAM_TYPES.has(details.resourceType)) return cb({ requestHeaders: h });
    const origin = originOf(details.url);
    const registered = byUrl.get(details.url) ?? (origin ? byOrigin.get(origin) : undefined);
    if (registered) {
      for (const [k, v] of Object.entries(registered)) setHeader(h, k, v);
      // VLC's User-Agent unless the playlist set one: some providers block browser UAs.
      if (!Object.keys(registered).some((k) => /^user-agent$/i.test(k))) setHeader(h, 'User-Agent', VLC_UA);
      const o = getHeader(h, 'Origin');
      if (!Object.keys(registered).some((k) => /^origin$/i.test(k)) && (o === 'null' || /^file:/i.test(o ?? ''))) {
        for (const k of Object.keys(h)) if (/^origin$/i.test(k)) delete h[k];
      }
    }
    cb({ requestHeaders: h });
  });
  ses.webRequest.onBeforeRedirect((details) => {
    if (!fromApp(details) || !STREAM_TYPES.has(details.resourceType)) return;
    const from = byUrl.get(details.url) ?? byOrigin.get(originOf(details.url) ?? '');
    const to = originOf(details.redirectURL);
    if (!from || !to || byOrigin.has(to) || !/^https?:/i.test(to)) return;
    remember(byOrigin, to, Object.fromEntries(Object.entries(from).filter(([k]) => !isSecret(k))));
  });
  ses.webRequest.onHeadersReceived((details, cb) => {
    if (!fromApp(details) || !STREAM_TYPES.has(details.resourceType) || !/^https?:/i.test(details.url)) return cb({});
    const headers = {};
    for (const [k, v] of Object.entries(details.responseHeaders || {})) {
      if (!/^access-control-allow-(origin|headers|methods|credentials)$/i.test(k)) headers[k] = v;
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS'];
    headers['Access-Control-Expose-Headers'] = ['*'];
    if (details.method === 'OPTIONS') return cb({ responseHeaders: headers, statusLine: 'HTTP/1.1 200 OK' });
    cb({ responseHeaders: headers });
  });
}

function isAppUrl(url) {
  if (isDev) return url.startsWith(process.env.GAEN_DEV_URL);
  const bare = String(url).split('#')[0];
  return process.platform === 'win32' || process.platform === 'darwin' ? bare.toLowerCase() === APP_INDEX.toLowerCase() : bare === APP_INDEX;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0b0d12',
    title: 'GA Election Night',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  const id = win.webContents.id;
  appContents.add(id);
  win.on('closed', () => { appContents.delete(id); win = null; });
  if (isDev) win.loadURL(process.env.GAEN_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!isAppUrl(url)) e.preventDefault(); });
  win.webContents.on('will-redirect', (e, url, _inPlace, isMainFrame) => { if (isMainFrame !== false && !isAppUrl(url)) e.preventDefault(); });
}

ipcMain.handle('gaen:version', () => app.getVersion());
ipcMain.handle('gaen:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); return win?.isFullScreen() ?? false; });

// The playlist link (it usually carries the provider login) is kept encrypted with the OS keychain.
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');
const readSecrets = () => { try { return JSON.parse(fs.readFileSync(secretsFile(), 'utf8')); } catch { return {}; } };
const validName = (n) => typeof n === 'string' && /^[a-z0-9_-]{1,40}$/.test(n);
ipcMain.handle('gaen:secret-get', (e, name) => {
  if (!appContents.has(e.sender.id) || !validName(name)) return null;
  const enc = readSecrets()[name];
  if (!enc) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
});
ipcMain.handle('gaen:secret-set', (e, name, value) => {
  if (!appContents.has(e.sender.id) || !validName(name)) return false;
  const all = readSecrets();
  if (value == null || value === '') delete all[name];
  else {
    if (!safeStorage.isEncryptionAvailable() || typeof value !== 'string' || value.length > 8192) return false;
    all[name] = safeStorage.encryptString(value).toString('base64');
  }
  fs.writeFileSync(secretsFile(), JSON.stringify(all), { mode: 0o600 });
  return true;
});

const gotLock = app.requestSingleInstanceLock();
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  else if (app.isReady() && gotLock) createWindow();
});
app.setAppUserModelId('com.studiofarms.gaelection');
app.whenReady().then(async () => {
  if (await installer.handleStartup({ hasLock: gotLock })) return app.quit();
  if (!gotLock) return app.quit();
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  allowCrossOrigin();
  decoder.start(app, ipcMain);
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
