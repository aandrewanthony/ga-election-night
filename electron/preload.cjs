// Minimal, explicit bridge from the web app to the desktop shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gaDesktop', {
  platform: process.platform,
  version: () => ipcRenderer.invoke('gaen:version'),
  fullscreen: () => ipcRenderer.invoke('gaen:fullscreen'),
  secrets: {
    get: (name) => ipcRenderer.invoke('gaen:secret-get', name),
    set: (name, value) => ipcRenderer.invoke('gaen:secret-set', name, value),
  },
  // Headers the shell adds to this stream's requests (playlist UA/Referer/Origin/Cookie).
  setStreamHeaders: (url, headers) => ipcRenderer.invoke('gaen:stream-headers', String(url), headers ?? {}),
  decoder: {
    info: () => ipcRenderer.invoke('dial:decoder-info'),
    probe: (url, headers) => ipcRenderer.invoke('dial:probe', String(url), headers ?? {}),
    url: (src, headers, opts) => ipcRenderer.invoke('dial:decoder-url', String(src), headers ?? {}, opts ?? {}),
  },
});
