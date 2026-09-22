'use strict';

/**
 * Multinight ASIAIR import smoke against real dumps (read-only sources).
 * Stages into staging/qa-et-multinight so Dev Elephant Trunk is not touched.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  discoverSessions,
  scanSession,
  stageSirilTree,
  indexDarkLibrary,
  matchMasterDarks,
  buildTargetFolders,
  targetMatchNeedsConfirm,
  caaMatchesFramer,
} = require('../src/ingest/asiairIngest');
const { buildSessionLogInsight, plannedLightsForFilter, parseAutorunLog } = require('../src/ingest/asiairSessionLogs');

const ROOT = path.resolve(__dirname, '..');
const ET = 'J:/Astrophotography/ASIAIRDUMP_260915';
const OLD = 'F:/ASIAIRDUMP_260816';
const DARK = fs.existsSync('F:/zuko_dev/Dark Library')
  ? 'F:/zuko_dev/Dark Library'
  : 'H:/Photography/Astrophotography/Zuko/Dark Library';
const STAGE = path.join(ROOT, 'staging', 'qa-et-multinight');

let failed = 0;
function pass(name, detail) {
  console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail) {
  failed += 1;
  console.error(`  FAIL  ${name} — ${detail || ''}`);
}
function assert(name, cond, detail) {
  if (cond) pass(name, detail);
  else fail(name, detail);
}

async function wipe(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
}

async function main() {
  console.log('=== multinight import smoke ===');
  console.log('ET', ET, fs.existsSync(ET));
  console.log('OLD', OLD, fs.existsSync(OLD));
  console.log('DARK', DARK, fs.existsSync(DARK));
  assert('ET dump present', fs.existsSync(ET));
  assert('OLD dump present', fs.existsSync(OLD));
  assert('dark library present', fs.existsSync(DARK));
  if (failed) process.exit(1);

  await wipe(STAGE);

  // --- Discover ---
  const etDisc = await discoverSessions(ET);
  assert('ET discover ok', etDisc.ok, etDisc.error);
  assert('ET has Plan+Autorun', (etDisc.sessions || []).length >= 2, JSON.stringify(etDisc.sessions));
  const oldDisc = await discoverSessions(OLD);
  assert('OLD discover ok', oldDisc.ok, oldDisc.error);
  assert('OLD has sessions', (oldDisc.sessions || []).length >= 1, JSON.stringify(oldDisc.sessions));

  // --- ET nights ---
  const etCoords = { ra: 324.8025984016353, dec: 57.578983982941566 };
  const etFramer = 281;
  for (const night of ['20260911', '20260912', '20260915']) {
    const scan = await scanSession({
      projectDir: ET,
      nightDate: night,
      targetCoords: etCoords,
      refCaaDeg: etFramer,
      includeTargets: ['IC 1396'],
      skipTargetHint: true,
    });
    assert(`ET ${night} scan ok`, scan.ok, scan.error);
    assert(`ET ${night} has lights`, (scan.lights || []).length > 0, String((scan.lights || []).length));
    assert(
      `ET ${night} no false CAA soft warn`,
      !(scan.softWarnings || []).some((w) => /CAA mismatch/i.test(w)),
      (scan.softWarnings || []).join(' | ')
    );
    const folder = (scan.targets || []).find((t) => t.folder === 'IC 1396');
    assert(`ET ${night} IC 1396 auto`, folder && folder.band === 'auto', JSON.stringify(folder));
    assert(`ET ${night} CAA match`, folder && folder.caaMatch === true, JSON.stringify(folder));
    const gate = scan.targetMatch || {};
    assert(`ET ${night} no confirm`, gate.needsConfirm === false, JSON.stringify(gate));
  }

  // --- Session log filter retag on live ET file ---
  {
    const logPath = path.join(ET, 'log', 'Autorun_Log_2026-09-15_195632.txt');
    const parsed = parseAutorunLog(fs.readFileSync(logPath, 'utf8'), logPath);
    assert('ET log SII plan 30', plannedLightsForFilter(parsed, 'SII') === 30, plannedLightsForFilter(parsed, 'SII'));
    assert('ET log OIII plan 20', plannedLightsForFilter(parsed, 'OIII') === 20, plannedLightsForFilter(parsed, 'OIII'));
    const sii = await buildSessionLogInsight({
      sourceRoot: ET,
      nightDate: '20260915',
      shootFilter: 'SII',
      refCaaDeg: etFramer,
      lightCount: 30,
      targetNames: ['IC 1396'],
    });
    assert('ET insight no planned-50 warn', !(sii.softWarnings || []).some((w) => /planned\s+50/i.test(w)), sii.softWarnings);
  }

  // --- Stage one filter/night into staging (master darks) ---
  const lib = await indexDarkLibrary(DARK);
  assert('dark index ok', lib.ok && (lib.index || []).length > 0, lib.error || String((lib.index || []).length));
  const darkMatches = matchMasterDarks({
    index: lib.index,
    exposureSec: 180,
    gain: 120,
    tempC: -10,
    bin: 2,
  }).matches;
  assert('dark matches ≥1', darkMatches.length >= 1, String(darkMatches.length));

  const stageNight = '20260915';
  for (const filter of ['SII', 'OIII']) {
    const shootFolder = `qa_${stageNight.slice(2)}_${filter}_Home`;
    const result = await stageSirilTree({
      projectDir: STAGE,
      sourceDir: ET,
      nightDate: stageNight,
      shootFolder,
      shootFilter: filter,
      useMasterDarks: true,
      darkMatchesByFilter: { '*': darkMatches },
      includeTargets: ['IC 1396'],
      targetCoords: etCoords,
      refCaaDeg: etFramer,
      framerRotation: etFramer,
      skipTargetHint: true,
      force: true,
    });
    assert(`stage ${filter} ok`, result.ok, result.error || result.code);
    const lights = result.meta && result.meta.byType && result.meta.byType.light;
    const expect = filter === 'SII' ? 30 : 20;
    assert(`stage ${filter} lights=${expect}`, lights === expect, String(lights));
    assert(
      `stage ${filter} no CAA/flat false warns`,
      !(result.softWarnings || []).some((w) => /CAA mismatch|Using .+ flat set/i.test(w)),
      (result.softWarnings || []).join(' | ')
    );
    const dest = path.join(STAGE, filter, shootFolder, 'lights');
    const n = fs.existsSync(dest) ? fs.readdirSync(dest).filter((f) => /\.fits?$/i.test(f)).length : 0;
    assert(`stage ${filter} lights on disk`, n === expect, String(n));
  }

  // --- Older dump: discover + scan a known night if present ---
  {
    const scan = await scanSession({
      projectDir: OLD,
      nightDate: '20260803',
      skipTargetHint: true,
    });
    assert('OLD 20260803 scan ok', scan.ok, scan.error);
    assert('OLD 20260803 lights or flats', ((scan.lights || []).length + (scan.flats || []).length) > 0,
      `L=${(scan.lights || []).length} F=${(scan.flats || []).length}`);
    if ((scan.lights || []).length) {
      const folders = buildTargetFolders(scan.lights, null);
      assert('OLD builds target folders', folders.length >= 1, String(folders.length));
      const gate = targetMatchNeedsConfirm(folders, { refCoords: null });
      assert('OLD gate returns', !!gate && typeof gate.needsConfirm === 'boolean', JSON.stringify(gate));
    }
    const insight = await buildSessionLogInsight({
      sourceRoot: OLD,
      nightDate: '20260803',
      shootFilter: 'Ha',
      refCaaDeg: 211,
      lightCount: 20,
      targetNames: ['Veil'],
    });
    assert('OLD insight ok', insight.ok === true, insight.softWarnings);
    assert('OLD plate matches 211', insight.digest && insight.digest.plateAngleOk === true,
      insight.digest && insight.digest.plateAngleDeg);
  }

  // Flip helper sanity
  assert('flip helper 101 vs 281', caaMatchesFramer(101, 281, 10) === true);
  assert('flip helper 271 vs 281', caaMatchesFramer(271, 281, 10) === true);
  assert('flip helper 90 vs 281', caaMatchesFramer(90, 281, 10) === false);

  if (failed) {
    console.error(`\nFAILED ${failed}`);
    process.exit(1);
  }
  console.log('\nMultinight import smoke passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
