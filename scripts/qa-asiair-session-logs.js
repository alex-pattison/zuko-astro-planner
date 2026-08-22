#!/usr/bin/env node
/**
 * Unit QA for ASIAIR Autorun / Plan / PHD2 session log parsers + insight.
 * Prefers Desktop asiaIRDUMP/log; falls back to fixtures under scripts/fixtures.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  parseAutorunLog,
  parsePhd2GuideLog,
  buildSessionLogInsight,
  findLogDirs,
  normalizeFilterLetter,
  caaMatchesFramer,
  plannedLightsForFilter,
  copySessionLogsToShootDirs,
} = require('../src/ingest/asiairSessionLogs');

let failed = 0;
function pass(name) {
  console.log('  ok ', name);
}
function fail(name, detail) {
  failed += 1;
  console.error('  FAIL', name, detail || '');
}
function check(name, cond, detail) {
  if (cond) pass(name);
  else fail(name, detail);
}

const DUMP =
  process.env.ASIAIR_QA_SRC
  || path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', 'asiaIRDUMP');
const LOG_DIR = path.join(DUMP, 'log');

console.log('=== qa-asiair-session-logs ===');
console.log('log dir:', LOG_DIR, fs.existsSync(LOG_DIR) ? '(exists)' : '(MISSING)');

check('normalizeFilterLetter H→Ha', normalizeFilterLetter('H') === 'Ha');
check('normalizeFilterLetter O→OIII', normalizeFilterLetter('O') === 'OIII');
check('caaMatchesFramer 206 vs 211', caaMatchesFramer(206.462, 211, 10) === true);
check('caaMatchesFramer 32 vs 211 flip', caaMatchesFramer(32, 211, 10) === true);
check('caaMatchesFramer 90 vs 211', caaMatchesFramer(90, 211, 10) === false);

if (!fs.existsSync(LOG_DIR)) {
  console.error('No asiaIRDUMP/log — skipping live dump tests');
  process.exit(failed ? 1 : 0);
}

const aug3 = path.join(LOG_DIR, 'Autorun_Log_2026-08-03_220222.txt');
const jul28 = path.join(LOG_DIR, 'Autorun_Log_2026-07-28_094949.txt');
const jul25 = path.join(LOG_DIR, 'Autorun_Log_2026-07-25_224541.txt');
const phdAug = path.join(LOG_DIR, 'PHD2_GuideLog_2026-08-03_214100.txt');
const phdJul20 = path.join(LOG_DIR, 'PHD2_GuideLog_2026-07-20_221134.txt');

{
  const s = parseAutorunLog(fs.readFileSync(aug3, 'utf8'), aug3);
  check('aug3 night 20260803', s.nightYmd === '20260803', s.nightYmd);
  check('aug3 plan Veilq3v2', s.plans[0] === 'Veilq3v2', JSON.stringify(s.plans));
  check('aug3 plate angle ~206', s.plateSolves[0] && Math.abs(s.plateSolves[0].angle - 206.462) < 0.01);
  check('aug3 AF 8300', s.autofocus.some((a) => a.ok && a.eafPos === 8300));
  check('aug3 planned Ha lights 20', plannedLightsForFilter(s, 'Ha') === 20, plannedLightsForFilter(s, 'Ha'));
  check('aug3 finished clean', s.flags.finishedClean === true);
  check('aug3 filter H', s.filterChanges.some((f) => f.to === 'Ha'));
}

{
  const s = parseAutorunLog(fs.readFileSync(jul28, 'utf8'), jul28);
  check('jul28 filter fail flagged', s.flags.filterFail === true);
  check('jul28 has failed change', s.filterChanges.some((f) => f.failed));
}

{
  const s = parseAutorunLog(fs.readFileSync(jul25, 'utf8'), jul25);
  check('jul25 paused', s.flags.paused === true);
  check('jul25 plan name', s.plans[0] === 'Veil Q3 2026');
}

{
  const g = parsePhd2GuideLog(fs.readFileSync(phdAug, 'utf8'), phdAug);
  check('phd aug night', g.nightYmd === '20260803', g.nightYmd);
  check('phd aug frames > 1000', g.frameCount > 1000, g.frameCount);
  check('phd aug has rms', g.rmsTotalArcsec != null && g.rmsTotalArcsec > 0, g.rmsTotalArcsec);
  check('phd aug quality set', ['good', 'fair', 'poor', 'unknown'].includes(g.quality), g.quality);
  console.log('    phd aug RMS″', g.rmsTotalArcsec, 'quality', g.quality, 'settleFail', g.settleFail);
}

{
  const g = parsePhd2GuideLog(fs.readFileSync(phdJul20, 'utf8'), phdJul20);
  check('phd jul20 star lost > 0', g.starLost > 0, g.starLost);
  console.log('    phd jul20 quality', g.quality, 'starLost', g.starLost, 'RMS″', g.rmsTotalArcsec);
}

(async () => {
  const dirs = await findLogDirs(DUMP);
  check('findLogDirs finds log', dirs.some((d) => /log$/i.test(d)), dirs.join('|'));

  const insight = await buildSessionLogInsight({
    sourceRoot: DUMP,
    nightDate: '20260803',
    shootFilter: 'Ha',
    refCaaDeg: 211,
    lightCount: 20,
    targetNames: ['Veil', 'NGC 6960'],
  });
  check('insight ok', insight.ok === true);
  check('insight digest plan', insight.digest && insight.digest.planName === 'Veilq3v2');
  check('insight plate ok vs 211', insight.digest && insight.digest.plateAngleOk === true);
  check('insight planned 20', insight.digest && insight.digest.plannedLights === 20);
  check('insight has guide', insight.digest && insight.digest.guide != null);
  console.log('    insights:', insight.insights);
  console.log('    warnings:', insight.softWarnings);

  // Mismatch: pretend only 10 lights staged
  const short = await buildSessionLogInsight({
    sourceRoot: DUMP,
    nightDate: '20260803',
    shootFilter: 'Ha',
    refCaaDeg: 211,
    lightCount: 10,
  });
  check(
    'short light count warns',
    (short.softWarnings || []).some((w) => /planned 20/i.test(w) && /has 10/i.test(w)),
    short.softWarnings
  );

  // CAA mismatch warning
  const badCaa = await buildSessionLogInsight({
    sourceRoot: DUMP,
    nightDate: '20260803',
    shootFilter: 'Ha',
    refCaaDeg: 90,
    lightCount: 20,
  });
  check(
    'bad CAA warns',
    (badCaa.softWarnings || []).some((w) => /plate-solve angle/i.test(w)),
    badCaa.softWarnings
  );

  // Copy into temp shoot dir
  const tmp = path.join(require('os').tmpdir(), `zuko-session-log-qa-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const copied = await copySessionLogsToShootDirs([tmp], insight);
  check('copied logs', copied.length >= 2, copied.length);
  check(
    'digest json written',
    fs.existsSync(path.join(tmp, 'session-logs', 'session-digest.json'))
  );
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) { /* */ }

  // Filter fail night
  const failNight = await buildSessionLogInsight({
    sourceRoot: DUMP,
    nightDate: '20260728',
    shootFilter: 'L',
    lightCount: 0,
  });
  check(
    'jul28 filter fail warning',
    (failNight.softWarnings || []).some((w) => /filter change failed/i.test(w)),
    failNight.softWarnings
  );

  if (failed) {
    console.error('\nFAILED', failed);
    process.exit(1);
  }
  console.log('\nAll session-log checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
