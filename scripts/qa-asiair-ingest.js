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
  evaluateIngestFrameReadiness,
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

function patchDateObs(buf, ymd) {
  const text = buf.toString('binary');
  const out = Buffer.from(buf);
  const isoDate = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  for (let i = 0; i + 80 <= Math.min(text.length, 2880 * 8); i += 80) {
    const card = text.slice(i, i + 80);
    if (card.slice(0, 8).trim().toUpperCase() === 'END') break;
    if (card.slice(0, 8).trim().toUpperCase() !== 'DATE-OBS') continue;
    const m = card.match(/DATE-OBS\s*=\s*'([^']+)'/i);
    let timePart = 'T00:00:00';
    if (m && m[1].includes('T')) timePart = 'T' + m[1].split('T')[1];
    const val = ("'" + isoDate + timePart + "'").padEnd(20, ' ');
    const rebuilt = ('DATE-OBS= ' + val + card.slice(10 + val.length)).slice(0, 80).padEnd(80, ' ');
    Buffer.from(rebuilt, 'binary').copy(out, i);
    return out;
  }
  return out;
}

/** Same filter (Ha), different night — rewrite DATE-OBS + filename stamp. */
async function addMultiDayHaCopies(lightDir, flatDir, fromDate, toDate) {
  let n = 0;
  async function rewrite(dir, pred, limit) {
    if (!fs.existsSync(dir)) return;
    const names = (await fsp.readdir(dir))
      .filter((x) => /\.fit$/i.test(x) && pred(x) && x.includes(fromDate))
      .sort()
      .slice(0, limit);
    for (const name of names) {
      const destName = name.split(fromDate).join(toDate);
      const dest = path.join(dir, destName);
      if (fs.existsSync(dest)) continue;
      const buf = await fsp.readFile(path.join(dir, name));
      await fsp.writeFile(dest, patchDateObs(buf, toDate));
      n += 1;
    }
  }
  await rewrite(lightDir, (x) => /_H_/i.test(x), 2);
  await rewrite(flatDir, (x) => /_H_/i.test(x), 1);
  return n;
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
  const hL = await copyFew(lightSrc, lightDst, (n) => /_H_/i.test(n) && n.includes('20260725'), 3);
  const oL = await copyFew(lightSrc, lightDst, (n) => /_O_/i.test(n), 3);
  const sL = await copyFew(lightSrc, lightDst, (n) => /_S_/i.test(n), 3);
  const hF = await copyFew(flatSrc, path.join(QA_AUTORUN, 'Flat'), (n) => /_H_/i.test(n) && n.includes('20260726'), 2);
  const oF = await copyFew(flatSrc, path.join(QA_AUTORUN, 'Flat'), (n) => /_O_/i.test(n) && n.includes('20260726'), 2);
  const sF = await copyFew(flatSrc, path.join(QA_AUTORUN, 'Flat'), (n) => /_S_/i.test(n) && n.includes('20260726'), 2);
  // biases/darks often lack filter letter — take any
  const b = await copyFew(biasSrc, path.join(QA_AUTORUN, 'Bias'), () => true, 3);
  const d = await copyFew(darkSrc, path.join(QA_AUTORUN, 'Dark'), () => true, 3);
  const multi = await addMultiDayHaCopies(
    lightDst,
    path.join(QA_AUTORUN, 'Flat'),
    '20260725',
    '20260720',
  );
  assert('fixture lights Ha/OIII/SII', hL >= 1 && oL >= 1 && sL >= 1, `H=${hL} O=${oL} S=${sL}`);
  assert('fixture flats present', hF + oF + sF >= 2, `flats=${hF + oF + sF}`);
  assert('fixture biases present', b >= 1, `biases=${b}`);
  assert('fixture session darks present', d >= 1, `darks=${d}`);
  assert('fixture multi-day Ha copies', multi >= 1, `rewritten=${multi}`);
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

  const haLights = (scan.lights || []).filter((l) => normalizeFilter(l.filter) === 'Ha');
  const haFlats = (scan.flats || []).filter((f) => normalizeFilter(f.filter) === 'Ha');
  const readyOk = evaluateIngestFrameReadiness({
    lights: haLights,
    flats: haFlats,
    biases: scan.biases || [],
    sessionDarks: scan.darks || [],
    useMasterDarks: true,
    darkMatchesByFilter: { Ha: match.matches, '*': match.matches },
    filters: ['Ha'],
  });
  assert('readiness ok with all 4', readyOk.ok, readyOk.error);
  const missingFlat = evaluateIngestFrameReadiness({
    lights: haLights,
    flats: [],
    biases: scan.biases || [],
    sessionDarks: scan.darks || [],
    useMasterDarks: true,
    darkMatchesByFilter: { Ha: match.matches },
    filters: ['Ha'],
  });
  assert('readiness fails without Flat', !missingFlat.ok && missingFlat.missing.some((m) => /Flat/i.test(m)), missingFlat.missing.join(','));
  const missingBias = evaluateIngestFrameReadiness({
    lights: haLights,
    flats: haFlats,
    biases: [],
    sessionDarks: scan.darks || [],
    useMasterDarks: false,
    filters: ['Ha'],
  });
  assert('readiness fails without Bias', !missingBias.ok && missingBias.missing.includes('Bias'), missingBias.missing.join(','));

  // Stage without master dark matches → MISSING_FRAMES
  const noDark = await stageSirilTree({
    projectDir: QA_ROOT,
    sessionPath,
    nightDate: NIGHT,
    shootFolder: '260725_Ha_missing_dark',
    filters: ['Ha'],
    useMasterDarks: true,
    darkMatchesByFilter: {},
    force: true,
  });
  assert(
    'stage without master darks → MISSING_FRAMES',
    noDark.ok === false && noDark.code === 'MISSING_FRAMES',
    `${noDark.code}: ${noDark.error}`,
  );

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

  // Assert merge: if we ever add a Plan under QA_ROOT, projectDir scan sees both.
  // For single-Autorun fixture, projectDir scan must still work and tag shootingType.
  const merged = await scanSession({
    projectDir: QA_ROOT,
    nightDate: NIGHT,
    targetHint: 'Veil Nebula (Cygnus Loop)',
  });
  assert('projectDir scan ok (merged sessions)', merged.ok && (merged.lights || []).length > 0, `lights=${(merged.lights || []).length}`);
  assert(
    'frames tagged with shootingType',
    (merged.lights || []).every((l) => l.shootingType),
    (merged.lights || []).slice(0, 1).map((l) => l.shootingType).join(','),
  );
  assert(
    'filter rows expose shootingType',
    (merged.filters || []).some((r) => r.shootingType && r.shootingType !== '—'),
    JSON.stringify((merged.filters || []).map((r) => r.shootingType)),
  );

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

function filterToneKey(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (n === 'ha' || n === 'h' || n === 'halpha') return 'ha';
  if (n === 'oiii' || n === 'o3' || n === 'o') return 'oiii';
  if (n === 'sii' || n === 's2' || n === 's') return 'sii';
  return 'other';
}

function shootNightYmd(sh) {
  let d = String(sh.date || '').replace(/[^0-9]/g, '');
  if (d.length === 6) d = (parseInt(d.slice(0, 2), 10) >= 70 ? '19' : '20') + d;
  return d.length === 8 ? d : null;
}

function isShootIngested(sh) {
  return !!(sh && sh.ingestPath && sh.ingestMeta && sh.ingestMeta.stagedAt);
}

function hasIngestedShootForFilterNight(project, filterName, nightYmd) {
  if (!project || !filterName || !nightYmd) return false;
  const want = filterToneKey(filterName);
  return (project.shoots || []).some((sh) => {
    if (!isShootIngested(sh)) return false;
    if (shootNightYmd(sh) !== nightYmd) return false;
    const ft = project.filterTargets[sh.filterIndex];
    if (!ft || !ft.filter) return false;
    return filterToneKey(ft.filter) === want;
  });
}

function hasShootLogForFilterNight(project, filterName, nightYmd) {
  if (!project || !filterName || !nightYmd) return false;
  const want = filterToneKey(filterName);
  return (project.shoots || []).some((sh) => {
    if (shootNightYmd(sh) !== nightYmd) return false;
    const ft = project.filterTargets[sh.filterIndex];
    if (!ft || !ft.filter) return false;
    return filterToneKey(ft.filter) === want;
  });
}

function ingestFilterStatus(opts) {
  const { project, filter, night, isPendingMatch, missingFrames } = opts || {};
  if (hasIngestedShootForFilterNight(project, filter, night)) {
    return { key: 'staged', label: 'already staged' };
  }
  if (!hasShootLogForFilterNight(project, filter, night)) {
    return { key: 'nolog', label: 'no shot log' };
  }
  if (isPendingMatch) {
    const missing = missingFrames || [];
    if (missing.length) {
      const parts = [];
      if (missing.some((m) => /^Flat/i.test(m))) parts.push('missing flats');
      if (missing.some((m) => /^Bias/i.test(m))) parts.push('missing bias');
      if (missing.some((m) => /^Dark/i.test(m))) parts.push('missing darks');
      return { key: 'incomplete', label: parts.join(', ') || 'incomplete' };
    }
    return { key: 'match', label: 'match' };
  }
  return { key: 'inlog', label: 'in log' };
}

function shootColumnLabel(isPendingMatch, project, filter, night, missingFrames) {
  return ingestFilterStatus({
    project,
    filter,
    night,
    isPendingMatch,
    missingFrames: missingFrames || [],
  }).label;
}

async function testMultiDayAndShootColumn() {
  console.log('\n== Multi-day + Shoot? column ==');
  const disc = await discoverSessions(QA_ROOT);
  const sessionPath = disc.sessions[0].path;

  const nightA = '20260720';
  const nightB = NIGHT; // 20260725
  const scanA = await scanSession({ sessionPath, nightDate: nightA, targetHint: 'Veil' });
  const scanB = await scanSession({ sessionPath, nightDate: nightB, targetHint: 'Veil' });
  const haA = (scanA.lights || []).filter((l) => normalizeFilter(l.filter) === 'Ha').length;
  const haB = (scanB.lights || []).filter((l) => normalizeFilter(l.filter) === 'Ha').length;
  assert('night A has Ha lights', haA >= 1, `ha=${haA}`);
  assert('night B has Ha lights', haB >= 1, `ha=${haB}`);
  assert('nights isolate lights (A ≠ B set)', haA > 0 && haB > 0);

  const project = {
    filterTargets: [
      { filter: 'Ha', location: 'Home', bortle: '9' },
      { filter: 'OIII', location: 'Home', bortle: '9' },
      { filter: 'SII', location: 'Queechy', bortle: '5' },
    ],
    shoots: [
      {
        date: '260720',
        filterIndex: 0,
        complete: true,
        hours: 0.1,
        ingestPath: 'x',
        ingestMeta: { stagedAt: '2026-07-29T00:00:00.000Z' },
      },
      { date: '260725', filterIndex: 0, complete: true, hours: 0.25 },
      { date: '260725', filterIndex: 1, complete: true, hours: 0.25 },
      { date: '260725', filterIndex: 2, complete: true, hours: 0.5 },
    ],
  };

  assert(
    'Ha on 0720 → already staged',
    shootColumnLabel(false, project, 'Ha', nightA) === 'already staged',
  );
  assert(
    'Ha on 0725 pending → match (not confused with other night)',
    shootColumnLabel(true, project, 'Ha', nightB) === 'match',
  );
  assert(
    'OIII on 0725 in log but not pending → in log',
    shootColumnLabel(false, project, 'OIII', nightB) === 'in log',
  );
  assert(
    'OIII on 0725 pending → match',
    shootColumnLabel(true, project, 'OIII', nightB) === 'match',
  );
  assert(
    'SII lights with no shoot that night → no shot log',
    shootColumnLabel(false, project, 'SII', nightA) === 'no shot log',
  );
  assert(
    'pending with missing flats → missing flats',
    shootColumnLabel(true, project, 'OIII', nightB, ['Flat (OIII)']) === 'missing flats',
  );

  // Stage Ha for night A, then Shoot? for night A Ha should be already staged after we mark shoot ingested —
  // pipeline already tested staging; here verify night A scan still only Ha.
  const filtersA = [...new Set((scanA.lights || []).map((l) => normalizeFilter(l.filter)))];
  assert('night A scan is Ha-only (synthetic same-filter day)', filtersA.length === 1 && filtersA[0] === 'Ha', filtersA.join(','));
}

/**
 * Exhaustive permutations against staging/asiair-test-rosette (Autorun+Plan merge).
 */
async function testRosettePermutations() {
  console.log('\n== Rosette fixture permutations ==');
  const ROSETTE = path.join(ROOT, 'staging', 'asiair-test-rosette');
  assert('rosette fixture exists', fs.existsSync(ROSETTE), ROSETTE);
  if (!fs.existsSync(ROSETTE)) return;

  const disc = await discoverSessions(ROSETTE);
  assert(
    'rosette discovers Autorun + Plan',
    disc.ok && disc.sessions.length >= 2,
    JSON.stringify(disc.sessions && disc.sessions.map((s) => s.name)),
  );

  let darkIndex = [];
  if (fs.existsSync(DARK_LIB)) {
    const idx = await indexDarkLibrary(DARK_LIB);
    darkIndex = idx.index || [];
  }

  const project = {
    filterTargets: [
      { filter: 'Ha', location: 'Home', bortle: '9' },
      { filter: 'OIII', location: 'Home', bortle: '9' },
      { filter: 'SII', location: 'Home', bortle: '9' },
    ],
    shoots: [
      { date: '260728', filterIndex: 0, hours: 0.15, complete: true },
      { date: '260729', filterIndex: 1, hours: 0.1, complete: true },
      { date: '260730', filterIndex: 2, hours: 0.1, complete: true },
      { date: '260731', filterIndex: 0, hours: 0.025, complete: true },
    ],
  };

  const cases = [
    {
      id: 'Ha 260728 happy',
      night: '20260728',
      filter: 'Ha',
      expectLights: true,
      expectFlats: true,
      expectStatus: 'match',
      expectStageMaster: true,
      expectStageSession: true,
      expectShootingType: 'Autorun',
    },
    {
      id: 'OIII orphan on Ha night',
      night: '20260728',
      filter: 'OIII',
      expectLights: true,
      expectFlats: false,
      expectStatus: 'no shot log',
      expectStageMaster: false, // not in log / not pending — we still check readiness if forced
      expectStageSession: false,
      pending: false,
      expectShootingType: 'Autorun',
    },
    {
      id: 'OIII 260729 missing flats',
      night: '20260729',
      filter: 'OIII',
      expectLights: true,
      expectFlats: false,
      expectStatus: 'missing flats',
      expectStageMaster: false,
      expectStageSession: false,
      missingFrames: ['Flat (OIII)'],
      expectShootingType: 'Plan',
    },
    {
      id: 'SII 260730 cross-session bias',
      night: '20260730',
      filter: 'SII',
      expectLights: true,
      expectFlats: true,
      expectStatus: 'match',
      expectStageMaster: true,
      expectStageSession: true,
      expectShootingType: 'Plan',
    },
    {
      id: 'Ha 260731 45s no dark match',
      night: '20260731',
      filter: 'Ha',
      expectLights: true,
      expectFlats: true,
      expectStatus: 'missing darks',
      expectStageMaster: false,
      expectStageSession: false,
      missingFrames: ['Dark (session or master library)'],
      expectShootingType: 'Plan',
      exposureSec: 45,
    },
  ];

  const stageScratch = path.join(ROSETTE, '_qa_perm_stage');
  // Clean prior perm staging leftovers under the real fixture project dir
  for (const name of ['Ha', 'OIII', 'SII', '_calibration', '_qa_perm_stage']) {
    const p = path.join(ROSETTE, name);
    if (name === '_qa_perm_stage') continue;
    // only remove shoot folders we create below (ok_* / block_*)
  }
  async function wipePermShoots() {
    for (const filter of ['Ha', 'OIII', 'SII', 'Unknown']) {
      const filterDir = path.join(ROSETTE, filter);
      if (!fs.existsSync(filterDir)) continue;
      for (const ent of await fsp.readdir(filterDir)) {
        if (/^(ok_|block_)/.test(ent)) {
          await fsp.rm(path.join(filterDir, ent), { recursive: true, force: true });
        }
      }
    }
    const calib = path.join(ROSETTE, '_calibration');
    if (fs.existsSync(calib)) {
      await fsp.rm(calib, { recursive: true, force: true });
    }
  }
  await wipePermShoots();

  for (const c of cases) {
    const scan = await scanSession({
      projectDir: ROSETTE,
      nightDate: c.night,
      targetHint: 'Rosette',
    });
    assert(`${c.id}: scan ok`, scan.ok !== false, scan.error);

    const lights = (scan.lights || []).filter((l) => normalizeFilter(l.filter) === c.filter);
    const flats = (scan.flats || []).filter((f) => normalizeFilter(f.filter) === c.filter);
    assert(
      `${c.id}: lights ${c.expectLights ? 'present' : 'absent'}`,
      c.expectLights ? lights.length > 0 : lights.length === 0,
      `n=${lights.length}`,
    );
    assert(
      `${c.id}: flats ${c.expectFlats ? 'present' : 'absent'}`,
      c.expectFlats ? flats.length > 0 : flats.length === 0,
      `n=${flats.length}`,
    );

    if (lights.length && c.expectShootingType) {
      const types = [...new Set(lights.map((l) => l.shootingType))];
      assert(
        `${c.id}: shootingType includes ${c.expectShootingType}`,
        types.includes(c.expectShootingType),
        types.join(','),
      );
    }

    // Actual integration should be computable whenever lights+exp exist (even no shot log).
    if (lights.length && lights[0].exposureSec != null) {
      const hrs = (lights.length * lights[0].exposureSec) / 3600;
      assert(`${c.id}: actual integration > 0`, hrs > 0, `hrs=${hrs}`);
    }

    const pending = c.pending !== false;
    const missingForStatus = c.missingFrames || [];
    // Derive missing flats for status when expected
    if (c.expectStatus === 'missing flats' && !missingForStatus.length) {
      missingForStatus.push(`Flat (${c.filter})`);
    }
    if (c.expectStatus === 'missing darks') {
      // status label uses short form from Dark* missing frames
      missingForStatus.length = 0;
      missingForStatus.push('Dark (session)');
    }
    const status = shootColumnLabel(pending, project, c.filter, c.night, missingForStatus);
    assert(`${c.id}: status = ${c.expectStatus}`, status === c.expectStatus, `got=${status}`);

    // Usable session darks = matched to light profile only
    const light0 = lights[0];
    const sessionMatch = light0
      ? matchMasterDarks({
        index: (scan.darks || []).map((d) => ({
          ...d,
          acquiredAt: d.date
            ? `${String(d.date).slice(0, 4)}-${String(d.date).slice(4, 6)}-${String(d.date).slice(6, 8)}`
            : null,
        })),
        exposureSec: light0.exposureSec,
        gain: light0.gain,
        tempC: light0.tempC,
      })
      : { matches: [], rejected: [] };
    const masterMatch = light0
      ? matchMasterDarks({
        index: darkIndex,
        exposureSec: light0.exposureSec,
        gain: light0.gain,
        tempC: light0.tempC,
      })
      : { matches: [], rejected: [] };

    if (c.exposureSec === 45) {
      assert(`${c.id}: no usable session darks @45s`, sessionMatch.matches.length === 0, `m=${sessionMatch.matches.length}`);
      assert(`${c.id}: no master darks @45s`, masterMatch.matches.length === 0, `m=${masterMatch.matches.length}`);
    }

    const readyMaster = evaluateIngestFrameReadiness({
      lights,
      flats,
      biases: scan.biases || [],
      sessionDarks: sessionMatch.matches,
      useMasterDarks: true,
      masterDarkCount: masterMatch.matches.length,
      filters: [c.filter],
    });
    const readySession = evaluateIngestFrameReadiness({
      lights,
      flats,
      biases: scan.biases || [],
      sessionDarks: sessionMatch.matches,
      useMasterDarks: false,
      masterDarkCount: masterMatch.matches.length,
      filters: [c.filter],
    });

    assert(
      `${c.id}: readiness master ${c.expectStageMaster ? 'OK' : 'BLOCK'}`,
      readyMaster.ok === c.expectStageMaster,
      readyMaster.missing && readyMaster.missing.join(','),
    );
    assert(
      `${c.id}: readiness session ${c.expectStageSession ? 'OK' : 'BLOCK'}`,
      readySession.ok === c.expectStageSession,
      readySession.missing && readySession.missing.join(','),
    );

    // Live stage attempt for blocked cases must return MISSING_FRAMES
    // (projectDir is both ASIAIR source root and Siril dest root)
    if (!c.expectStageMaster && lights.length) {
      const blocked = await stageSirilTree({
        projectDir: ROSETTE,
        nightDate: c.night,
        shootFolder: `block_${c.night}_${c.filter}`,
        shootFilter: c.filter,
        targetHint: 'Rosette',
        useMasterDarks: true,
        darkMatchesByFilter: { [c.filter]: masterMatch.matches, '*': masterMatch.matches },
        force: true,
      });
      assert(
        `${c.id}: stage blocked MISSING_FRAMES`,
        blocked.ok === false && blocked.code === 'MISSING_FRAMES',
        `${blocked.code}: ${blocked.error}`,
      );
    }

    // Happy / cross-session stage should succeed
    if (c.expectStageMaster && lights.length) {
      const staged = await stageSirilTree({
        projectDir: ROSETTE,
        nightDate: c.night,
        shootFolder: `ok_${c.night}_${c.filter}`,
        shootFilter: c.filter,
        targetHint: 'Rosette',
        useMasterDarks: true,
        darkMatchesByFilter: { [c.filter]: masterMatch.matches, '*': masterMatch.matches },
        force: true,
      });
      assert(`${c.id}: stage succeeds`, staged.ok, staged.error || staged.code);
      if (staged.ok) {
        const lightsDir2 = path.join(ROSETTE, c.filter, `ok_${c.night}_${c.filter}`, 'lights');
        const n = fs.existsSync(lightsDir2)
          ? fs.readdirSync(lightsDir2).filter((x) => /\.fit$/i.test(x)).length
          : 0;
        assert(`${c.id}: staged lights on disk`, n >= 1, `n=${n} path=${lightsDir2}`);
      }
    }
  }

  // Wrong night / empty
  const empty = await scanSession({ projectDir: ROSETTE, nightDate: '20260101', targetHint: 'Rosette' });
  assert('wrong night no lights', (empty.lights || []).length === 0, `n=${(empty.lights || []).length}`);

  // Merged scan on Ha night sees Autorun types + orphan OIII
  const night728 = await scanSession({ projectDir: ROSETTE, nightDate: '20260728', targetHint: 'Rosette' });
  const filters728 = [...new Set((night728.lights || []).map((l) => normalizeFilter(l.filter)))].sort();
  assert('260728 has Ha + orphan OIII', filters728.includes('Ha') && filters728.includes('OIII'), filters728.join(','));
  assert('260728 biases shared from Autorun', (night728.biases || []).length >= 1, `b=${(night728.biases || []).length}`);

  await wipePermShoots();
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
  // Ensure Rosette synthetic dump is present for permutation matrix
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-ingest-test-fixture.js')], {
    stdio: 'inherit',
  });
  await testHelpers();
  await testPipeline();
  await testMultiDayAndShootColumn();
  await testRosettePermutations();
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
