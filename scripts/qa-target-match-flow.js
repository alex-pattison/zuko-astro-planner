/**
 * Target-match flow QA: bands, ROTATOR, new/assign project, bound folders,
 * shoot-log dedupe, integration tone.
 *
 * Usage: node scripts/qa-target-match-flow.js
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  scanSession,
  stageSirilTree,
  buildTargetFolders,
  targetMatchNeedsConfirm,
  angularSeparationDeg,
  TARGET_MATCH_AUTO_DEG,
  TARGET_MATCH_CONFIRM_DEG,
} = require('../src/ingest/asiairIngest');
const TM = require('../src/ingest/targetMatchProject');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'staging', 'asiair-test-target-match');
const PLANNER = { ra: 97.9792, dec: 4.9428 };

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
  if (!fs.existsSync(FIXTURE)) {
    require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-target-match-fixture.js')], {
      stdio: 'inherit',
    });
  }
}

async function testIntegrationTone() {
  console.log('\n== Integration tone (over target = green) ==');
  assert('under is under', TM.integrationTone(0.5, 1) === 'under');
  assert('exact is ok', TM.integrationTone(1, 1) === 'ok');
  assert('slightly over is ok', TM.integrationTone(1.1, 1) === 'ok');
  assert('way over is ok', TM.integrationTone(5, 1) === 'ok');
  assert('no plan is na', TM.integrationTone(1, 0) === 'na');
}

async function testBandsAndRotator() {
  console.log('\n== Scan bands + ROTATOR ==');
  const s728 = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260728',
    skipTargetHint: true,
    targetCoords: PLANNER,
  });
  assert('728 scan ok', s728.ok, s728.error);
  const by = Object.fromEntries((s728.targets || []).map((t) => [t.folder, t]));
  assert('Near auto', by.Rosette_Near && by.Rosette_Near.band === 'auto', JSON.stringify(by.Rosette_Near));
  assert('Near ROTATOR ~27', by.Rosette_Near && Math.abs(by.Rosette_Near.medianRotatorDeg - 27) < 2, String(by.Rosette_Near && by.Rosette_Near.medianRotatorDeg));
  assert('Maybe_Close confirm', by.Maybe_Close && by.Maybe_Close.band === 'confirm');
  assert('Maybe ROTATOR ~45', by.Maybe_Close && Math.abs(by.Maybe_Close.medianRotatorDeg - 45) < 2, String(by.Maybe_Close && by.Maybe_Close.medianRotatorDeg));
  assert('Orion other', by.Orion_Far && by.Orion_Far.band === 'other');
  assert('auto present → no confirm popup', s728.targetMatch && !s728.targetMatch.needsConfirm, JSON.stringify(s728.targetMatch));
  assert('auto reason confident', s728.targetMatch && s728.targetMatch.reason === 'confident', JSON.stringify(s728.targetMatch));

  const s730 = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260730',
    skipTargetHint: true,
    targetCoords: PLANNER,
  });
  const rot = (s730.targets || []).find((t) => t.folder === 'Rosette_Rotated');
  assert('730 Rotated auto', rot && rot.band === 'auto', JSON.stringify(rot));
  assert('730 ROTATOR ~209', rot && Math.abs(rot.medianRotatorDeg - 209) < 2, String(rot && rot.medianRotatorDeg));
}

async function testNewProjectFromFolder() {
  console.log('\n== New project from folder ==');
  const scan = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260728',
    skipTargetHint: true,
    targetCoords: PLANNER,
  });
  const folderRow = (scan.targets || []).find((t) => t.folder === 'Maybe_Close');
  assert('Maybe_Close folder row', !!folderRow);

  const source = {
    name: 'Parent',
    projectDir: FIXTURE,
    frameMode: 'Reducer',
    framerMode: 'reducer',
    framerRotation: 27,
    filterTargets: [
      { filter: 'Ha', location: 'Home', bortle: '9', targetHrs: 10, loggedHrs: 1 },
      { filter: 'OIII', location: 'Home', bortle: '9', targetHrs: 10, loggedHrs: 0 },
      { filter: 'SII', location: 'Home', bortle: '9', targetHrs: 10, loggedHrs: 0 },
    ],
  };

  const neu = TM.buildNewProjectFromFolder(source, folderRow, scan.lights, {
    notes: 'qa',
  });

  assert('new project name from folder', /Maybe/i.test(neu.name), neu.name);
  assert(
    'filterTargets only from lights (Ha only on 728 for Maybe)',
    neu.filterTargets.length === 1 && neu.filterTargets[0].filter === 'Ha',
    JSON.stringify(neu.filterTargets.map((f) => f.filter))
  );
  assert('does NOT inherit parent OIII/SII presets', !neu.filterTargets.some((f) => f.filter === 'OIII' || f.filter === 'SII'));
  assert('savedTarget from folder median', neu.savedTarget && Math.abs(neu.savedTarget.ra - folderRow.medianRa) < 0.01);
  assert('framerRotation from ROTATOR', Math.abs(neu.framerRotation - 45) < 2, String(neu.framerRotation));
  assert('asiairBoundFolders set', neu.asiairBoundFolders && neu.asiairBoundFolders[0] === 'Maybe_Close', JSON.stringify(neu.asiairBoundFolders));
  assert('shoot logs created', (neu.shoots || []).length >= 1, String((neu.shoots || []).length));
  assert('shoot complete', neu.shoots.every((s) => s.complete));

  // Bound includes: shared dump should not need confirm for siblings
  const bound = TM.resolveBoundIncludes(neu, scan.targets);
  assert('bound includes only Maybe_Close', bound && bound.includes.length === 1 && bound.includes[0] === 'Maybe_Close', JSON.stringify(bound));

  // Simulate resolve: with bound folders, scan against new savedTarget → auto + no sibling prompt needed
  const rescan = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260728',
    skipTargetHint: true,
    targetCoords: neu.savedTarget,
    includeTargets: bound.includes,
  });
  assert('bound includeTargets scan lights only Maybe', (rescan.lights || []).every((L) => (L.targetFolder || L.target) === 'Maybe_Close'), `n=${(rescan.lights || []).length}`);
  assert('bound scan has lights', (rescan.lights || []).length >= 1);

  // Stage should work without TARGET_CONFIRM_REQUIRED when includes provided
  const staged = await stageSirilTree({
    projectDir: FIXTURE,
    nightDate: '20260728',
    shootFolder: 'qa_maybe_close',
    shootFilter: 'Ha',
    includeTargets: ['Maybe_Close'],
    targetCoords: neu.savedTarget,
    skipTargetHint: true,
    useMasterDarks: false,
    force: true,
  });
  // May fail MISSING_FRAMES if no usable darks for session — that's ok if not TARGET_CONFIRM
  assert(
    'stage not TARGET_CONFIRM_REQUIRED',
    !(staged && staged.code === 'TARGET_CONFIRM_REQUIRED'),
    `${staged.code}: ${staged.error}`
  );
}

async function testAssignToExisting() {
  console.log('\n== Assign folder to existing project ==');
  // Use 260728 — Orion exists there; 260729 scan can bleed next-night autos and auto-filter.
  const scan = await scanSession({
    projectDir: FIXTURE,
    nightDate: '20260728',
    skipTargetHint: true,
    targetCoords: PLANNER,
  });
  const orion = (scan.targets || []).find((t) => t.folder === 'Orion_Far');
  assert('Orion folder', !!orion);
  const orionLights = (scan.lights || []).filter((L) => (L.targetFolder || L.target) === 'Orion_Far');
  assert('Orion lights present', orionLights.length >= 1, `n=${orionLights.length}`);

  const dest = {
    name: 'Existing Orion Project',
    projectDir: null,
    filterTargets: [],
    shoots: [],
    ignoredAsiairFolders: [{ folder: 'Orion_Far', note: 'stale' }],
    asiairBoundFolders: [],
    framerRotation: 0,
  };

  const res = TM.assignFolderToProject(dest, orion, orionLights, { projectDir: FIXTURE });
  assert('assign created shoots', res.created.length >= 1, JSON.stringify(res));
  assert('projectDir inherited', dest.projectDir === FIXTURE);
  assert('savedTarget set from Orion', dest.savedTarget && dest.savedTarget.ra != null);
  assert('bound folder', dest.asiairBoundFolders.includes('Orion_Far'));
  assert('cleared ignore on dest', !dest.ignoredAsiairFolders.some((x) => x.folder === 'Orion_Far'));
  assert('filterTargets from lights only', dest.filterTargets.every((f) => f.filter === 'Ha'), JSON.stringify(dest.filterTargets));

  const res2 = TM.assignFolderToProject(dest, orion, orionLights, { projectDir: FIXTURE });
  assert('second assign skips already in log', res2.created.length === 0 && res2.skipped.some((s) => /already in log/.test(s)), JSON.stringify(res2));
}

async function testIgnoreAndShootDedupe() {
  console.log('\n== Ignore + shoot log dedupe ==');
  const project = {
    filterTargets: [{ filter: 'Ha', location: '—', bortle: '', targetHrs: 0, loggedHrs: 0 }],
    shoots: [{ date: '260728', filterIndex: 0, hours: 0.1, complete: true }],
    ignoredAsiairFolders: [],
  };
  assert('hasShootLog true', TM.hasShootLogForFilterNight(project, 'Ha', '20260728'));
  assert('hasShootLog false other night', !TM.hasShootLogForFilterNight(project, 'Ha', '20260729'));

  const lights = [
    { night: '20260728', filter: 'Ha', exposureSec: 180, targetFolder: 'X' },
    { night: '20260728', filter: 'Ha', exposureSec: 180, targetFolder: 'X' },
  ];
  const r = TM.createShootLogsFromLights(project, lights, { folder: 'X', addMissingFilters: true });
  assert('skips existing shoot log', r.created.length === 0 && /already in log/.test(r.skipped.join(' ')), JSON.stringify(r));

  TM.ignoreAsiairFolder(project, { folder: 'Orion_Far', name: 'Orion' }, 'qa');
  assert('ignored flagged', TM.isAsiairFolderIgnored(project, 'Orion_Far'));
  TM.ignoreAsiairFolder(project, { folder: 'Orion_Far' }, 'again');
  assert('ignore idempotent', project.ignoredAsiairFolders.filter((x) => x.folder === 'Orion_Far').length === 1);
}

async function testStageConfirmGate() {
  console.log('\n== Stage confirm gate ==');
  const blocked = await stageSirilTree({
    projectDir: FIXTURE,
    nightDate: '20260728',
    shootFolder: 'qa_block',
    shootFilter: 'Ha',
    targetCoords: { ra: 100, dec: -40 },
    skipTargetHint: true,
    force: true,
  });
  assert('uncertain without includes blocked', blocked.ok === false && blocked.code === 'TARGET_CONFIRM_REQUIRED', `${blocked.code}`);

  const okIncludes = await stageSirilTree({
    projectDir: FIXTURE,
    nightDate: '20260728',
    shootFolder: 'qa_near_inc',
    shootFilter: 'Ha',
    includeTargets: ['Rosette_Near'],
    targetCoords: PLANNER,
    skipTargetHint: true,
    force: true,
  });
  assert(
    'with includeTargets not CONFIRM_REQUIRED',
    !(okIncludes && okIncludes.code === 'TARGET_CONFIRM_REQUIRED'),
    `${okIncludes.code}: ${okIncludes.error}`
  );
}

async function main() {
  console.log('Zuko target-match flow QA');
  await ensureFixture();
  await testIntegrationTone();
  await testBandsAndRotator();
  await testNewProjectFromFolder();
  await testAssignToExisting();
  await testIgnoreAndShootDedupe();
  await testStageConfirmGate();

  // Also run existing ingest QA suite section via require? Keep separate — call out.
  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);
  console.log(`\n== Summary: ${passed.length} passed, ${failed.length} failed ==`);
  if (failed.length) {
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
  }
  const reportPath = path.join(ROOT, 'staging', 'asiair-target-match-qa-report.json');
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
