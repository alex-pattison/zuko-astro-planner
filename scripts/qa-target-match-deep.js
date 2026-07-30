/**
 * Deep target-match / source-review / ingest permutation QA.
 * Run: node scripts/qa-target-match-deep.js
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  scanSession,
  stageSirilTree,
  discoverSessions,
  evaluateIngestFrameReadiness,
  matchMasterDarks,
  indexDarkLibrary,
  targetMatchNeedsConfirm,
  buildTargetFolders,
  TARGET_MATCH_AUTO_DEG,
  TARGET_MATCH_CONFIRM_DEG,
} = require('../src/ingest/asiairIngest');
const TM = require('../src/ingest/targetMatchProject');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'staging', 'asiair-test-target-match');
const PLANNER = { ra: 97.9792, dec: 4.9428 };
const DARK_LIB = 'H:\\Photography\\Astrophotography\\Zuko\\Dark Library';

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

async function ensureFixture() {
  require('child_process').execFileSync(
    process.execPath,
    [path.join(__dirname, 'build-target-match-fixture.js'), '--upsert'],
    { stdio: 'inherit' },
  );
}

function emptyProject(overrides = {}) {
  return {
    name: 'QA Project',
    projectDir: FIXTURE,
    filterTargets: [],
    shoots: [],
    ignoredAsiairFolders: [],
    asiairBoundFolders: [],
    savedTarget: { ...PLANNER, name: 'Rosette' },
    framerMode: 'reducer',
    framerRotation: 27,
    ...overrides,
  };
}

async function testIgnoreScope() {
  console.log('\n== Ignore scope (folder vs row) ==');
  const project = emptyProject();

  // Row ignore: only one night+filter
  TM.ignoreAsiairSourceRow(project, {
    folder: 'Maybe_Close',
    night: '20260801',
    filter: 'SII',
  }, 'source review');

  assert(
    'row ignore does NOT whole-folder ignore',
    !TM.isAsiairFolderIgnored(project, 'Maybe_Close'),
  );
  assert(
    'SII 260801 Maybe_Close is ignored',
    TM.isAsiairSourceRowIgnored(project, { folder: 'Maybe_Close', night: '20260801', filter: 'SII' }),
  );
  assert(
    'Ha 260728 Maybe_Close is NOT ignored',
    !TM.isAsiairSourceRowIgnored(project, { folder: 'Maybe_Close', night: '20260728', filter: 'Ha' }),
  );
  assert(
    'SII 260801 different folder not ignored',
    !TM.isAsiairSourceRowIgnored(project, { folder: 'Rosette_Near', night: '20260801', filter: 'SII' }),
  );

  // Unignore row only
  TM.unignoreAsiairSourceRow(project, { folder: 'Maybe_Close', night: '20260801', filter: 'SII' });
  assert(
    'unignore clears that row only',
    !TM.isAsiairSourceRowIgnored(project, { folder: 'Maybe_Close', night: '20260801', filter: 'SII' }),
  );

  // Whole-folder ignore (confirm flow) affects all rows
  TM.ignoreAsiairFolder(project, { folder: 'Orion_Far', name: 'Orion' }, 'confirm');
  assert('whole folder ignored', TM.isAsiairFolderIgnored(project, 'Orion_Far'));
  assert(
    'whole folder marks any Orion row ignored',
    TM.isAsiairSourceRowIgnored(project, { folder: 'Orion_Far', night: '20260728', filter: 'Ha' })
      && TM.isAsiairSourceRowIgnored(project, { folder: 'Orion_Far', night: '20260729', filter: 'Ha' }),
  );

  // Unignore from a row when whole-folder: removes whole-folder entry
  TM.unignoreAsiairSourceRow(project, { folder: 'Orion_Far', night: '20260728', filter: 'Ha' });
  assert('unignore row clears whole-folder entry', !TM.isAsiairFolderIgnored(project, 'Orion_Far'));
  assert(
    'other Orion nights also unignored',
    !TM.isAsiairSourceRowIgnored(project, { folder: 'Orion_Far', night: '20260729', filter: 'Ha' }),
  );

  // Idempotent row ignore
  TM.ignoreAsiairSourceRow(project, { folder: 'Maybe_Close', night: '20260728', filter: 'Ha' }, 'a');
  TM.ignoreAsiairSourceRow(project, { folder: 'Maybe_Close', night: '20260728', filter: 'Ha' }, 'b');
  assert(
    'row ignore idempotent',
    project.ignoredAsiairFolders.filter((x) => x.folder === 'Maybe_Close' && x.night === '20260728').length === 1,
  );
}

async function testCreateShootFeedback() {
  console.log('\n== Create shoot log / dedupe ==');
  const project = emptyProject({
    filterTargets: [{ filter: 'Ha', location: '—', bortle: '', targetHrs: 0.5, loggedHrs: 0 }],
    shoots: [],
  });
  const scan = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260728',
    skipTargetHint: true,
    targetCoords: PLANNER,
  });
  const maybeLights = (scan.lights || []).filter((L) => (L.targetFolder || L.target) === 'Maybe_Close');
  assert('Maybe_Close lights on 728', maybeLights.length >= 1, `n=${maybeLights.length}`);

  const r1 = TM.createShootLogsFromLights(project, maybeLights, { folder: 'Maybe_Close', addMissingFilters: true });
  assert('first create adds shoot', r1.created.length === 1, JSON.stringify(r1));
  assert('shoot date YYMMDD', project.shoots[0].date === '260728', project.shoots[0].date);
  assert('shoot complete', project.shoots[0].complete === true);

  const r2 = TM.createShootLogsFromLights(project, maybeLights, { folder: 'Maybe_Close', addMissingFilters: true });
  assert('second create skipped already in log', r2.created.length === 0 && /already in log/.test(r2.skipped.join(' ')), JSON.stringify(r2));
  assert('still one shoot row', project.shoots.length === 1);
}

async function testNewProjectAndBound() {
  console.log('\n== New project + bound folders (no re-confirm) ==');
  const scan = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260728',
    skipTargetHint: true,
    targetCoords: PLANNER,
  });
  const folderRow = (scan.targets || []).find((t) => t.folder === 'Maybe_Close');
  const parent = emptyProject({
    filterTargets: [
      { filter: 'Ha', location: 'Home', bortle: '9', targetHrs: 10, loggedHrs: 1 },
      { filter: 'OIII', location: 'Home', bortle: '9', targetHrs: 10, loggedHrs: 0 },
      { filter: 'SII', location: 'Home', bortle: '9', targetHrs: 10, loggedHrs: 0 },
    ],
  });
  const neu = TM.buildNewProjectFromFolder(parent, folderRow, scan.lights, { notes: 'qa' });
  assert('only Ha filter target', neu.filterTargets.length === 1 && neu.filterTargets[0].filter === 'Ha');
  assert('bound Maybe_Close', neu.asiairBoundFolders.includes('Maybe_Close'));
  assert('savedTarget ≈ folder', Math.abs(neu.savedTarget.ra - folderRow.medianRa) < 0.02);
  assert('framer from ROTATOR', Math.abs(neu.framerRotation - 45) < 2, String(neu.framerRotation));

  const bound = TM.resolveBoundIncludes(neu, scan.targets);
  assert('bound resolves to Maybe only', bound.includes.join(',') === 'Maybe_Close');

  // Full night scan still sees siblings, but with includeTargets only Maybe stages without confirm gate
  const gated = await stageSirilTree({
    projectDir: FIXTURE,
    nightDate: '20260728',
    shootFolder: 'deep_maybe',
    shootFilter: 'Ha',
    targetCoords: neu.savedTarget,
    includeTargets: bound.includes,
    skipTargetHint: true,
    force: true,
  });
  assert('bound stage not CONFIRM_REQUIRED', gated.code !== 'TARGET_CONFIRM_REQUIRED', `${gated.code}: ${gated.error}`);

  // Without includes + far planner coords → confirm required
  const blocked = await stageSirilTree({
    projectDir: FIXTURE,
    nightDate: '20260728',
    shootFolder: 'deep_block',
    shootFilter: 'Ha',
    targetCoords: { ra: 10, dec: -10 },
    skipTargetHint: true,
    force: true,
  });
  assert('uncertain stage CONFIRM_REQUIRED', blocked.code === 'TARGET_CONFIRM_REQUIRED');
}

async function testAssignExisting() {
  console.log('\n== Assign to existing project ==');
  const scan = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260728',
    skipTargetHint: true,
    targetCoords: PLANNER,
  });
  const orion = (scan.targets || []).find((t) => t.folder === 'Orion_Far');
  const lights = (scan.lights || []).filter((L) => (L.targetFolder || L.target) === 'Orion_Far');
  const dest = emptyProject({
    projectDir: null,
    savedTarget: null,
    ignoredAsiairFolders: [{ folder: 'Orion_Far', night: null, filter: null, note: 'stale whole' }],
  });
  const res = TM.assignFolderToProject(dest, orion, lights, { projectDir: FIXTURE });
  assert('assign created', res.created.length >= 1, JSON.stringify(res.created));
  assert('dir set', dest.projectDir === FIXTURE);
  assert('bound', dest.asiairBoundFolders.includes('Orion_Far'));
  assert('ignore cleared on dest', !TM.isAsiairFolderIgnored(dest, 'Orion_Far'));
  const res2 = TM.assignFolderToProject(dest, orion, lights, { projectDir: FIXTURE });
  assert('dedupe on reassign', res2.created.length === 0 && res2.skipped.length >= 1);
}

async function testBandsRotatorPermutations() {
  console.log('\n== Band / ROTATOR night permutations ==');
  const nights = ['20260728', '20260729', '20260730', '20260731', '20260801'];
  for (const night of nights) {
    const scan = await scanSession({
      projectDir: FIXTURE,
      nightDate: night,
      skipTargetHint: true,
      targetCoords: PLANNER,
    });
    assert(`${night} scan ok`, scan.ok, scan.error);
    assert(`${night} has targets or empty lights ok`, Array.isArray(scan.targets));
    for (const t of scan.targets || []) {
      if (t.band === 'auto' || t.band === 'confirm' || t.band === 'other') {
        assert(`${night} ${t.folder} has coords`, t.medianRa != null && t.medianDec != null);
      }
      if (t.folder !== 'Mystery_NoCoords') {
        assert(`${night} ${t.folder} has ROTATOR`, t.medianRotatorDeg != null, JSON.stringify(t));
      }
    }
  }

  const s728 = await scanSession({
    projectDir: FIXTURE, nightDate: '20260728', skipTargetHint: true, targetCoords: PLANNER,
  });
  const by = Object.fromEntries((s728.targets || []).map((t) => [t.folder, t]));
  assert('728 Near auto @27', by.Rosette_Near?.band === 'auto' && Math.abs(by.Rosette_Near.medianRotatorDeg - 27) < 2);
  assert('728 Maybe confirm @45', by.Maybe_Close?.band === 'confirm' && Math.abs(by.Maybe_Close.medianRotatorDeg - 45) < 2);
  assert('728 Orion other', by.Orion_Far?.band === 'other');
  assert('728 Mystery no_coords', by.Mystery_NoCoords?.band === 'no_coords');

  const s730 = await scanSession({
    projectDir: FIXTURE, nightDate: '20260730', skipTargetHint: true, targetCoords: PLANNER,
  });
  const rot = (s730.targets || []).find((t) => t.folder === 'Rosette_Rotated');
  assert('730 Rotated auto @209', rot?.band === 'auto' && Math.abs(rot.medianRotatorDeg - 209) < 2);
}

async function testIncludeTargetsIsolation() {
  console.log('\n== includeTargets isolation ==');
  const nearOnly = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260728',
    skipTargetHint: true,
    targetCoords: PLANNER,
    includeTargets: ['Rosette_Near'],
  });
  assert(
    'only Near lights',
    (nearOnly.lights || []).length >= 1
      && (nearOnly.lights || []).every((L) => (L.targetFolder || L.target) === 'Rosette_Near'),
    `n=${(nearOnly.lights || []).length}`,
  );

  const empty = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260728',
    skipTargetHint: true,
    targetCoords: PLANNER,
    includeTargets: ['__nope__'],
  });
  assert('bogus include → 0 lights', (empty.lights || []).length === 0);

  const multi = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260728',
    skipTargetHint: true,
    targetCoords: PLANNER,
    includeTargets: ['Rosette_Near', 'Maybe_Close'],
  });
  const folders = new Set((multi.lights || []).map((L) => L.targetFolder || L.target));
  assert('multi include Near+Maybe', folders.has('Rosette_Near') && folders.has('Maybe_Close') && !folders.has('Orion_Far'), [...folders].join(','));
}

async function testIntegrationTone() {
  console.log('\n== Integration tone ==');
  assert('under yellow', TM.integrationTone(0.4, 1) === 'under');
  assert('at green', TM.integrationTone(1, 1) === 'ok');
  assert('over green', TM.integrationTone(3, 1) === 'ok');
}

async function testDiscoverAndReadiness() {
  console.log('\n== Discover / readiness on fixture ==');
  const disc = await discoverSessions(FIXTURE);
  assert('discover ok', disc.ok && (disc.sessions || []).length >= 1, JSON.stringify(disc.sessions?.map((s) => s.name)));

  const scan = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260728',
    skipTargetHint: true,
    targetCoords: PLANNER,
    includeTargets: ['Rosette_Near'],
  });
  const lights = scan.lights || [];
  const flats = (scan.flats || []).filter((f) => f.filter === 'Ha');
  const biases = scan.biases || [];
  const darks = scan.darks || [];
  assert('Near has lights', lights.length >= 1);
  assert('shared flats', flats.length >= 1);
  assert('shared biases', biases.length >= 1);
  assert('session darks', darks.length >= 1);

  let master = { matches: [] };
  if (fs.existsSync(DARK_LIB)) {
    const idx = await indexDarkLibrary(DARK_LIB);
    if (idx.ok) {
      master = await matchMasterDarks({
        index: idx.index,
        exposureSec: lights[0].exposureSec,
        gain: lights[0].gain,
        tempC: lights[0].tempC,
      });
    }
  }
  const ready = evaluateIngestFrameReadiness({
    lights,
    flats,
    biases,
    sessionDarks: darks,
    masterDarkCount: (master.matches || []).length,
    filters: ['Ha'],
  });
  assert('readiness with Near+calib', ready.ok === true || (ready.missing && ready.missing.length), JSON.stringify(ready));
}

async function testWeirdConflicts() {
  console.log('\n== Weird source conflicts ==');
  // No savedTarget, multi folder → needs confirm
  const noRef = buildTargetFolders([
    { targetFolder: 'A', ra: 10, dec: 10 },
    { targetFolder: 'B', ra: 20, dec: 20 },
  ], null);
  const g1 = targetMatchNeedsConfirm(noRef, { refCoords: null });
  assert('no ref multi needs confirm', g1.needsConfirm && g1.reason === 'no_saved_target_multi_folder', g1.reason);

  // Single no coords → assumed
  const g2 = targetMatchNeedsConfirm(
    [{ folder: 'Only', band: 'no_coords', separationDeg: null }],
    { refCoords: null },
  );
  assert('single no_coords assumed', !g2.needsConfirm && g2.reason === 'assumed_single', g2.reason);

  // Multiple autos → confirm
  const g3 = targetMatchNeedsConfirm(
    [
      { folder: 'A', band: 'auto', separationDeg: 0.1 },
      { folder: 'B', band: 'auto', separationDeg: 0.2 },
    ],
    { refCoords: PLANNER },
  );
  assert('multiple auto needs confirm', g3.needsConfirm && g3.reason === 'multiple_auto', g3.reason);

  // Auto + confirm sibling → no popup (siblings silently excluded)
  const gAutoSib = targetMatchNeedsConfirm(
    [
      { folder: 'Near', band: 'auto', separationDeg: 0.2 },
      { folder: 'Maybe', band: 'confirm', separationDeg: 1.2 },
      { folder: 'Mystery', band: 'no_coords', separationDeg: null },
    ],
    { refCoords: PLANNER },
  );
  assert('auto+siblings no confirm', !gAutoSib.needsConfirm && gAutoSib.reason === 'confident', gAutoSib.reason);

  // Bound missing folder
  const proj = emptyProject({ asiairBoundFolders: ['DoesNotExist'] });
  const scan = await scanSession({
    projectDir: FIXTURE, nightDate: '20260728', skipTargetHint: true, targetCoords: PLANNER,
  });
  const missing = TM.resolveBoundIncludes(proj, scan.targets);
  assert('bound missing → empty includes', missing.includes.length === 0 && missing.reason === 'bound_missing', JSON.stringify(missing));

  // Row ignore must not hide folder from target-confirm whole-folder checks
  const p2 = emptyProject();
  TM.ignoreAsiairSourceRow(p2, { folder: 'Maybe_Close', night: '20260801', filter: 'SII' }, 'row');
  const targets = (scan.targets || []).filter((t) => !TM.isAsiairFolderIgnored(p2, t.folder));
  assert('row ignore keeps Maybe_Close in confirm candidates', targets.some((t) => t.folder === 'Maybe_Close'));
}

async function testParentIgnoreOnNewProject() {
  console.log('\n== Parent ignore after new_project / assign ==');
  const parent = emptyProject();
  TM.ignoreAsiairFolder(parent, { folder: 'Maybe_Close' }, 'moved to new project');
  assert('parent whole-folder ignores Maybe', TM.isAsiairFolderIgnored(parent, 'Maybe_Close'));
  // Row-level on parent for different folder shouldn't affect
  TM.ignoreAsiairSourceRow(parent, { folder: 'Orion_Far', night: '20260728', filter: 'Ha' }, 'row');
  assert('Orion still not whole-folder ignored', !TM.isAsiairFolderIgnored(parent, 'Orion_Far'));
  assert('Orion row ignored', TM.isAsiairSourceRowIgnored(parent, { folder: 'Orion_Far', night: '20260728', filter: 'Ha' }));
}

async function main() {
  console.log('Zuko DEEP target-match QA');
  await ensureFixture();

  await testIgnoreScope();
  await testCreateShootFeedback();
  await testNewProjectAndBound();
  await testAssignExisting();
  await testBandsRotatorPermutations();
  await testIncludeTargetsIsolation();
  await testIntegrationTone();
  await testDiscoverAndReadiness();
  await testWeirdConflicts();
  await testParentIgnoreOnNewProject();

  // Also run the focused + ASIAIR suites
  console.log('\n== Nested: qa-target-match-flow ==');
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'qa-target-match-flow.js')], { stdio: 'inherit' });
  console.log('\n== Nested: qa-asiair-ingest ==');
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'qa-asiair-ingest.js')], { stdio: 'inherit' });

  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);
  console.log(`\n== DEEP Summary: ${passed.length} passed, ${failed.length} failed ==`);
  if (failed.length) {
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
  }
  const reportPath = path.join(ROOT, 'staging', 'asiair-target-match-deep-qa-report.json');
  await fsp.writeFile(reportPath, JSON.stringify({
    at: new Date().toISOString(),
    passed: passed.length,
    failed: failed.length,
    results,
  }, null, 2));
  console.log('Wrote', reportPath);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
