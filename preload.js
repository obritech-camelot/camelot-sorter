const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  pick: () => ipcRenderer.invoke('pick'),
  scan: d => ipcRenderer.invoke('scan', d),
  sorted: d => ipcRenderer.invoke('sorted', d),
  read: p => ipcRenderer.invoke('read', p),
  save: (o, d, f, s) => ipcRenderer.invoke('save', o, d, f, s),
  open: p => ipcRenderer.invoke('open', p),
  fs: on => ipcRenderer.invoke('fs', on),
  win: a => ipcRenderer.invoke('win', a),
  trash: l => ipcRenderer.invoke('trash', l),
  isFs: () => ipcRenderer.invoke('isfs'),
  onFs: cb => ipcRenderer.on('fs-state', (_, v) => cb(v))
});
