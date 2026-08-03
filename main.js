const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const ASIAIR_INGEST_PATH = path.join(__dirname, 'src', 'ingest', 'asiairIngest.js');
const {
  loadDotEnv,
  recommendTonightShoot,
  getSkyForecast,
  getApiKeyStatus,
  setApiKey,
  setForecastCacheDir,
  getStoredCreditInfo,
} = require('./src/weather/tonightShoot');
const {
  getSkyAstronomy,
  setAstronomyCacheDir,
} = require('./src/weather/skyAstronomy');

/** Writable .env home: checkout root in Dev; Beta data dir when packaged (asar is read-only). */
function resolveEnvRoot() {
  const override = process.env.ZUKO_ENV_DIR && String(process.env.ZUKO_ENV_DIR).trim();
  if (override) return path.resolve(override);
  if (app.isPackaged) return 'H:\\Photography\\Astrophotography\\Dashboard';
  return __dirname;
}

loadDotEnv(resolveEnvRoot());

const DEV_FLAGS_FILE = app.isPackaged
  ? path.join(resolveEnvRoot(), 'dev-flags.json')
  : path.join(__dirname, 'data', 'dev-flags.json');

function readDevFlags() {
  try {
    if (!fs.existsSync(DEV_FLAGS_FILE)) {
      return { forceFallback: false, syntheticAstrospheric: false, simulateOffline: false };
    }
    const parsed = JSON.parse(fs.readFileSync(DEV_FLAGS_FILE, 'utf8'));
    return {
      forceFallback: !!parsed.forceFallback,
      syntheticAstrospheric: !!parsed.syntheticAstrospheric,
      simulateOffline: !!parsed.simulateOffline,
    };
  } catch {
    return { forceFallback: false, syntheticAstrospheric: false, simulateOffline: false };
  }
}

function writeDevFlags(flags) {
  const next = {
    forceFallback: !!(flags && flags.forceFallback),
    syntheticAstrospheric: !!(flags && flags.syntheticAstrospheric),
    simulateOffline: !!(flags && flags.simulateOffline),
  };
  try {
    fs.mkdirSync(path.dirname(DEV_FLAGS_FILE), { recursive: true });
    fs.writeFileSync(DEV_FLAGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('dev-flags write failed:', err && err.message ? err.message : err);
  }
  return next;
}

/** Always reload ingest module so staging fixes apply without restarting Electron. */
function loadAsiairIngest() {
  try {
    delete require.cache[require.resolve(ASIAIR_INGEST_PATH)];
  } catch {
    /* ignore */
  }
  return require(ASIAIR_INGEST_PATH);
}
/** Beta (packaged installer) owns real dashboard data on H:. */
const BETA_DATA_DIR = 'H:\\Photography\\Astrophotography\\Dashboard';
const PREFERRED_PROJECTS_DIR = 'H:\\Photography\\Astrophotography\\Projects';
const REPO_DATA_DIR = path.join(__dirname, 'data');
const REPO_DATA_FILE = path.join(REPO_DATA_DIR, 'zuko-dashboard-data.json');
const REPO_PROJECTS_DIR = path.join(REPO_DATA_DIR, 'projects');
const DATA_FILENAME = 'zuko-dashboard-data.json';

/** Isolated data root for Playwright / QA (never touch H: live dashboard). */
function envDataDir() {
  const raw = process.env.ZUKO_DATA_DIR;
  return raw && String(raw).trim() ? path.resolve(String(raw).trim()) : null;
}

function envProjectsDir() {
  const raw = process.env.ZUKO_PROJECTS_DIR;
  return raw && String(raw).trim() ? path.resolve(String(raw).trim()) : null;
}

function readZukoChannelFromPackage() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    const ch = parsed && parsed.zukoChannel;
    if (ch === 'beta' || ch === 'dev') return ch;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Channel: ZUKO_CHANNEL env → package.json zukoChannel → packaged=beta / unpackaged=dev.
 * Dev and beta never share a data pool.
 */
function getZukoChannel() {
  const env = process.env.ZUKO_CHANNEL && String(process.env.ZUKO_CHANNEL).trim().toLowerCase();
  if (env === 'beta' || env === 'dev') return env;
  const fromPkg = readZukoChannelFromPackage();
  if (fromPkg) return fromPkg;
  return app.isPackaged ? 'beta' : 'dev';
}

function channelProductTitle() {
  return getZukoChannel() === 'beta' ? 'Zuko Astro Planner Beta' : 'Zuko Astro Planner Dev';
}

function resolveDataPaths() {
  const override = envDataDir();
  if (override) {
    const file = path.join(override, DATA_FILENAME);
    return {
      dir: override,
      file,
      mirrorFile: null,
      label: file,
      channel: getZukoChannel(),
    };
  }
  const channel = getZukoChannel();
  if (channel === 'beta') {
    const file = path.join(BETA_DATA_DIR, DATA_FILENAME);
    return {
      dir: BETA_DATA_DIR,
      file,
      mirrorFile: null,
      label: file,
      channel,
    };
  }
  // Dev: checkout-local data/ only (F:\\GitHub\\zuko-astro-planner\\data when developing there).
  return {
    dir: REPO_DATA_DIR,
    file: REPO_DATA_FILE,
    mirrorFile: null,
    label: REPO_DATA_FILE,
    channel: 'dev',
  };
}

async function readDataCandidate(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const st = await fsp.stat(filePath);
    if (!st.isFile() || st.size === 0) return null;
    const text = await fsp.readFile(filePath, 'utf8');
    if (!text.trim()) return null;
    return {
      path: filePath,
      mtimeMs: st.mtimeMs,
      text,
      data: JSON.parse(text),
    };
  } catch (err) {
    console.warn('Skipping unreadable data file:', filePath, err);
    return null;
  }
}

