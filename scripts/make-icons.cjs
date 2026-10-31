// Renders build/icon.svg to the PNG/ICO assets electron-builder and the window need, with Electron
// itself (no extra browser download):  npx electron scripts/make-icons.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build/icon.svg'), 'utf8');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  async function render(size) {
    win.setContentSize(size, size);
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 150));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    return img.resize({ width: size, height: size }).toPNG();
  }
  fs.writeFileSync(path.join(root, 'build/icon.png'), await render(1024));
  fs.writeFileSync(path.join(root, 'electron/icon.png'), await render(512));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const s of sizes) images.push(await render(s));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  const dir = Buffer.alloc(16 * sizes.length);
  let offset = 6 + dir.length;
  sizes.forEach((s, i) => {
    const o = i * 16;
    dir.writeUInt8(s === 256 ? 0 : s, o); dir.writeUInt8(s === 256 ? 0 : s, o + 1);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(images[i].length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += images[i].length;
  });
  fs.writeFileSync(path.join(root, 'build/icon.ico'), Buffer.concat([header, dir, ...images]));
  console.log('icons written');
  app.quit();
});
