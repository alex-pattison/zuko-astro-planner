const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zukoApp', {
  meta: () => ipcRenderer.invoke('zuko-app-meta'),
  geolocate: () => ipcRenderer.invoke('zuko-geolocate'),
  tonightShoot: (opts) => ipcRenderer.invoke('zuko-tonight-shoot', opts || {}),
  skyForecast: (opts) => ipcRenderer.invoke('zuko-sky-forecast', opts || {}),
  astrosphericCredits: () => ipcRenderer.invoke('zuko-astrospheric-credits'),
  getDevFlags: () => ipcRenderer.invoke('zuko-dev-flags-get'),
  setDevFlags: (flags) => ipcRenderer.invoke('zuko-dev-flags-set', flags || {}),
  onDevFlags: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, flags) => handler(flags);
    ipcRenderer.on('zuko-dev-flags', listener);
    return () => ipcRenderer.removeListener('zuko-dev-flags', listener);
  },
  getSettings: () => ipcRenderer.invoke('zuko-settings-get'),
  getAstrosphericKey: () => ipcRenderer.invoke('zuko-astrospheric-key-get'),
  setAstrosphericKey: (key) => ipcRenderer.invoke('zuko-astrospheric-key-set', { key }),
  onOpenSettings: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = () => handler();
    ipcRenderer.on('zuko-open-settings', listener);
    return () => ipcRenderer.removeListener('zuko-open-settings', listener);
  },
});

contextBridge.exposeInMainWorld('zukoFs', {
  load: () => ipcRenderer.invoke('zuko-data-load'),
  save: (data) => ipcRenderer.invoke('zuko-data-save', data),
  getPath: () => ipcRenderer.invoke('zuko-data-path'),
  openFolder: () => ipcRenderer.invoke('zuko-data-open-folder'),
});

contextBridge.exposeInMainWorld('zukoIngest', {
  projectsRoot: () => ipcRenderer.invoke('zuko-ingest-projects-root'),
  pickFolder: (opts) => ipcRenderer.invoke('zuko-ingest-pick-folder', opts || {}),
  discover: (projectDir) => ipcRenderer.invoke('zuko-ingest-discover', { projectDir }),
  scanSession: (opts) => ipcRenderer.invoke('zuko-ingest-scan-session', opts || {}),
  indexDarks: (libraryPath) => ipcRenderer.invoke('zuko-ingest-index-darks', { libraryPath }),
  matchDarks: (opts) => ipcRenderer.invoke('zuko-ingest-match-darks', opts || {}),
  stage: (opts) => ipcRenderer.invoke('zuko-ingest-stage', opts || {}),
  scan: (opts) => ipcRenderer.invoke('zuko-ingest-scan', opts || {}),
  run: (opts) => ipcRenderer.invoke('zuko-ingest-run', opts || {}),
  open: (folderPath) => ipcRenderer.invoke('zuko-ingest-open', folderPath),
});