async function backupDataFile(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(path.dirname(filePath), 'backups');
  await fsp.mkdir(backupDir, { recursive: true });
  const dest = path.join(backupDir, `zuko-dashboard-data.${stamp}.json`);
  await fsp.copyFile(filePath, dest);
  return dest;
}

/** Load the active channel's single data file (no H: ↔ repo mirror). */
async function reconcileDataFiles() {
  const { dir, file } = resolveDataPaths();
  await fsp.mkdir(dir, { recursive: true });
  const candidate = await readDataCandidate(file);
  if (!candidate) {
    return {
      ok: true,
      data: { projects: [], assets: [], notes: [] },
      path: file,
      missing: true,
      syncedTo: [],
      backups: [],
    };
  }
  return {
    ok: true,
    data: candidate.data,
    path: candidate.path,
    missing: false,
    syncedTo: [],
    backups: [],
  };
}

function resolveProjectsRoot() {
  const override = envProjectsDir();
  if (override) {
    fs.mkdirSync(override, { recursive: true });
    return override;
  }
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
    title: channelProductTitle(),
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
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            win.webContents.send('zuko-open-settings');
          },
        },
        {
          label: 'Open Data Folder',
          click: () => {
            const { dir: dataDir } = resolveDataPaths();
            shell.openPath(dataDir);
          },
        },
        { type: 'separator' },
        {
          label: 'Dev',
          submenu: [
            {
              label: 'Force Open-Meteo fallback',
              type: 'checkbox',
              checked: !!readDevFlags().forceFallback,
              click: (item) => {
                const flags = writeDevFlags({
                  ...readDevFlags(),
                  forceFallback: !!item.checked,
                });
                win.webContents.send('zuko-dev-flags', flags);
              },
            },
            {
              label: 'Use synthetic Astrospheric data',
              type: 'checkbox',
              checked: !!readDevFlags().syntheticAstrospheric,
              click: (item) => {
                const flags = writeDevFlags({
                  ...readDevFlags(),
                  syntheticAstrospheric: !!item.checked,
                });
                win.webContents.send('zuko-dev-flags', flags);
              },
            },
            {
              label: 'Simulate no internet',
              type: 'checkbox',
              checked: !!readDevFlags().simulateOffline,
              click: (item) => {
                const flags = writeDevFlags({
                  ...readDevFlags(),
                  simulateOffline: !!item.checked,
                });
                win.webContents.send('zuko-dev-flags', flags);
              },
            },
          ],
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

  // Open any target="_blank" links (AstroBin embed, Astrospheric, etc.) in the
  // system browser instead of a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function readPackageMeta() {
  // Read from disk each time so version/build updates without restarting Electron
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: String((parsed && parsed.version) || '0.0.0'),
      build: Number(parsed && parsed.zukoBuild) || 1,
      channel: getZukoChannel(),
    };
  } catch (err) {
    return { version: '0.0.0', build: 1, channel: getZukoChannel() };
  }
}

