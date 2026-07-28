const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  scanAsiairSource,
  ingestAsiairDump,
} = require('./src/ingest/asiairIngest');

const PREFERRED_DIR = 'H:\\Photography\\Astrophotography\\Dashboard';
const PREFERRED_PROJECTS_DIR = 'H:\\Photography\\Astrophotography\\Projects';
const REPO_DATA_DIR = path.join(__dirname, 'data');
const REPO_DATA_FILE = path.join(REPO_DATA_DIR, 'zuko-dashboard-data.json');
const REPO_PROJECTS_DIR = path.join(REPO_DATA_DIR, 'projects');
const DATA_FILENAME = 'zuko-dashboard-data.json';

function resolveDataPaths() {
  const preferredFile = path.join(PREFERRED_DIR, DATA_FILENAME);
  if (fs.existsSync(PREFERRED_DIR)) {
    return {
      dir: PREFERRED_DIR,
      file: preferredFile,
      mirrorFile: REPO_DATA_FILE,
      label: preferredFile,
    };
  }
  return {
    dir: REPO_DATA_DIR,
    file: REPO_DATA_FILE,
    mirrorFile: null,
    label: REPO_DATA_FILE,
  };
}

function resolveProjectsRoot() {
  const parent = path.dirname(PREFERRED_PROJECTS_DIR);
  if (fs.existsSync(parent)) {
    try {
      fs.mkdirSync(PREFERRED_PROJECTS_DIR, { recursive: true });
      return PREFERRED_PROJECTS_DIR;
    } catch (err) {
      console.warn('Preferred projects root unavailable:', err);
    }
  }
  fs.mkdirSync(REPO_PROJECTS_DIR, { recursive: true });
  return REPO_PROJECTS_DIR;
}

function getMainWindow() {
  const wins = BrowserWindow.getAllWindows();
  return wins[0] || null;
}

async function atomicWrite(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#070b12',
    title: 'Zuko Astro Planner',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
    },
  });

  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Data Folder',
          click: () => {
            const { dir: dataDir } = resolveDataPaths();
            shell.openPath(dataDir);
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win.webContents.reload() },
        { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', click: () => win.webContents.toggleDevTools() },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  win.loadFile('index.html');

  // Open any target="_blank" links (AstroBin embed, Clear Outside, etc.) in the
  // system browser instead of a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('zuko-data-path', () => resolveDataPaths().label);

ipcMain.handle('zuko-data-open-folder', async () => {
  const { dir } = resolveDataPaths();
  await fsp.mkdir(dir, { recursive: true });
  return shell.openPath(dir);
});

ipcMain.handle('zuko-data-load', async () => {
  const { file, label } = resolveDataPaths();
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });

    // Prefer primary file; if missing on H:, fall back to repo seed.
    let source = file;
    if (!fs.existsSync(file) || !String(await fsp.readFile(file, 'utf8')).trim()) {
      if (file !== REPO_DATA_FILE && fs.existsSync(REPO_DATA_FILE)) {
        source = REPO_DATA_FILE;
      } else {
        return { ok: true, data: null, path: label, missing: true };
      }
    }

    const text = await fsp.readFile(source, 'utf8');
    if (!text.trim()) {
      return { ok: true, data: null, path: label, missing: true };
    }
    return { ok: true, data: JSON.parse(text), path: label, missing: false };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), path: label };
  }
});

ipcMain.handle('zuko-data-save', async (_event, data) => {
  const { file, mirrorFile, label } = resolveDataPaths();
  try {
    await atomicWrite(file, data);
    if (mirrorFile) {
      try {
        await atomicWrite(mirrorFile, data);
      } catch (mirrorErr) {
        console.warn('Repo data mirror failed:', mirrorErr);
      }
    }
    return { ok: true, path: label };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), path: label };
  }
});

ipcMain.handle('zuko-ingest-projects-root', () => resolveProjectsRoot());

ipcMain.handle('zuko-ingest-pick-folder', async () => {
  const win = getMainWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Select ASIAIR source folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) {
    return { ok: false, canceled: true };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('zuko-ingest-scan', async (_event, payload = {}) => {
  try {
    const sourcePath = payload.sourcePath;
    if (!sourcePath) return { ok: false, error: 'sourcePath is required' };
    const scan = await scanAsiairSource(sourcePath, { readHeaders: !!payload.readHeaders });
    // Don't ship every frame path to the renderer unless asked — summary is enough for UI.
    return {
      ok: true,
      sourcePath: scan.sourcePath,
      totalFiles: scan.totalFiles,
      matched: scan.matched,
      unmatched: scan.unmatched,
      summary: scan.summary,
      frames: payload.includeFrames ? scan.frames : undefined,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('zuko-ingest-run', async (_event, payload = {}) => {
  try {
    const sourcePath = payload.sourcePath;
    if (!sourcePath) return { ok: false, error: 'sourcePath is required' };
    const workRoot = payload.workRoot || resolveProjectsRoot();
    const result = await ingestAsiairDump({
      sourcePath,
      workRoot,
      objectName: payload.objectName || 'Object',
      filter: payload.filter || null,
      night: payload.night || null,
      mode: payload.mode || 'hardlink',
      readHeaders: payload.readHeaders !== false,
      filterToShoot: payload.filterToShoot !== false,
    });
    return result;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('zuko-ingest-open', async (_event, folderPath) => {
  if (!folderPath) return { ok: false, error: 'path is required' };
  try {
    await fsp.mkdir(folderPath, { recursive: true });
    const err = await shell.openPath(folderPath);
    if (err) return { ok: false, error: err };
    return { ok: true, path: folderPath };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
