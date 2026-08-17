#!/usr/bin/env node
/**
 * Build Windows Beta NSIS installer, then silent-install it so the Desktop
 * shortcut launches the new build immediately.
 *
 * Usage: npm run dist:win:beta
 *        npm run dist:win:beta:build-only
 * Env: ZUKO_BETA_SKIP_INSTALL=1 — same as --build-only
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const pkg = require(path.join(ROOT, 'package.json'));
const PRODUCT = (pkg.build && pkg.build.productName) || 'Zuko Astro Planner Beta';
const SETUP_NAME = `${PRODUCT} Setup ${pkg.version}.exe`;
const INSTALL_DIR = path.join(
  process.env.LOCALAPPDATA || '',
  'Programs',
  'zuko-astro-planner',
);
const EXE_NAME = `${PRODUCT}.exe`;
const EXE_PATH = path.join(INSTALL_DIR, EXE_NAME);
const ASAR_PATH = path.join(INSTALL_DIR, 'resources', 'app.asar');

function die(msg, code = 1) {
  console.error(`dist-win-beta: ${msg}`);
  process.exit(code);
}

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    // Avoid shell:true + args (DEP0190). On Windows, .cmd shims need shell.
    shell: process.platform === 'win32' && !cmd.endsWith('.exe') && !cmd.endsWith('.js'),
    ...opts,
  });
  if (r.error) die(r.error.message);
  if (r.status !== 0) die(`${cmd} exited ${r.status}`, r.status || 1);
}

function closeBetaProcesses() {
  if (process.platform !== 'win32') return;
  // Packaged Beta only — do not kill Dev `electron.exe`.
  const ps = `
    Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessName -eq '${PRODUCT.replace(/'/g, "''")}' } |
      Stop-Process -Force
  `;
  spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
}

function readInstalledMeta() {
  if (!fs.existsSync(ASAR_PATH)) return null;
  const buf = fs.readFileSync(ASAR_PATH);
  const s = buf.toString('utf8');
  const version = (s.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] || null;
  const buildRaw = (s.match(/"zukoBuild"\s*:\s*(\d+)/) || [])[1];
  const zukoBuild = buildRaw != null ? Number(buildRaw) : null;
  return { version, zukoBuild, mtime: fs.statSync(ASAR_PATH).mtime };
}

function ensureDesktopShortcut() {
  if (process.platform !== 'win32') return;
  if (!fs.existsSync(EXE_PATH)) {
    console.warn('dist-win-beta: installed exe missing; skip shortcut');
    return;
  }
  const candidates = [
    path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop'),
    path.join(process.env.USERPROFILE || '', 'Desktop'),
    path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'),
  ];
  const desktop = candidates.find((d) => fs.existsSync(d)) || candidates[0];
  const lnk = path.join(desktop, `${PRODUCT}.lnk`);
  const wd = INSTALL_DIR.replace(/'/g, "''");
  const target = EXE_PATH.replace(/'/g, "''");
  const linkPath = lnk.replace(/'/g, "''");
  const ps = `
    $sh = New-Object -ComObject WScript.Shell
    $sc = $sh.CreateShortcut('${linkPath}')
    $sc.TargetPath = '${target}'
    $sc.WorkingDirectory = '${wd}'
    $sc.Description = '${PRODUCT.replace(/'/g, "''")}'
    $sc.Save()
    Write-Output $sc.TargetPath
  `;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.warn('dist-win-beta: could not refresh Desktop shortcut:', (r.stderr || r.stdout || '').trim());
    return;
  }
  console.log(`dist-win-beta: Desktop shortcut → ${(r.stdout || '').trim() || EXE_PATH}`);
}

async function main() {
  const skipInstall =
    process.env.ZUKO_BETA_SKIP_INSTALL === '1'
    || process.argv.includes('--build-only');

  const builderJs = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
  if (fs.existsSync(builderJs)) {
    run(process.execPath, [builderJs, '--win']);
  } else {
    run('npx', ['electron-builder', '--win']);
  }

  const setupPath = path.join(DIST, SETUP_NAME);
  if (!fs.existsSync(setupPath)) {
    // Fallback: newest matching Setup *.exe in dist/
    const files = (await fsp.readdir(DIST)).filter(
      (n) => n.startsWith(`${PRODUCT} Setup `) && n.endsWith('.exe') && !n.includes('blockmap'),
    );
    if (!files.length) die(`missing installer (expected ${SETUP_NAME})`);
    files.sort();
    const newest = files[files.length - 1];
    console.warn(`dist-win-beta: exact ${SETUP_NAME} not found; using ${newest}`);
    await installAndVerify(path.join(DIST, newest), skipInstall);
    return;
  }
  await installAndVerify(setupPath, skipInstall);
}

async function installAndVerify(setupPath, skipInstall) {
  console.log(`dist-win-beta: installer ${setupPath}`);
  if (skipInstall) {
    console.log('dist-win-beta: ZUKO_BETA_SKIP_INSTALL=1 — skipping install');
    return;
  }
  if (process.platform !== 'win32') {
    console.warn('dist-win-beta: non-Windows — build only');
    return;
  }

  console.log('dist-win-beta: closing running Beta (Dev electron left alone)…');
  closeBetaProcesses();
  // Brief settle so NSIS can overwrite files
  await new Promise((r) => setTimeout(r, 1500));

  console.log('dist-win-beta: silent install (/S)…');
  const inst = spawnSync(setupPath, ['/S'], { stdio: 'inherit' });
  if (inst.error) die(inst.error.message);
  if (inst.status !== 0) die(`installer exited ${inst.status}`, inst.status || 1);

  await new Promise((r) => setTimeout(r, 1000));

  const meta = readInstalledMeta();
  const expectV = String(pkg.version);
  const expectB = Number(pkg.zukoBuild);
  if (!meta) die(`install finished but asar missing at ${ASAR_PATH}`);
  if (meta.version !== expectV || meta.zukoBuild !== expectB) {
    die(
      `installed meta mismatch: got v${meta.version} build ${meta.zukoBuild}, expected v${expectV} build ${expectB}`,
    );
  }
  console.log(`dist-win-beta: installed OK — v${meta.version} · build ${meta.zukoBuild}`);
  ensureDesktopShortcut();
  console.log(`dist-win-beta: launch via Desktop “${PRODUCT}” (or ${EXE_PATH})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