async function windowsGeolocate() {
  const script = path.join(__dirname, 'scripts', 'windows-geolocate.ps1');
  if (!fs.existsSync(script)) {
    return { ok: false, error: 'Missing windows-geolocate.ps1' };
  }
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 }
    );
    const text = String(stdout || '').trim();
    if (!text) {
      return { ok: false, error: stderr ? String(stderr).trim() : 'No location output from Windows' };
    }
    const parsed = JSON.parse(text);
    if (!parsed || !parsed.ok) {
      return {
        ok: false,
        error: (parsed && parsed.error) || 'Windows location unavailable',
        status: parsed && parsed.status,
        permission: parsed && parsed.permission,
      };
    }
    return {
      ok: true,
      lat: Number(parsed.lat),
      lon: Number(parsed.lon),
      accuracy: parsed.accuracy != null ? Number(parsed.accuracy) : null,
      source: 'windows',
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

ipcMain.handle('zuko-app-meta', () => readPackageMeta());

ipcMain.handle('zuko-geolocate', async () => {
  if (process.platform === 'win32') return windowsGeolocate();
  return { ok: false, error: 'Native geolocation is only wired for Windows right now' };
});

ipcMain.handle('zuko-tonight-shoot', async (_event, payload = {}) => {
  try {
    return await recommendTonightShoot(payload || {});
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
    };
  }
});

ipcMain.handle('zuko-sky-forecast', async (_event, payload = {}) => {
  try {
    return await getSkyForecast({ ...(payload || {}), includeHours: true });
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
    };
  }
});

ipcMain.handle('zuko-sky-astronomy', async (_event, payload = {}) => {
  try {
    return await getSkyAstronomy(payload || {});
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
    };
  }
});

ipcMain.handle('zuko-astrospheric-credits', async () => {
  try {
    return { ok: true, ...getStoredCreditInfo() };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
    };
  }
});

ipcMain.handle('zuko-dev-flags-get', async () => ({ ok: true, ...readDevFlags() }));

ipcMain.handle('zuko-dev-flags-set', async (_event, payload = {}) => {
  const flags = writeDevFlags({
    ...readDevFlags(),
    ...(payload || {}),
  });
  return { ok: true, ...flags };
});

ipcMain.handle('zuko-settings-get', async () => {
  const meta = readPackageMeta();
  const { label, dir, channel } = resolveDataPaths();
  return {
    ok: true,
    app: meta,
    channel,
    dataPath: label,
    dataDir: dir,
    projectsRoot: resolveProjectsRoot(),
    astrospheric: getApiKeyStatus(),
  };
});

ipcMain.handle('zuko-astrospheric-key-get', async () => {
  return { ok: true, ...getApiKeyStatus() };
});

ipcMain.handle('zuko-astrospheric-key-set', async (_event, payload = {}) => {
  try {
    const key = payload && Object.prototype.hasOwnProperty.call(payload, 'key')
      ? payload.key
      : '';
    const status = setApiKey(resolveEnvRoot(), key);
    return { ok: true, ...status };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('zuko-data-path', () => resolveDataPaths().label);

ipcMain.handle('zuko-data-open-folder', async () => {
  const { dir } = resolveDataPaths();
  await fsp.mkdir(dir, { recursive: true });
  return shell.openPath(dir);
});

ipcMain.handle('zuko-data-load', async () => {
  const { label } = resolveDataPaths();
  try {
    return await reconcileDataFiles();
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

ipcMain.handle('zuko-ingest-pick-folder', async (_event, payload = {}) => {
  const win = getMainWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: payload.title || 'Select folder',
    defaultPath: payload.defaultPath || undefined,
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) {
    return { ok: false, canceled: true };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('zuko-ingest-discover', async (_event, payload = {}) => {
  try {
    const { discoverSessions } = loadAsiairIngest();
    return await discoverSessions(payload.projectDir);
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), sessions: [] };
  }
});

ipcMain.handle('zuko-ingest-scan-session', async (_event, payload = {}) => {
  try {
    const { scanSession } = loadAsiairIngest();
    return await scanSession(payload || {});
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('zuko-ingest-index-darks', async (_event, payload = {}) => {
  try {
    const { indexDarkLibrary } = loadAsiairIngest();
    return await indexDarkLibrary(payload.libraryPath);
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), index: [] };
  }
});

ipcMain.handle('zuko-ingest-match-darks', async (_event, payload = {}) => {
  try {
    const { matchMasterDarks } = loadAsiairIngest();
    return matchMasterDarks(payload || {});
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), matches: [] };
  }
});

ipcMain.handle('zuko-ingest-stage', async (_event, payload = {}) => {
  try {
    const { stageSirilTree } = loadAsiairIngest();
    return await stageSirilTree(payload || {});
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('zuko-ingest-scan', async (_event, payload = {}) => {
  try {
    const { scanAsiairSource } = loadAsiairIngest();
    const sourcePath = payload.sourcePath;
    if (!sourcePath) return { ok: false, error: 'sourcePath is required' };
    const scan = await scanAsiairSource(sourcePath, { readHeaders: payload.readHeaders !== false });
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
    const { ingestAsiairDump } = loadAsiairIngest();
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
  setForecastCacheDir(resolveDataPaths().dir);
  setAstronomyCacheDir(resolveDataPaths().dir);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
