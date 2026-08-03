/**
 * Siril preprocess automation (Mono 1.4 settings via siril-cli).
 *
 * PP1 calibrateShoot: bias → flat → dark → calibrate lights → stop at pp_light.
 * PP2 stackFilter: gather pp_light from shoots → register → stack → one result per filter.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_SIRIL_CLI = path.join(
  process.env['ProgramFiles'] || 'C:\\Program Files',
  'Siril',
  'bin',
  'siril-cli.exe'
);

const INPUT_DIRS = ['biases', 'darks', 'flats', 'lights'];

function resolveSirilCli(override) {
  const cand = override && String(override).trim()
    ? path.resolve(String(override).trim())
    : DEFAULT_SIRIL_CLI;
  if (fs.existsSync(cand)) return cand;
  return null;
}

function hasFits(dir) {
  try {
    return fs.readdirSync(dir).some((n) => /\.fit[s]?$/i.test(n));
  } catch {
    return false;
  }
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

function sanitizeFilterName(filter) {
  return String(filter || 'filter')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim() || 'filter';
}

function buildCalibrateScript() {
  return `############################################
# Zuko calibrate (Mono 1.4 settings)
# Stops after calibrate → process/pp_light_*.fit
# Generated — do not hand-edit mid-run
############################################

requires 1.3.4

cd biases
convert bias -out=../process
cd ../process
stack bias rej 3 3 -nonorm -out=../masters/bias_stacked
cd ..

cd flats
convert flat -out=../process
cd ../process
calibrate flat -bias=../masters/bias_stacked
stack pp_flat rej 3 3 -norm=mul -out=../masters/pp_flat_stacked
cd ..

cd darks
convert dark -out=../process
cd ../process
stack dark rej 3 3 -nonorm -out=../masters/dark_stacked
cd ..

cd lights
convert light -out=../process
cd ../process
calibrate light -dark=../masters/dark_stacked -flat=../masters/pp_flat_stacked -cc=dark

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

  const missing = INPUT_DIRS.filter((d) => !hasFits(path.join(shootDir, d)));
  if (missing.length) {
    return {
      ok: false,
      code: 'MISSING_FRAMES',
      error: `Missing FITS in: ${missing.join(', ')}`,
      missing,
    };
  }

  const processDir = path.join(shootDir, 'process');
  const mastersDir = path.join(shootDir, 'masters');
  const scriptsDir = path.join(shootDir, 'scripts');
  await fsp.mkdir(processDir, { recursive: true });
  await fsp.mkdir(mastersDir, { recursive: true });
  await fsp.mkdir(scriptsDir, { recursive: true });

  const scriptPath = path.join(scriptsDir, 'calibrate.ssf');
  const logPath = path.join(scriptsDir, 'calibrate.log');
  await fsp.writeFile(scriptPath, buildCalibrateScript(), 'utf8');

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
    masters: {
      bias: path.join(mastersDir, 'bias_stacked.fit'),
      dark: path.join(mastersDir, 'dark_stacked.fit'),
      flat: path.join(mastersDir, 'pp_flat_stacked.fit'),
    },
    calibratedAt: new Date().toISOString(),
  };
}

/**
 * PP2: register+stack calibrated lights from one or more shoots for a filter.
 * @param {{ projectDir: string, filter: string, shootDirs: string[], sirilCli?: string }} opts
 */
async function stackFilter(opts = {}) {
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

  const cliPath = resolveSirilCli(opts.sirilCli);
  if (!cliPath) {
    return {
      ok: false,
      code: 'SIRIL_CLI_NOT_FOUND',
      error: `siril-cli not found (expected ${DEFAULT_SIRIL_CLI})`,
    };
  }

  const sources = [];
  for (const shootDir of shootDirs) {
    const lights = listPpLights(path.join(shootDir, 'process'));
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
  for (const src of sources) {
    const destName = `pp_light_${String(index).padStart(5, '0')}.fit`;
    const dest = path.join(inputsDir, destName);
    const action = await ensureLinkOrCopy(src.file, dest);
    linked.push({ from: src.file, to: dest, action });
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
      resultPath,
      workingDir,
    };
  }

  return {
    ok: true,
    code: 'OK',
    filter,
    stackRoot,
    stackDir: stackRoot,
    workingDir,
    resultPath,
    scriptPath,
    logPath,
    shootCount: shootDirs.length,
    frameCount: linked.length,
    ppLightCount: linked.length,
    linked,
    stackedAt: new Date().toISOString(),
  };
}

module.exports = {
  resolveSirilCli,
  calibrateShoot,
  stackFilter,
  readSirilLog,
  buildCalibrateScript,
  buildStackScript,
  listPpLights,
  DEFAULT_SIRIL_CLI,
};
