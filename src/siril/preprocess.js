/**
 * Siril preprocess automation (Mono 1.4 settings via siril-cli).
 *
 * PP1 calibrateShoot: bias → flat → dark → calibrate lights → stop at pp_light.
 * Aggregate: gather pp_light from nights → Filter/Aggregate/.
 * PP2 stackFilter: register+stack surviving Aggregate lights → working/result_<Filter>.fit.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEFAULT_SIRIL_CLI = path.join(
  process.env['ProgramFiles'] || 'C:\\Program Files',
  'Siril',
  'bin',
  'siril-cli.exe'
);

const DEFAULT_MONO_SCRIPT = path.join(
  process.env['ProgramFiles'] || 'C:\\Program Files',
  'Siril',
  'scripts',
  'Mono_Preprocessing.ssf'
);

/** Bundled baseline (copied from Siril install when we last verified Zuko templates). */
function resolveReferenceMonoScript() {
  return path.join(__dirname, '..', '..', 'reference', 'siril', 'scripts', 'Mono_Preprocessing.ssf');
}

const INPUT_DIRS = ['biases', 'darks', 'flats', 'lights'];

function resolveSirilCli(override) {
  const cand = override && String(override).trim()
    ? path.resolve(String(override).trim())
    : DEFAULT_SIRIL_CLI;
  if (fs.existsSync(cand)) return cand;
  return null;
}

function isFitName(name) {
  return /\.fit[s]?$/i.test(name);
}

/** FITS names in dir (does not follow/validate links). */
function listFitNames(dir) {
  try {
    return fs.readdirSync(dir).filter(isFitName);
  } catch {
    return [];
  }
}

/** FITS that resolve to a non-empty file (follows symlinks; skips dangling/0-byte). */
function listReadableFits(dir) {
  return listFitNames(dir).filter((n) => {
    try {
      const st = fs.statSync(path.join(dir, n));
      return st.isFile() && st.size > 0;
    } catch {
      return false;
    }
  });
}

function hasFits(dir) {
  return listReadableFits(dir).length > 0;
}

