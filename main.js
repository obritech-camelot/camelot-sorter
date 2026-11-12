const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs'), path = require('path');

function createWindow() {
  const w = new BrowserWindow({
    width: 1280, height: 860, fullscreen: true, backgroundColor: '#0a0b0f',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  w.setMenuBarVisibility(false);
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (/^https?:/.test(url)) { e.preventDefault(); shell.openExternal(url); } });
  w.webContents.on('before-input-event', (e, i) => {
    if (i.type === 'keyDown' && i.key === 'F11') { e.preventDefault(); w.setFullScreen(!w.isFullScreen()); }
  });
  w.on('enter-full-screen', () => w.webContents.send('fs-state', true));
  w.on('leave-full-screen', () => w.webContents.send('fs-state', false));
  w.loadFile('index.html');
}
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const SORTED_SUFFIX = ' [Sorted]'; // old versions made one folder per playlist
const SORTED_RE = / \[(Harmonic Flow|Camelot Order|Energy Build|Energy Come-Down|Waves|BPM Ascending|BPM Descending)\]\.m3u8$/;

ipcMain.handle('pick', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('scan', async (_, dir) => {
  const g = {};
  for (const f of fs.readdirSync(dir)) {
    if (SORTED_RE.test(f)) continue; // our own sorted output is not an input playlist
    const e = path.extname(f).toLowerCase();
    if (!['.txt', '.m3u', '.m3u8'].includes(e)) continue;
    const n = path.basename(f, path.extname(f));
    const x = g[n] || (g[n] = { name: n });
    x[e === '.txt' ? 'txt' : 'm3u'] = path.join(dir, f);
  }
  return Object.values(g).sort((a, b) => a.name.localeCompare(b.name));
});
// Lists sorted playlists (.m3u8 named "... [Method].m3u8") and old "[Sorted]" folders made by this app.
ipcMain.handle('sorted', async (_, dirs) => {
  const seen = new Set(), out = [];
  for (const d of (Array.isArray(dirs) ? dirs : [])) {
    if (!d || typeof d !== 'string' || seen.has(d) || !fs.existsSync(d)) continue;
    seen.add(d);
    try {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if ((e.isFile() && SORTED_RE.test(e.name)) || (e.isDirectory() && e.name.endsWith(SORTED_SUFFIX))) out.push({ name: e.name, path: path.join(d, e.name) });
      }
    } catch (err) {}
  }
  return out;
});
ipcMain.handle('read', async (_, p) => fs.readFileSync(p));
// Saves the files directly into the save folder (or the exports folder).
// Never opens Explorer/Finder by itself.
ipcMain.handle('save', async (_, outDir, libDir, files, sub) => {
  try {
    let base = (outDir && fs.existsSync(outDir)) ? outDir : ((libDir && fs.existsSync(libDir)) ? libDir : null);
    if (!base) {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled) return { ok: false, err: 'cancelled' };
      base = r.filePaths[0];
    }
    const out = base;
    fs.mkdirSync(out, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(out, f.name.replace(/[\\/:*?"<>|]/g, '_')), f.text, 'utf8');
    return { ok: true, dir: out, base };
  } catch (e) { return { ok: false, err: e.message }; }
});
ipcMain.handle('open', async (_, p) => { try { fs.mkdirSync(p, { recursive: true }); await shell.openPath(p); } catch (e) {} });
ipcMain.handle('fs', (e, on) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setFullScreen(!!on); });
ipcMain.handle('isfs', e => { const w = BrowserWindow.fromWebContents(e.sender); return w ? w.isFullScreen() : false; });
ipcMain.handle('win', (e, a) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (!w) return;
  if (a === 'min') w.minimize();
  else if (a === 'close') w.close();
  else if (a === 'max') { if (w.isFullScreen()) w.setFullScreen(false); else if (w.isMaximized()) w.unmaximize(); else w.maximize(); }
});
// Moves exported playlist files and this app's "[Sorted]" folders to the Recycle Bin / Trash, after confirmation.
ipcMain.handle('trash', async (e, paths) => {
  const okPath = p => {
    if (typeof p !== 'string' || !fs.existsSync(p)) return false;
    if (fs.statSync(p).isDirectory()) return path.basename(p).endsWith(SORTED_SUFFIX);
    return ['.txt', '.m3u', '.m3u8'].includes(path.extname(p).toLowerCase());
  };
  const list = (Array.isArray(paths) ? paths : []).filter(okPath);
  if (!list.length) return { cancelled: true };
  const dirs = list.filter(p => fs.statSync(p).isDirectory()).length, files = list.length - dirs;
  const bin = process.platform === 'darwin' ? 'Trash' : 'Recycle Bin';
  const what = [files ? files + ' playlist file(s)' : '', dirs ? dirs + ' folder(s)' : ''].filter(Boolean).join(' and ');
  const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
    type: 'warning', buttons: ['Move to ' + bin, 'Cancel'], defaultId: 1, cancelId: 1,
    title: 'Delete', message: 'Move ' + what + ' to the ' + bin + '?',
    detail: 'Only exported playlist files, sorted playlists and old "[Sorted]" folders made by this app are removed. Your music files are not touched.'
  });
  if (r.response !== 0) return { cancelled: true };
  let moved = 0, failed = 0;
  for (const p of list) { try { await shell.trashItem(p); moved++; } catch (err) { failed++; } }
  return { moved, failed };
});
