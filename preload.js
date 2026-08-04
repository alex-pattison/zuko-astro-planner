const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zukoApp', {
  meta: () => ipcRenderer.invoke('zuko-app-meta'),
  geolocate: () => ipcRenderer.invoke('zuko-geolocate'),
  tonightShoot: (opts) => ipcRenderer.invoke('zuko-tonight-shoot', opts || {}),
  skyForecast: (opts) => ipcRenderer.invoke('zuko-sky-forecast', opts || {}),
  skyAstronomy: (opts) => ipcRenderer.invoke('zuko-sky-astronomy', opts || {}),
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
  importAsiair: (opts) => ipcRenderer.invoke('zuko-ingest-import-asiair', opts || {}),
  scanSession: (opts) => ipcRenderer.invoke('zuko-ingest-scan-session', opts || {}),
  indexDarks: (libraryPath) => ipcRenderer.invoke('zuko-ingest-index-darks', { libraryPath }),
  indexBiases: (libraryPath) => ipcRenderer.invoke('zuko-ingest-index-biases', { libraryPath }),
  matchDarks: (opts) => ipcRenderer.invoke('zuko-ingest-match-darks', opts || {}),
  matchBiases: (opts) => ipcRenderer.invoke('zuko-ingest-match-biases', opts || {}),
  importBiases: (opts) => ipcRenderer.invoke('zuko-ingest-import-biases', opts || {}),
  scanCalibLibrary: (opts) => ipcRenderer.invoke('zuko-ingest-scan-calib-library', opts || {}),
  importCalibLibrary: (opts) => ipcRenderer.invoke('zuko-ingest-import-calib-library', opts || {}),
  deleteLibrarySet: (opts) => ipcRenderer.invoke('zuko-ingest-delete-library-set', opts || {}),
  removeLibrarySubs: (opts) => ipcRenderer.invoke('zuko-ingest-remove-library-subs', opts || {}),
  librarySize: (dirPath) => ipcRenderer.invoke('zuko-ingest-library-size', { path: dirPath }),
  stage: (opts) => ipcRenderer.invoke('zuko-ingest-stage', opts || {}),
  scan: (opts) => ipcRenderer.invoke('zuko-ingest-scan', opts || {}),
  run: (opts) => ipcRenderer.invoke('zuko-ingest-run', opts || {}),
  open: (folderPath) => ipcRenderer.invoke('zuko-ingest-open', folderPath),
});

contextBridge.exposeInMainWorld('zukoSiril', {
  calibrate: (opts) => ipcRenderer.invoke('zuko-siril-calibrate', opts || {}),
  stackFilter: (opts) => ipcRenderer.invoke('zuko-siril-stack-filter', opts || {}),
  buildMaster: (opts) => ipcRenderer.invoke('zuko-siril-build-master', opts || {}),
  readLog: (opts) => ipcRenderer.invoke('zuko-siril-read-log', opts || {}),
  onLog: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, payload) => handler(payload || {});
    ipcRenderer.on('zuko-siril-log', listener);
    return () => ipcRenderer.removeListener('zuko-siril-log', listener);
  },
});