function listPpLights(processDir) {
  try {
    const culled = new Set();
    for (const name of ['culled.txt', 'culled.lst', 'rejected.txt']) {
      const p = path.join(processDir, name);
      if (!fs.existsSync(p)) continue;
      try {
        const text = fs.readFileSync(p, 'utf8');
        text.split(/\r?\n/).forEach((line) => {
          const s = String(line || '').trim();
          if (!s || s.startsWith('#')) return;
          culled.add(path.basename(s).toLowerCase());
        });
      } catch {
        /* ignore */
      }
    }
    return fs
      .readdirSync(processDir)
      .filter((n) => /^pp_light_\d+\.fit[s]?$/i.test(n))
      .filter((n) => !culled.has(n.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((n) => path.join(processDir, n));
  } catch {
    return [];
  }
}

/** All calibrated lights in a night process/ (ignore night-level culled lists — cull lives in Aggregate/). */
function listAllPpLights(processDir) {
  try {
    return fs
      .readdirSync(processDir)
      .filter((n) => /^pp_light_\d+\.fit[s]?$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((n) => path.join(processDir, n));
  } catch {
    return [];
  }
}

function aggregateDirFor(projectDir, filter) {
  return path.join(projectDir, sanitizeFilterName(filter), 'Aggregate');
}

function sanitizeFilterName(filter) {
  return String(filter || 'filter')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim() || 'filter';
}

function buildCalibrateScript(opts = {}) {
  const skipBiasStack = !!opts.skipBiasStack;
  const skipDarkStack = !!opts.skipDarkStack;

  const biasBlock = skipBiasStack
    ? `# Bias master already present at masters/bias_stacked.fit — skip stack
`
    : `cd biases
convert bias -out=../process
cd ../process
stack bias rej 3 3 -nonorm -out=../masters/bias_stacked
cd ..

`;

  const darkBlock = skipDarkStack
    ? `# Dark master already present at masters/dark_stacked.fit — skip stack
`
    : `cd darks
convert dark -out=../process
cd ../process
stack dark rej 3 3 -nonorm -out=../masters/dark_stacked
cd ..

`;

  return `############################################
# Zuko calibrate (Mono 1.4 settings)
# Stops after calibrate → process/pp_light_*.fit
# Generated — do not hand-edit mid-run
############################################

requires 1.3.4

${biasBlock}cd flats
convert flat -out=../process
cd ../process
calibrate flat -bias=../masters/bias_stacked
stack pp_flat rej 3 3 -norm=mul -out=../masters/pp_flat_stacked
cd ..

${darkBlock}cd lights
convert light -out=../process
cd ../process
calibrate light -dark=../masters/dark_stacked -flat=../masters/pp_flat_stacked -cc=dark

close
`;
}

function buildLibraryMasterScript(kind = 'bias') {
  const seq = kind === 'dark' ? 'dark' : 'bias';
  return `############################################
# Zuko library master stack (${seq})
# Generated — do not hand-edit mid-run
############################################

requires 1.3.4

cd subs
convert ${seq} -out=../process
cd ../process
stack ${seq} rej 3 3 -nonorm -out=../master

close
`;
}

function buildStackScript(resultBase) {
  const safe = String(resultBase || 'result').replace(/[^\w.-]+/g, '_');
  return `############################################
# Zuko register+stack (Mono 1.4 settings)
# Expects calibrated FITS in inputs/ (any names)
# Generated — do not hand-edit mid-run
############################################

requires 1.3.4

cd inputs
convert pp_light -out=..
cd ..

register pp_light

stack r_pp_light rej 3 3 -norm=addscale -output_norm -32b -out=result

load result
mirrorx -bottomup
save ${safe}

close
`;
}

/**
 * Run siril-cli with -d workDir -s scriptPath; stream stdout/stderr to logPath.
 * Optional onLog(chunk) for live UI (Siril may buffer until flush).
 */
function runSirilCli({
  cliPath,
  workDir,
  scriptPath,
  logPath,
  timeoutMs = 30 * 60 * 1000,
  onLog,
}) {
  return new Promise((resolve) => {
    const args = ['-d', workDir, '-s', scriptPath];
    const chunks = [];
    const emit = (text) => {
      chunks.push(text);
      if (typeof onLog === 'function') {
        try {
          onLog(text);
        } catch {
          /* ignore */
        }
      }
    };

    let writeChain = fsp
      .writeFile(logPath, '', 'utf8')
      .then(() => {
        const banner =
          `[zuko] ${new Date().toISOString()} starting siril-cli\n` +
          `[zuko] cwd=${workDir}\n` +
          `[zuko] script=${scriptPath}\n` +
          `[zuko] cli=${cliPath}\n` +
          `[zuko] (Siril may buffer console output until steps finish — hang tight)\n\n`;
        emit(banner);
        return fsp.appendFile(logPath, banner, 'utf8');
      })
      .catch(() => {});

    const child = spawn(cliPath, args, {
      cwd: workDir,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${path.dirname(cliPath)}${path.delimiter}${process.env.PATH || ''}`,
      },
    });

    let settled = false;
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish({ ok: false, code: 'TIMEOUT', exitCode: null, error: `siril-cli timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    function appendLog(text) {
      emit(text);
      writeChain = writeChain.then(() => fsp.appendFile(logPath, text, 'utf8')).catch(() => {});
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const body = chunks.join('');
      writeChain
        .then(() => fsp.writeFile(logPath, body, 'utf8'))
        .catch(() => {})
        .finally(() => resolve({ ...result, logPath, logTail: body.slice(-8000), logText: body }));
    }

    child.stdout.on('data', (d) => appendLog(String(d)));
    child.stderr.on('data', (d) => appendLog(String(d)));
    child.on('error', (err) => {
      finish({
        ok: false,
        code: 'SPAWN_FAILED',
        exitCode: null,
        error: String(err && err.message ? err.message : err),
      });
    });
    child.on('close', (exitCode) => {
      appendLog(`\n[zuko] siril-cli exited with code ${exitCode}\n`);
      if (exitCode === 0) {
        finish({ ok: true, code: 'OK', exitCode: 0 });
      } else {
        finish({
          ok: false,
          code: 'SIRIL_FAILED',
          exitCode,
          error: `siril-cli exited with code ${exitCode}`,
        });
      }
    });
  });
}

/** Read current log file (for UI progress polling). */
async function readSirilLog(opts = {}) {
  const logPath = opts.logPath && path.resolve(String(opts.logPath));
  if (!logPath) return { ok: false, error: 'logPath is required' };
  try {
    const text = await fsp.readFile(logPath, 'utf8');
    return {
      ok: true,
      logPath,
      text,
      size: text.length,
      tail: text.slice(-6000),
    };
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      return { ok: true, logPath, text: '', size: 0, tail: '', pending: true };
    }
    return { ok: false, error: String(e && e.message ? e.message : e), logPath };
  }
}

async function ensureLinkOrCopy(src, dest) {
  try {
    await fsp.unlink(dest);
  } catch {
    /* ignore */
  }
  try {
    await fsp.link(src, dest);
    return 'hardlink';
  } catch {
    await fsp.copyFile(src, dest);
    return 'copy';
  }
}

/**
 * PP1: calibrate one staged shoot folder up to pp_light.
 * @param {{ shootDir: string, sirilCli?: string }} opts
 */
async function calibrateShoot(opts = {}) {
  const shootDir = opts.shootDir && path.resolve(String(opts.shootDir));
  if (!shootDir) return { ok: false, code: 'MISSING_SHOOT_DIR', error: 'shootDir is required' };
  if (!fs.existsSync(shootDir)) {
    return { ok: false, code: 'SHOOT_NOT_FOUND', error: `Shoot folder not found: ${shootDir}` };
  }

  const cliPath = resolveSirilCli(opts.sirilCli);
  if (!cliPath) {
    return {
      ok: false,
      code: 'SIRIL_CLI_NOT_FOUND',
      error: `siril-cli not found (expected ${DEFAULT_SIRIL_CLI})`,
    };
  }

  const mastersDir = path.join(shootDir, 'masters');
  const biasMasterPath = path.join(mastersDir, 'bias_stacked.fit');
  const darkMasterPath = path.join(mastersDir, 'dark_stacked.fit');
  const skipBiasStack = fs.existsSync(biasMasterPath) && !hasFits(path.join(shootDir, 'biases'));
  const skipDarkStack = fs.existsSync(darkMasterPath) && !hasFits(path.join(shootDir, 'darks'));

  const required = ['flats', 'lights'];
  if (!skipBiasStack) required.push('biases');
  if (!skipDarkStack) required.push('darks');
  const missing = [];
  const unreadable = [];
  for (const d of required) {
    const dir = path.join(shootDir, d);
    const named = listFitNames(dir);
    const readable = listReadableFits(dir);
    if (!readable.length) {
      if (named.length) unreadable.push({ dir: d, named: named.length });
      else missing.push(d);
    }
  }
  if (unreadable.length) {
    const detail = unreadable.map((u) => `${u.dir}/ (${u.named} broken or 0-byte)`).join(', ');
    return {
      ok: false,
      code: 'UNREADABLE_FRAMES',
      error:
        `Unreadable FITS in: ${detail}. ` +
        'Usually dangling Dark Library links — re-import with “Use matching master darks”, or repair darks/.',
      unreadable,
    };
  }
  if (missing.length) {
    return {
      ok: false,
      code: 'MISSING_FRAMES',
      error: `Missing FITS in: ${missing.join(', ')}`,
      missing,
    };
  }
  if (skipBiasStack && !fs.existsSync(biasMasterPath)) {
    return { ok: false, code: 'MISSING_BIAS_MASTER', error: 'masters/bias_stacked.fit required when biases/ is empty' };
  }
  if (skipDarkStack && !fs.existsSync(darkMasterPath)) {
    return { ok: false, code: 'MISSING_DARK_MASTER', error: 'masters/dark_stacked.fit required when darks/ is empty' };
  }

  const processDir = path.join(shootDir, 'process');
  const scriptsDir = path.join(shootDir, 'scripts');
  await fsp.mkdir(processDir, { recursive: true });
  await fsp.mkdir(mastersDir, { recursive: true });
  await fsp.mkdir(scriptsDir, { recursive: true });

  const scriptPath = path.join(scriptsDir, 'calibrate.ssf');
  const logPath = path.join(scriptsDir, 'calibrate.log');
  await fsp.writeFile(scriptPath, buildCalibrateScript({ skipBiasStack, skipDarkStack }), 'utf8');

  const run = await runSirilCli({
    cliPath,
    workDir: shootDir,
    scriptPath,
    logPath,
    onLog: opts.onLog,
  });
  if (!run.ok) {
    return {
      ok: false,
      code: run.code,
      error: run.error,
      exitCode: run.exitCode,
      logPath,
      logTail: run.logTail,
      shootDir,
      scriptPath,
    };
  }

  const ppLights = listPpLights(processDir);
  if (!ppLights.length) {
    return {
      ok: false,
      code: 'NO_PP_LIGHTS',
      error: 'siril-cli finished but no process/pp_light_*.fit found',
      logPath,
      logTail: run.logTail,
      shootDir,
      scriptPath,
    };
  }

  return {
    ok: true,
    code: 'OK',
    shootDir,
    scriptPath,
    logPath,
    logTail: run.logTail,
    logText: run.logText,
    ppLightCount: ppLights.length,
    ppLights,
    skipBiasStack,
    skipDarkStack,
    masters: {
      bias: path.join(mastersDir, 'bias_stacked.fit'),
      dark: path.join(mastersDir, 'dark_stacked.fit'),
      flat: path.join(mastersDir, 'pp_flat_stacked.fit'),
    },
    calibratedAt: new Date().toISOString(),
  };
}

function isSubFitName(name) {
  if (!/\.fit[s]?$/i.test(name)) return false;
  if (/^master(\.fit|\.fits|\.fts)?$/i.test(name)) return false;
  if (/^(bias|dark)_stacked/i.test(name)) return false;
  return true;
}

/**
 * Stack library set subs into master.fit via Siril.
 * @param {{ setDir: string, kind?: 'bias'|'dark', removeSubs?: boolean, sirilCli?: string }} opts
 */
async function buildLibraryMaster(opts = {}) {
  const setDir = opts.setDir && path.resolve(String(opts.setDir));
  const kind = opts.kind === 'dark' ? 'dark' : 'bias';
  const removeSubs = opts.removeSubs === true;
  if (!setDir) return { ok: false, code: 'MISSING_SET_DIR', error: 'setDir is required' };
  if (!fs.existsSync(setDir)) {
    return { ok: false, code: 'SET_NOT_FOUND', error: `Set folder not found: ${setDir}` };
  }

  const cliPath = resolveSirilCli(opts.sirilCli);
  if (!cliPath) {
    return {
      ok: false,
      code: 'SIRIL_CLI_NOT_FOUND',
      error: `siril-cli not found (expected ${DEFAULT_SIRIL_CLI})`,
    };
  }

  // Collect sub FITS (including filter letter subfolders), exclude existing masters.
  const subFiles = [];
  async function collect(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (/^_build$/i.test(ent.name)) continue;
        await collect(fp);
      } else if (ent.isFile() && isSubFitName(ent.name)) {
        subFiles.push(fp);
      }
    }
  }
  await collect(setDir);

  if (subFiles.length < 2) {
    return {
      ok: false,
      code: 'TOO_FEW_SUBS',
      error: `Need at least 2 sub frames to stack (found ${subFiles.length})`,
      subCount: subFiles.length,
      setDir,
    };
  }

  const buildRoot = path.join(setDir, '_build');
  const subsDir = path.join(buildRoot, 'subs');
  const processDir = path.join(buildRoot, 'process');
  const scriptsDir = path.join(buildRoot, 'scripts');
  await fsp.rm(buildRoot, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(subsDir, { recursive: true });
  await fsp.mkdir(processDir, { recursive: true });
  await fsp.mkdir(scriptsDir, { recursive: true });

  let i = 1;
  for (const src of subFiles) {
    const dest = path.join(subsDir, `sub_${String(i).padStart(5, '0')}.fit`);
    await ensureLinkOrCopy(src, dest);
    i += 1;
  }

  const scriptPath = path.join(scriptsDir, 'build-master.ssf');
  const logPath = path.join(scriptsDir, 'build-master.log');
  await fsp.writeFile(scriptPath, buildLibraryMasterScript(kind), 'utf8');

  const run = await runSirilCli({
    cliPath,
    workDir: buildRoot,
    scriptPath,
    logPath,
    onLog: opts.onLog,
  });
  if (!run.ok) {
    return {
      ok: false,
      code: run.code,
      error: run.error,
      exitCode: run.exitCode,
      logPath,
      logTail: run.logTail,
      setDir,
      subCount: subFiles.length,
    };
  }

  const builtFit = path.join(buildRoot, 'master.fit');
  const builtFits = path.join(buildRoot, 'master.fits');
  const built = fs.existsSync(builtFit) ? builtFit : (fs.existsSync(builtFits) ? builtFits : null);
  if (!built) {
    return {
      ok: false,
      code: 'NO_MASTER',
      error: 'siril-cli finished but master.fit not found in _build',
      logPath,
      logTail: run.logTail,
      setDir,
      subCount: subFiles.length,
    };
  }

  const masterPath = path.join(setDir, 'master.fit');
  try {
    await fsp.copyFile(built, masterPath);
  } catch (e) {
    return {
      ok: false,
      code: 'MASTER_COPY_FAILED',
      error: String(e && e.message ? e.message : e),
      setDir,
    };
  }

  let removedCount = 0;
  if (removeSubs) {
    for (const src of subFiles) {
      try {
        await fsp.unlink(src);
        removedCount += 1;
      } catch { /* ignore */ }
    }
    // Remove empty filter subdirs
    for (const src of subFiles) {
      const dir = path.dirname(src);
      if (path.resolve(dir) === path.resolve(setDir)) continue;
      try {
        const left = await fsp.readdir(dir);
        if (!left.length) await fsp.rmdir(dir);
      } catch { /* ignore */ }
    }
  }

  await fsp.rm(buildRoot, { recursive: true, force: true }).catch(() => {});

  let sizeBytes = 0;
  try {
    const st = await fsp.stat(masterPath);
    sizeBytes = st.size || 0;
  } catch { /* ignore */ }

  return {
    ok: true,
    code: 'OK',
    kind,
    setDir,
    masterPath,
    subCount: subFiles.length,
    removedCount,
    removeSubs,
    sizeBytes,
    logPath,
    builtAt: new Date().toISOString(),
  };
}

/**
 * Gather calibrated pp_light_* from one or more nights into Filter/Aggregate/.
 * Hardlink-first (copy fallback). Rebuilds Aggregate/ fresh each run.
 * @param {{ projectDir: string, filter: string, shootDirs: string[] }} opts
 */
async function aggregateFilter(opts = {}) {
  const projectDir = opts.projectDir && path.resolve(String(opts.projectDir));
  const filter = sanitizeFilterName(opts.filter);
  const shootDirs = Array.isArray(opts.shootDirs)
    ? opts.shootDirs.map((d) => path.resolve(String(d))).filter(Boolean)
    : [];

  if (!projectDir) return { ok: false, code: 'MISSING_PROJECT_DIR', error: 'projectDir is required' };
  if (!filter) return { ok: false, code: 'MISSING_FILTER', error: 'filter is required' };
  if (!shootDirs.length) {
    return { ok: false, code: 'NO_SHOOTS', error: 'shootDirs must include at least one calibrated shoot' };
  }

  const sources = [];
  for (const shootDir of shootDirs) {
    const lights = listAllPpLights(path.join(shootDir, 'process'));
    if (!lights.length) {
      return {
        ok: false,
        code: 'NO_PP_LIGHTS',
        error: `No pp_light_*.fit in ${path.join(shootDir, 'process')}`,
        shootDir,
      };
    }
    for (const f of lights) sources.push({ shootDir, file: f });
  }

  const aggregateDir = aggregateDirFor(projectDir, filter);
  try {
    await fsp.rm(aggregateDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  await fsp.mkdir(aggregateDir, { recursive: true });

  let index = 1;
  const linked = [];
  let hardlinks = 0;
  let copies = 0;
  for (const src of sources) {
    const destName = `pp_light_${String(index).padStart(5, '0')}.fit`;
    const dest = path.join(aggregateDir, destName);
    const action = await ensureLinkOrCopy(src.file, dest);
    if (action === 'hardlink') hardlinks += 1;
    else copies += 1;
    linked.push({ from: src.file, to: dest, action, shootDir: src.shootDir });
    index += 1;
  }

  return {
    ok: true,
    code: 'OK',
    filter,
    aggregateDir,
    shootCount: shootDirs.length,
    frameCount: linked.length,
    ppLightCount: linked.length,
    hardlinks,
    copies,
    linked,
    aggregatedAt: new Date().toISOString(),
  };
}

/**
 * PP2: register+stack surviving lights from Filter/Aggregate/ (after Cull).
 * Stages into Filter/_stack/inputs for Siril scratch, then writes working/result_<Filter>.fit.
 * @param {{ projectDir: string, filter: string, sirilCli?: string }} opts
 */
async function stackFilter(opts = {}) {
  const projectDir = opts.projectDir && path.resolve(String(opts.projectDir));
  const filter = sanitizeFilterName(opts.filter);

  if (!projectDir) return { ok: false, code: 'MISSING_PROJECT_DIR', error: 'projectDir is required' };
  if (!filter) return { ok: false, code: 'MISSING_FILTER', error: 'filter is required' };

  const cliPath = resolveSirilCli(opts.sirilCli);
  if (!cliPath) {
    return {
      ok: false,
      code: 'SIRIL_CLI_NOT_FOUND',
      error: `siril-cli not found (expected ${DEFAULT_SIRIL_CLI})`,
    };
  }

  const aggregateDir = aggregateDirFor(projectDir, filter);
  if (!fs.existsSync(aggregateDir)) {
    return {
      ok: false,
      code: 'NEED_AGGREGATE',
      error: `Aggregate folder missing — run Aggregate first: ${aggregateDir}`,
      aggregateDir,
    };
  }

  // Surviving frames in Aggregate (deleted during cull are gone; culled.txt also honored)
  let sourceFiles = listPpLights(aggregateDir);
  if (!sourceFiles.length) {
    sourceFiles = listReadableFits(aggregateDir).map((n) => path.join(aggregateDir, n));
  }
  if (!sourceFiles.length) {
    return {
      ok: false,
      code: 'NO_PP_LIGHTS',
      error: `No lights left in Aggregate (cull may have removed all): ${aggregateDir}`,
      aggregateDir,
    };
  }
  const stackRoot = path.join(projectDir, filter, '_stack');
  const inputsDir = path.join(stackRoot, 'inputs');
  const scriptsDir = path.join(stackRoot, 'scripts');
  await fsp.mkdir(scriptsDir, { recursive: true });

  // Clear previous _stack contents (except scripts/, which we overwrite)
  try {
    const existing = await fsp.readdir(stackRoot);
    for (const name of existing) {
      if (name === 'scripts') continue;
      await fsp.rm(path.join(stackRoot, name), { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
  await fsp.mkdir(inputsDir, { recursive: true });

  let index = 1;
  const linked = [];
  for (const srcFile of sourceFiles) {
    const destName = `pp_light_${String(index).padStart(5, '0')}.fit`;
    const dest = path.join(inputsDir, destName);
    const action = await ensureLinkOrCopy(srcFile, dest);
    linked.push({ from: srcFile, to: dest, action });
    index += 1;
  }

  const resultBase = `result_${filter}`;
  const scriptPath = path.join(scriptsDir, 'stack.ssf');
  const logPath = path.join(scriptsDir, 'stack.log');
  await fsp.writeFile(scriptPath, buildStackScript(resultBase), 'utf8');

  const run = await runSirilCli({
    cliPath,
    workDir: stackRoot,
    scriptPath,
    logPath,
    onLog: opts.onLog,
  });
  if (!run.ok) {
    return {
      ok: false,
      code: run.code,
      error: run.error,
      exitCode: run.exitCode,
      logPath,
      logTail: run.logTail,
      logText: run.logText,
      stackRoot,
      aggregateDir,
      scriptPath,
      linkedCount: linked.length,
    };
  }

  const resultFit = path.join(stackRoot, `${resultBase}.fit`);
  const resultFits = path.join(stackRoot, `${resultBase}.fits`);
  let resultPath = fs.existsSync(resultFit)
    ? resultFit
    : fs.existsSync(resultFits)
      ? resultFits
      : null;

  if (!resultPath) {
    return {
      ok: false,
      code: 'NO_RESULT',
      error: `siril-cli finished but ${resultBase}.fit not found in _stack`,
      logPath,
      logTail: run.logTail,
      logText: run.logText,
      stackRoot,
      aggregateDir,
      scriptPath,
      linkedCount: linked.length,
    };
  }

  // Promote final into project working/ (flat: result_<Filter>.fit)
  const workingDir = path.join(projectDir, 'working');
  await fsp.mkdir(workingDir, { recursive: true });
  const workingPath = path.join(workingDir, path.basename(resultPath));
  try {
    await fsp.copyFile(resultPath, workingPath);
    resultPath = workingPath;
  } catch (e) {
    return {
      ok: false,
      code: 'WORKING_COPY_FAILED',
      error: `Stacked OK but failed to copy into working/: ${e && e.message ? e.message : e}`,
      logPath,
      stackRoot,
      aggregateDir,
      resultPath,
      workingDir,
    };
  }

  return {
    ok: true,
    code: 'OK',
    filter,
    aggregateDir,
    stackRoot,
    stackDir: stackRoot,
    workingDir,
    resultPath,
    scriptPath,
    logPath,
    shootCount: 1,
    frameCount: linked.length,
    ppLightCount: linked.length,
    linked,
    stackedAt: new Date().toISOString(),
  };
}

/** Siril night scratch folders (safe to delete after Aggregate / Register). */
const SHOOT_INTERMEDIATE_DIRS = ['masters', 'process', 'scripts'];
const CHANNEL_INTERMEDIATE_DIRS = ['Aggregate', '_stack'];

async function pathExistsAsync(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function folderSizeBytes(dir) {
  if (!dir || !(await pathExistsAsync(dir))) return 0;
  let total = 0;
  async function walk(d) {
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const fp = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(fp);
      else if (ent.isFile()) {
        try {
          const st = await fsp.stat(fp);
          total += st.size || 0;
        } catch { /* ignore */ }
      }
    }
  }
  await walk(dir);
  return total;
}

async function inspectShootDisk(shootDir) {
  const dir = shootDir && String(shootDir).trim();
  if (!dir) return { ok: false, error: 'shootDir is required' };
  if (!(await pathExistsAsync(dir))) {
    return {
      ok: true,
      shootDir: dir,
      exists: false,
      sizeBytes: 0,
      intermediates: { masters: false, process: false, scripts: false },
      intermediateBytes: 0,
      hasIntermediates: false,
      status: 'missing',
    };
  }
  const intermediates = {};
  let intermediateBytes = 0;
  for (const name of SHOOT_INTERMEDIATE_DIRS) {
    const p = path.join(dir, name);
    const exists = await pathExistsAsync(p);
    intermediates[name] = exists;
    if (exists) intermediateBytes += await folderSizeBytes(p);
  }
  const hasIntermediates = SHOOT_INTERMEDIATE_DIRS.some((n) => intermediates[n]);
  const sizeBytes = await folderSizeBytes(dir);
  return {
    ok: true,
    shootDir: dir,
    exists: true,
    sizeBytes,
    intermediates,
    intermediateBytes,
    hasIntermediates,
    status: hasIntermediates ? 'dirty' : 'clean',
  };
}

/**
 * Delete masters/, process/, scripts/ under a staged night folder.
 * Leaves lights/flats/darks/biases (and any Aggregate hardlinks elsewhere).
 */
async function cleanShootIntermediates(shootDir) {
  const dir = shootDir && String(shootDir).trim();
  if (!dir) return { ok: false, error: 'shootDir is required' };
  if (!(await pathExistsAsync(dir))) {
    return { ok: false, error: `Shoot folder not found: ${dir}` };
  }
  const removed = [];
  const failed = [];
  for (const name of SHOOT_INTERMEDIATE_DIRS) {
    const p = path.join(dir, name);
    if (!(await pathExistsAsync(p))) continue;
    try {
      await fsp.rm(p, { recursive: true, force: true });
      removed.push(name);
    } catch (e) {
      failed.push({ name, error: String(e && e.message ? e.message : e) });
    }
  }
  const inspect = await inspectShootDisk(dir);
  return {
    ...inspect,
    ok: failed.length === 0,
    shootDir: dir,
    removed,
    failed,
    error: failed.length ? failed.map((f) => `${f.name}: ${f.error}`).join('; ') : undefined,
  };
}

async function listProjectFilterDirs(projectDir) {
  const root = projectDir && String(projectDir).trim();
  if (!root || !(await pathExistsAsync(root))) return [];
  const skip = new Set(['working', 'dark library', 'dark_library', '.git']);
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !skip.has(String(e.name).toLowerCase()))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Clean all night intermediates, then each filter's Aggregate/ and _stack/.
 * Keeps original subs and project working/ results.
 */
async function cleanProjectIntermediates({ projectDir, shootDirs = [], filters = [] } = {}) {
  const root = projectDir && String(projectDir).trim();
  if (!root) return { ok: false, error: 'projectDir is required' };
  if (!(await pathExistsAsync(root))) {
    return { ok: false, error: `Project folder not found: ${root}` };
  }

  const shootResults = [];
  const seen = new Set();
  for (const raw of shootDirs || []) {
    const d = String(raw || '').trim();
    if (!d || seen.has(d.toLowerCase())) continue;
    seen.add(d.toLowerCase());
    shootResults.push(await cleanShootIntermediates(d));
  }

  let filterNames = (filters || []).map((f) => String(f || '').trim()).filter(Boolean);
  if (!filterNames.length) filterNames = await listProjectFilterDirs(root);

  const channelRemoved = [];
  const channelFailed = [];
  for (const filter of filterNames) {
    for (const name of CHANNEL_INTERMEDIATE_DIRS) {
      const p = path.join(root, filter, name);
      if (!(await pathExistsAsync(p))) continue;
      try {
        await fsp.rm(p, { recursive: true, force: true });
        channelRemoved.push(path.join(filter, name));
      } catch (e) {
        channelFailed.push({
          path: path.join(filter, name),
          error: String(e && e.message ? e.message : e),
        });
      }
    }
  }

  const shootFailed = shootResults.filter((r) => !r.ok);
  const ok = shootFailed.length === 0 && channelFailed.length === 0;
  return {
    ok,
    projectDir: root,
    shootResults,
    channelRemoved,
    channelFailed,
    error: !ok
      ? [
          ...shootFailed.map((r) => r.error || r.shootDir),
          ...channelFailed.map((f) => `${f.path}: ${f.error}`),
        ].join('; ')
      : undefined,
  };
}

/**
 * Parse Mono_Preprocessing.ssf header fields used for change detection.
 * Example header line: `# Mono_Preprocessing v1.4`
 */
function parseMonoScriptMeta(text) {
  const raw = String(text || '');
  const scriptVersion = (raw.match(/Mono_Preprocessing\s+v([\d.]+)/i) || [])[1] || null;
  const sirilLabel = (raw.match(/Script for Siril\s+([\d.]+)/i) || [])[1] || null;
  const requires = (raw.match(/^\s*requires\s+([\d.]+)\s*$/im) || [])[1] || null;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
  const fingerprint = `${scriptVersion || 'unknown'}@${hash}`;
  return { scriptVersion, sirilLabel, requires, hash, fingerprint };
}

async function readMonoScriptFile(filePath) {
  const p = filePath && String(filePath).trim();
  if (!p) return { ok: false, error: 'path required' };
  try {
    const text = await fsp.readFile(p, 'utf8');
    return { ok: true, path: p, text, ...parseMonoScriptMeta(text) };
  } catch (e) {
    return {
      ok: false,
      path: p,
      error: String(e && e.message ? e.message : e),
    };
  }
}

/**
 * Compare installed Siril Mono_Preprocessing.ssf to the repo reference copy.
 * Zuko does not execute the stock script, but its header/version is the signal
 * that Siril updated and our generated calibrate/stack templates may need review.
 */
async function inspectMonoPreprocessingScript(opts = {}) {
  const installedPath = (opts.installedPath && String(opts.installedPath).trim())
    || DEFAULT_MONO_SCRIPT;
  const referencePath = (opts.referencePath && String(opts.referencePath).trim())
    || resolveReferenceMonoScript();

  const [installed, reference] = await Promise.all([
    readMonoScriptFile(installedPath),
    readMonoScriptFile(referencePath),
  ]);

  const changed = !!(
    installed.ok
    && reference.ok
    && installed.fingerprint
    && reference.fingerprint
    && installed.fingerprint !== reference.fingerprint
  );

  return {
    ok: true,
    changed,
    missingInstalled: !installed.ok,
    missingReference: !reference.ok,
    installed: installed.ok
      ? {
          path: installed.path,
          scriptVersion: installed.scriptVersion,
          sirilLabel: installed.sirilLabel,
          requires: installed.requires,
          hash: installed.hash,
          fingerprint: installed.fingerprint,
        }
      : { path: installedPath, error: installed.error },
    reference: reference.ok
      ? {
          path: reference.path,
          scriptVersion: reference.scriptVersion,
          sirilLabel: reference.sirilLabel,
          requires: reference.requires,
          hash: reference.hash,
          fingerprint: reference.fingerprint,
        }
      : { path: referencePath, error: reference.error },
  };
}

module.exports = {
  resolveSirilCli,
  calibrateShoot,
  aggregateFilter,
  stackFilter,
  buildLibraryMaster,
  readSirilLog,
  buildCalibrateScript,
  buildLibraryMasterScript,
  buildStackScript,
  listPpLights,
  listAllPpLights,
  aggregateDirFor,
  inspectShootDisk,
  cleanShootIntermediates,
  cleanProjectIntermediates,
  inspectMonoPreprocessingScript,
  parseMonoScriptMeta,
  DEFAULT_SIRIL_CLI,
  DEFAULT_MONO_SCRIPT,
};
