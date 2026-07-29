/**
 * Isolated ASIAIR ingest QA harness.
 * Builds staging/asiair-qa from a subset of asiair-sample FITS, then exercises
 * discover → scan → match → stage → restage → edge helpers.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  discoverSessions,
  scanSession,
  indexDarkLibrary,
  matchMasterDarks,
  stageSirilTree,
  normalizeFilter,
  normalizeNight,
  astronomicalNightForFrame,
  nightWindowYmds,
  TEMP_TOLERANCE_C,
  SIX_MONTHS_MS,
} = require('../src/ingest/asiairIngest');

const ROOT = path.resolve(__dirname, '..');
const SRC_AUTORUN = path.join(ROOT, 'staging', 'asiair-sample', 'Autorun');
const QA_ROOT = path.join(ROOT, 'staging', 'asiair-qa');
const QA_AUTORUN = path.join(QA_ROOT, 'Autorun');
const DARK_LIB = 'H:\\Photography\\Astrophotography\\Zuko\\Dark Library';
const NIGHT = '20260725';

const results = [];
function pass(name, detail) {
  results.push({ ok: true, name, detail: detail || '' });
  console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail) {
  results.push({ ok: false, name, detail: String(detail || '') });
  console.log(`  FAIL  ${name} — ${detail}`);
}
function assert(name, cond, detail) {
  if (cond) pass(name, detail);
  else fail(name, detail || 'assertion failed');
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function copyFew(srcDir, destDir, pred, limit) {
  await ensureDir(destDir);
  if (!fs.existsSync(srcDir)) return 0;
  const names = (await fsp.readdir(srcDir))
    .filter((n) => /\.fit$/i.test(n) && pred(n))
    .sort()
    .slice(0, limit);
  for (const n of names) {
    const dest = path.join(destDir, n);
    if (!fs.existsSync(dest)) await fsp.copyFile(path.join(srcDir, n), dest);
  }
  return names.length;
}

async function buildFixture() {
  console.log('\n== Build QA fixture ==');
  if (fs.existsSync(QA_ROOT)) {
    await fsp.rm(QA_ROOT, { recursive: true, force: true });
  }
  const lightSrc = path.join(SRC_AUTORUN, 'Light', 'NGC 6960');
  const lightDst = path.join(QA_AUTORUN, 'Light', 'NGC 6960');
  const flatSrc = path.join(SRC_AUTORUN, 'Flat');
  const biasSrc = path.join(SRC_AUTORUN, 'Bias');
  const darkSrc = path.join(SRC_AUTORUN, 'Dark');

  assert('source Autorun exists', fs.existsSync(SRC_AUTORUN), SRC_AUTORUN);
  const hL = await copyFew(lightSrc, lightDst, (n) => /_H_/i.test(n), 3);
  const oL = await copyFew(lightSrc, lightDst, (n) => /_O_/i.test(n), 3);
  const sL = await copyFew(lightSrc, lightDst, (n) => /_S_/i.test(n), 3);
  const hF = await copyFew(flatSrc, path.join(QA_AUTORUN, 'Flat'), (n) => /_H_/i.test(n), 2);
  const oF = await copyFew(flatSrc, path.join(QA_AUTORUN, 'Flat'), (n) => /_O_/i.test(n), 2);
  const sF = await copyFew(flatSrc, path.join(QA_AUTORUN, 'Flat'), (n) => /_S_/i.test(n), 2);
  // biases/darks often lack filter letter — take any
  const b = await copyFew(biasSrc, path.join(QA_AUTORUN, 'Bias'), () => true, 3);
  const d = await copyFew(darkSrc, path.join(QA_AUTORUN, 'Dark'), () => true, 3);
  assert('fixture lights Ha/OIII/SII', hL >= 1 && oL >= 1 && sL >= 1, `H=${hL} O=${oL} S=${sL}`);
  assert('fixture flats present', hF + oF + sF >= 2, `flats=${hF + oF + sF}`);
  assert('fixture biases present', b >= 1, `biases=${b}`);
  assert('fixture session darks present', d >= 1, `darks=${d}`);
}

function normalizeWinPath(p) {
  if (p == null || p === '') return p;
  let s = String(p).trim().replace(/\//g, '\\');
  if (s.startsWith('\\\\')) return '\\\\' + s.slice(2).replace(/\\+/g, '\\');
  return s.replace(/\\+/g, '\\');
}

function masterDarkSetFolder(filePath, libraryRoot) {
  if (!filePath) return null;
  const norm = normalizeWinPath(filePath);
  const root = normalizeWinPath(libraryRoot || '').replace(/\\+$/, '');
  if (!root) {
    const i = norm.lastIndexOf('\\');
    return i > 0 ? norm.slice(0, i) : norm;
  }
  const rootLower = root.toLowerCase();
  let dir = norm;
  const slash = dir.lastIndexOf('\\');
  if (slash > 0) dir = dir.slice(0, slash);
  for (let n = 0; n < 8; n++) {
    const parentSlash = dir.lastIndexOf('\\');
    if (parentSlash <= 0) break;
    const parent = dir.slice(0, parentSlash);
    if (parent.toLowerCase() === rootLower) return dir;
    if (dir.toLowerCase() === rootLower) return dir;
    dir = parent;
  }
  const i = norm.lastIndexOf('\\');
  return i > 0 ? norm.slice(0, i) : norm;
}

function statisticalMode(values) {
  const counts = new Map();
  for (const raw of values || []) {
    if (raw == null || raw === '') continue;
    if (typeof raw === 'number' && Number.isNaN(raw)) continue;
    const key = typeof raw === 'number' ? String(raw) : String(raw);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let bestKey = null;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestKey = k;
      bestN = n;
    }
  }
  if (bestKey == null) return null;
  if (/^-?\d+(\.\d+)?$/.test(bestKey)) return Number(bestKey);
  return bestKey;
}

function groupMasterDarkFolders(matches, libraryRoot) {
  const map = new Map();
  for (const d of matches || []) {
    const folder = masterDarkSetFolder(d.filePath, libraryRoot);
    if (!folder) continue;
    let row = map.get(folder);
    if (!row) {
      row = { folder, name: folder.split(/[/\\]/).pop(), count: 0, files: [] };
      map.set(folder, row);
    }
    row.count += 1;
    row.files.push(d);
  }
  for (const row of map.values()) {
    const files = row.files;
    row.exposureSec = statisticalMode(files.map((d) => d.exposureSec));
    row.gain = statisticalMode(files.map((d) => d.gain));
    row.tempC = statisticalMode(files.map((d) => (d.tempC == null ? null : Math.round(Number(d.tempC) * 10) / 10)));
    row.ageDays = statisticalMode(files.map((d) => d.ageDays));
    row.expired = row.ageDays != null ? row.ageDays >= 183 : false;
  }
  return [...map.values()];
}

async function testHelpers() {
  console.log('\n== Unit helpers ==');
  assert('normalizeFilter Ha', normalizeFilter('H') === 'Ha');
  assert('normalizeFilter OIII', normalizeFilter('O') === 'OIII');
  assert('normalizeFilter SII', normalizeFilter('S') === 'SII');
  assert('normalizeNight yyMMdd', normalizeNight('260725') === '20260725');
  assert('night window includes D+1', nightWindowYmds('20260725').includes('20260726'));
  assert(
    'normalizeWinPath collapses doubles',
    normalizeWinPath('H:\\\\Photography\\\\Zuko') === 'H:\\Photography\\Zuko',
  );

  const fakePath =
    'H:\\Photography\\Astrophotography\\Zuko\\Dark Library\\Darks_180s_Bin2_-10c\\H\\Dark_1.fit';
  const badRoot = 'H:\\\\Photography\\\\Astrophotography\\\\Zuko\\\\Dark Library';
  const goodRoot = 'H:\\Photography\\Astrophotography\\Zuko\\Dark Library';
  const folderBad = masterDarkSetFolder(fakePath, badRoot);
  const folderGood = masterDarkSetFolder(fakePath, goodRoot);
  assert(
    'set folder with doubled root still resolves',
    /Darks_180s_Bin2_-10c$/i.test(folderBad || ''),
    folderBad,
  );
  assert(
    'set folder with normal root is profile dir',
    /Darks_180s_Bin2_-10c$/i.test(folderGood || ''),
    folderGood,
  );
  assert('set folder is NOT filter letter', !/\\H$/i.test(folderGood || ''), folderGood);

  // Age flags: expired should match but be flagged
  const old = {
    filePath: 'x',
    fileName: 'old.fit',
    exposureSec: 180,
    gain: 120,
    tempC: -10,
    acquiredAt: '2025-01-01',
    expired: false,
  };
  const ageMs = Date.now() - Date.parse('2025-01-01T12:00:00Z');
  const matched = matchMasterDarks({
    index: [old],
    exposureSec: 180,
    gain: 120,
    tempC: -10,
  });
  assert('aged dark still matches (not excluded)', matched.matches.length === 1);
  assert(
    'aged dark flagged expired when >6mo',
    ageMs > SIX_MONTHS_MS ? matched.matches[0].expired === true : true,
    `ageDays≈${Math.round(ageMs / 86400000)} expired=${matched.matches[0] && matched.matches[0].expired}`,
  );

  const tempReject = matchMasterDarks({
    index: [{ ...old, acquiredAt: '2026-07-01', tempC: 0 }],
    exposureSec: 180,
    gain: 120,
    tempC: -10,
  });
  assert(
    `temp beyond ±${TEMP_TOLERANCE_C}°C rejected`,
    tempReject.matches.length === 0 && tempReject.rejected.length === 1,
  );
}

async function testPipeline() {
  console.log('\n== Discover / scan / match / stage ==');
  const disc = await discoverSessions(QA_ROOT);
  assert('discover finds Autorun', disc.ok && disc.sessions && disc.sessions.length >= 1, JSON.stringify(disc.sessions && disc.sessions.map((s) => s.name)));
  if (!disc.ok) return;

  const sessionPath = disc.sessions[0].path;
  const scan = await scanSession({
    sessionPath,
    nightDate: NIGHT,
    targetHint: 'Veil Nebula (Cygnus Loop)',
  });
  assert('scan ok', scan.ok !== false && (scan.lights || []).length > 0, `lights=${(scan.lights || []).length} status=${scan.status}`);
  const filters = [...new Set((scan.lights || []).map((l) => normalizeFilter(l.filter)).filter(Boolean))];
  assert('scan sees multiple filters', filters.length >= 2, filters.join(','));
  assert('scan flats', (scan.flats || []).length > 0, `flats=${(scan.flats || []).length}`);
  assert('scan biases', (scan.biases || []).length > 0, `biases=${(scan.biases || []).length}`);

  let darkIndex = [];
  if (fs.existsSync(DARK_LIB)) {
    const idx = await indexDarkLibrary(DARK_LIB);
    assert('index dark library', idx.ok && idx.index.length > 0, `count=${idx.index && idx.index.length}`);
    darkIndex = idx.index || [];
    const folders = groupMasterDarkFolders(darkIndex, DARK_LIB);
    assert(
      'dark library groups to set folder(s)',
      folders.length >= 1 && folders.every((f) => !/^[HOS]$/i.test(f.name)),
      folders.map((f) => `${f.name}:${f.count}`).join(', '),
    );
  } else {
    fail('index dark library', 'Dark Library path missing on H:');
  }

  const light = (scan.lights || []).find((l) => normalizeFilter(l.filter) === 'Ha') || scan.lights[0];
  const match = matchMasterDarks({
    index: darkIndex,
    exposureSec: light.exposureSec,
    gain: light.gain,
    tempC: light.tempC,
  });
  assert('master darks match Ha profile', match.matches.length > 0, `matches=${match.matches.length} rejected=${match.rejectedCount}`);

  // Stage Ha only first
  const stage1 = await stageSirilTree({
    projectDir: QA_ROOT,
    sessionPath,
    nightDate: NIGHT,
    shootFolder: '260725_Ha_B9_Home',
    filters: ['Ha'],
    lights: (scan.lights || []).filter((l) => normalizeFilter(l.filter) === 'Ha'),
    flats: (scan.flats || []).filter((f) => normalizeFilter(f.filter) === 'Ha'),
    biases: scan.biases || [],
    darks: scan.darks || [],
    useMasterDarks: true,
    darkMatchesByFilter: { Ha: match.matches, '*': match.matches },
    force: false,
  });
  assert('stage Ha ok', stage1.ok, stage1.error || stage1.code);
  if (stage1.ok) {
    const haLights = path.join(QA_ROOT, 'Ha', '260725_Ha_B9_Home', 'lights');
    const haDarks = path.join(QA_ROOT, 'Ha', '260725_Ha_B9_Home', 'darks');
    const haBias = path.join(QA_ROOT, 'Ha', '260725_Ha_B9_Home', 'biases');
    const nLights = fs.existsSync(haLights) ? fs.readdirSync(haLights).filter((n) => /\.fit$/i.test(n)).length : 0;
    const nDarks = fs.existsSync(haDarks) ? fs.readdirSync(haDarks).filter((n) => /\.fit$/i.test(n)).length : 0;
    const nBias = fs.existsSync(haBias) ? fs.readdirSync(haBias).filter((n) => /\.fit$/i.test(n)).length : 0;
    assert('Ha lights staged', nLights >= 1, `lights=${nLights}`);
    assert('Ha biases linked', nBias >= 1, `biases=${nBias}`);
    assert('Ha master darks linked', nDarks >= 1, `darks=${nDarks}`);

    // Inspect one dark link — should point into Dark Library, not _calibration/darks
    if (nDarks) {
      const sample = path.join(haDarks, fs.readdirSync(haDarks).find((n) => /\.fit$/i.test(n)));
      let target = null;
      try {
        target = fs.readlinkSync(sample);
      } catch {
        target = '(not a symlink)';
      }
      const absTarget = path.isAbsolute(target) ? target : path.resolve(path.dirname(sample), target);
      assert(
        'master dark link targets library (not _calibration)',
        /Dark Library/i.test(absTarget) && !/_calibration/i.test(absTarget),
        absTarget,
      );
      // BUG CHECK: meta darkLibrary should be set folder, not H/O/S
      const metaLib = stage1.meta && stage1.meta.darkLibrary;
      if (metaLib) {
        assert(
          'meta.darkLibrary is set folder not filter subfolder',
          /Darks_180s_Bin2_-10c$/i.test(normalizeWinPath(metaLib)) && !/\\[HOS]$/i.test(normalizeWinPath(metaLib)),
          metaLib,
        );
      } else {
        fail('meta.darkLibrary present', 'missing from stage result');
      }
    }

    // DEST_EXISTS without force
    const again = await stageSirilTree({
      projectDir: QA_ROOT,
      sessionPath,
      nightDate: NIGHT,
      shootFolder: '260725_Ha_B9_Home',
      filters: ['Ha'],
      lights: (scan.lights || []).filter((l) => normalizeFilter(l.filter) === 'Ha'),
      flats: (scan.flats || []).filter((f) => normalizeFilter(f.filter) === 'Ha'),
      biases: scan.biases || [],
      darks: [],
      useMasterDarks: true,
      darkMatchesByFilter: { Ha: match.matches },
      force: false,
    });
    assert('restage without force → DEST_EXISTS', again.ok === false && again.code === 'DEST_EXISTS', again.code);

    // Force restage should succeed (skips existing copies)
    const forced = await stageSirilTree({
      projectDir: QA_ROOT,
      sessionPath,
      nightDate: NIGHT,
      shootFolder: '260725_Ha_B9_Home',
      filters: ['Ha'],
      lights: (scan.lights || []).filter((l) => normalizeFilter(l.filter) === 'Ha'),
      flats: (scan.flats || []).filter((f) => normalizeFilter(f.filter) === 'Ha'),
      biases: scan.biases || [],
      darks: [],
      useMasterDarks: true,
      darkMatchesByFilter: { Ha: match.matches },
      force: true,
    });
    assert('force restage ok', forced.ok, forced.error);
  }

  // Stage OIII — should reuse biases from _calibration
  const oMatch = matchMasterDarks({
    index: darkIndex,
    exposureSec: light.exposureSec,
    gain: light.gain,
    tempC: light.tempC,
  });
  const stageO = await stageSirilTree({
    projectDir: QA_ROOT,
    sessionPath,
    nightDate: NIGHT,
    shootFolder: '260725_OIII_B9_Home',
    filters: ['OIII'],
    lights: (scan.lights || []).filter((l) => normalizeFilter(l.filter) === 'OIII'),
    flats: (scan.flats || []).filter((f) => normalizeFilter(f.filter) === 'OIII'),
    biases: scan.biases || [],
    darks: [],
    useMasterDarks: true,
    darkMatchesByFilter: { OIII: oMatch.matches, '*': oMatch.matches },
    force: false,
  });
  assert('stage OIII ok', stageO.ok, stageO.error || stageO.code);
  if (stageO.ok && stageO.meta && stageO.meta.calibReuse) {
    assert(
      'OIII reuses preexisting biases',
      stageO.meta.calibReuse.biasesPreexisting > 0,
      JSON.stringify(stageO.meta.calibReuse),
    );
  }

  // Wrong night → few/no lights
  const wrongNight = await scanSession({
    sessionPath,
    nightDate: '20260101',
    targetHint: 'Veil',
  });
  assert(
    'wrong night finds no lights',
    (wrongNight.lights || []).length === 0,
    `lights=${(wrongNight.lights || []).length}`,
  );
}

async function testDashboardConsistency() {
  console.log('\n== Dashboard data sanity ==');
  const dataPath = path.join(ROOT, 'data', 'zuko-dashboard-data.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  assert('appMeta.build present', data.appMeta && data.appMeta.build >= 5, JSON.stringify(data.appMeta));
  assert(
    'darkLibrary path normalized',
    data.darkLibrary && !String(data.darkLibrary.path).includes('\\\\Photography'),
    data.darkLibrary && data.darkLibrary.path,
  );
  const veil = (data.projects || []).find((p) => /veil/i.test(p.name || ''));
  assert('Veil project exists', !!veil);
  if (veil) {
    assert('Veil has projectDir', !!(veil.projectDir && veil.projectDir.trim()));
    const captured = (veil.shoots || []).filter((s) => s.complete);
    assert('Veil has captured shoots', captured.length >= 1, `n=${captured.length}`);
    // loggedHrs should match complete shoot hours per filterIndex
    const totals = new Map();
    for (const sh of veil.shoots || []) {
      if (!sh.complete) continue;
      totals.set(sh.filterIndex, (totals.get(sh.filterIndex) || 0) + (Number(sh.hours) || 0));
    }
    let hoursOk = true;
    (veil.filterTargets || []).forEach((ft, i) => {
      const expect = Math.round(((totals.get(i) || 0) + Number.EPSILON) * 100) / 100;
      const got = Number(ft.loggedHrs) || 0;
      if (Math.abs(expect - got) > 0.011) {
        hoursOk = false;
        fail(`loggedHrs filter ${i} ${ft.filter}`, `got ${got} expect ${expect}`);
      }
    });
    if (hoursOk) pass('filter loggedHrs match shoot log');

    // Check ingestMeta darkLibrary path bug in saved data
    for (const sh of veil.shoots || []) {
      const lib = sh.ingestMeta && sh.ingestMeta.darkLibrary;
      if (!lib) continue;
      const n = normalizeWinPath(lib);
      if (/\\[HOS]$/i.test(n)) {
        fail('saved ingestMeta.darkLibrary not filter letter folder', n);
      } else {
        pass('saved ingestMeta.darkLibrary ok', n);
      }
    }
  }

  const assets = data.assets || [];
  assert(
    'SV165 present, SV106 gone',
    assets.some((a) => /SV165/i.test(a.name)) && !assets.some((a) => /SV106 Guide/i.test(a.name)),
  );
  const missingRelease = assets.filter((a) => !a.released || a.released === '—');
  assert(
    'no blank release dates (n/a allowed)',
    missingRelease.length === 0,
    missingRelease.map((a) => a.name).join(', '),
  );
}

async function main() {
  console.log('Zuko ASIAIR QA');
  console.log('QA root:', QA_ROOT);
  await buildFixture();
  await testHelpers();
  await testPipeline();
  await testDashboardConsistency();

  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);
  console.log(`\n== Summary: ${passed.length} passed, ${failed.length} failed ==`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
  }
  // Write machine-readable report for the agent
  const reportPath = path.join(ROOT, 'staging', 'asiair-qa-report.json');
  await fsp.writeFile(
    reportPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        qaRoot: QA_ROOT,
        passed: passed.length,
        failed: failed.length,
        results,
      },
      null,
      2,
    ),
  );
  console.log('Wrote', reportPath);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
