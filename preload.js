const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zukoApp', {
  meta: () => ipcRenderer.invoke('zuko-app-meta'),
  geolocate: () => ipcRenderer.invoke('zuko-geolocate'),
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
