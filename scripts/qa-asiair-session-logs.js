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

// Synthetic: ASIAIR order is Shooting → Filter change → Exposures.
// Second block must pick up the new filter, not keep the previous one.
{
  const synthetic = [
    'Log enabled at 2026/09/15 19:56:32',
    '2026/09/15 19:56:33 [Autorun|Begin] IC 1396 Start',
    '2026/09/15 19:56:57 Shooting 30 light frames, exposure 180.0s Bin2',
    '2026/09/15 19:56:57 Filter change, L change to S',
    '2026/09/15 19:58:00 Exposure 180.0s image 1#',
    '2026/09/15 21:30:47 Shooting 20 light frames, exposure 180.0s Bin2',
    '2026/09/15 21:30:47 Filter change, S change to O',
    '2026/09/15 21:33:00 Exposure 180.0s image 31#',
    '2026/09/15 22:34:45 [Autorun|End] Finish Autorun',
  ].join('\n');
  const s = parseAutorunLog(synthetic, 'synthetic-sii-oiii.txt');
  const lights = (s.shootingBlocks || []).filter((b) => b.type === 'light');
  check('synthetic two light blocks', lights.length === 2, JSON.stringify(lights));
  check('synthetic block1 SII×30', lights[0] && lights[0].filter === 'SII' && lights[0].count === 30, JSON.stringify(lights[0]));
  check('synthetic block2 OIII×20', lights[1] && lights[1].filter === 'OIII' && lights[1].count === 20, JSON.stringify(lights[1]));
  check('synthetic planned SII 30', plannedLightsForFilter(s, 'SII') === 30, plannedLightsForFilter(s, 'SII'));
  check('synthetic planned OIII 20', plannedLightsForFilter(s, 'OIII') === 20, plannedLightsForFilter(s, 'OIII'));
}

function readIfExists(fp) {
  if (!fp || !fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, 'utf8');
}

if (!fs.existsSync(LOG_DIR)) {
  console.error('No asiaIRDUMP/log — skipping live dump tests');
  process.exit(failed ? 1 : 0);
}

const aug3 = path.join(LOG_DIR, 'Autorun_Log_2026-08-03_220222.txt');
const jul28 = path.join(LOG_DIR, 'Autorun_Log_2026-07-28_094949.txt');
const jul25 = path.join(LOG_DIR, 'Autorun_Log_2026-07-25_224541.txt');
const phdAug = path.join(LOG_DIR, 'PHD2_GuideLog_2026-08-03_214100.txt');
const phdJul20 = path.join(LOG_DIR, 'PHD2_GuideLog_2026-07-20_221134.txt');
const etSep15 = path.join(LOG_DIR, 'Autorun_Log_2026-09-15_195632.txt');

{
  const text = readIfExists(aug3);
  if (!text) {
    console.log('  skip aug3 (file missing in this dump)');
  } else {
    const s = parseAutorunLog(text, aug3);
    check('aug3 night 20260803', s.nightYmd === '20260803', s.nightYmd);
    check('aug3 plan Veilq3v2', s.plans[0] === 'Veilq3v2', JSON.stringify(s.plans));
    check('aug3 plate angle ~206', s.plateSolves[0] && Math.abs(s.plateSolves[0].angle - 206.462) < 0.01);
    check('aug3 AF 8300', s.autofocus.some((a) => a.ok && a.eafPos === 8300));
    check('aug3 planned Ha lights 20', plannedLightsForFilter(s, 'Ha') === 20, plannedLightsForFilter(s, 'Ha'));
    check('aug3 finished clean', s.flags.finishedClean === true);
    check('aug3 filter H', s.filterChanges.some((f) => f.to === 'Ha'));
  }
}

{
  const text = readIfExists(jul28);
  if (!text) {
    console.log('  skip jul28 (file missing in this dump)');
  } else {
    const s = parseAutorunLog(text, jul28);
    check('jul28 filter fail flagged', s.flags.filterFail === true);
    check('jul28 has failed change', s.filterChanges.some((f) => f.failed));
  }
}

{
  const text = readIfExists(jul25);
  if (!text) {
    console.log('  skip jul25 (file missing in this dump)');
  } else {
    const s = parseAutorunLog(text, jul25);
    check('jul25 paused', s.flags.paused === true);
    check('jul25 plan name', s.plans[0] === 'Veil Q3 2026');
  }
}

{
  const text = readIfExists(phdAug);
  if (!text) {
    console.log('  skip phd aug (file missing in this dump)');
  } else {
    const g = parsePhd2GuideLog(text, phdAug);
    check('phd aug night', g.nightYmd === '20260803', g.nightYmd);
    check('phd aug frames > 1000', g.frameCount > 1000, g.frameCount);
    check('phd aug has rms', g.rmsTotalArcsec != null && g.rmsTotalArcsec > 0, g.rmsTotalArcsec);
    check('phd aug quality set', ['good', 'fair', 'poor', 'unknown'].includes(g.quality), g.quality);
    console.log('    phd aug RMS″', g.rmsTotalArcsec, 'quality', g.quality, 'settleFail', g.settleFail);
  }
}

{
  const text = readIfExists(phdJul20);
  if (!text) {
    console.log('  skip phd jul20 (file missing in this dump)');
  } else {
    const g = parsePhd2GuideLog(text, phdJul20);
    check('phd jul20 star lost > 0', g.starLost > 0, g.starLost);
    console.log('    phd jul20 quality', g.quality, 'starLost', g.starLost, 'RMS″', g.rmsTotalArcsec);
  }
}

{
  const text = readIfExists(etSep15);
  if (!text) {
    console.log('  skip ET 20260915 (file missing in this dump)');
  } else {
    const s = parseAutorunLog(text, etSep15);
    check('ET sep15 planned SII 30', plannedLightsForFilter(s, 'SII') === 30, plannedLightsForFilter(s, 'SII'));
    check('ET sep15 planned OIII 20', plannedLightsForFilter(s, 'OIII') === 20, plannedLightsForFilter(s, 'OIII'));
    const lights = (s.shootingBlocks || []).filter((b) => b.type === 'light');
    check(
      'ET sep15 blocks are SII then OIII',
      lights.length >= 2 && lights[0].filter === 'SII' && lights[1].filter === 'OIII',
      JSON.stringify(lights.map((b) => ({ filter: b.filter, count: b.count })))
    );
  }
}

(async () => {
  const dirs = await findLogDirs(DUMP);
  check('findLogDirs finds log', dirs.some((d) => /log$/i.test(d)), dirs.join('|'));

  if (fs.existsSync(aug3)) {
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
  } else {
    console.log('  skip aug3 insight suite (Autorun_Log_2026-08-03 missing)');
  }

  if (fs.existsSync(jul28)) {
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
  } else {
    console.log('  skip jul28 insight (file missing)');
  }

  if (fs.existsSync(etSep15)) {
    const siiInsight = await buildSessionLogInsight({
      sourceRoot: DUMP,
      nightDate: '20260915',
      shootFilter: 'SII',
      refCaaDeg: 281,
      lightCount: 30,
      targetNames: ['IC 1396'],
    });
    check('ET SII insight ok', siiInsight.ok === true);
    check('ET SII planned 30', siiInsight.digest && siiInsight.digest.plannedLights === 30, siiInsight.digest && siiInsight.digest.plannedLights);
    check(
      'ET SII no false short-count warn',
      !(siiInsight.softWarnings || []).some((w) => /planned\s+50/i.test(w) || /dump has \d+/i.test(w)),
      siiInsight.softWarnings
    );
    const oiiiInsight = await buildSessionLogInsight({
      sourceRoot: DUMP,
      nightDate: '20260915',
      shootFilter: 'OIII',
      refCaaDeg: 281,
      lightCount: 20,
      targetNames: ['IC 1396'],
    });
    check('ET OIII planned 20', oiiiInsight.digest && oiiiInsight.digest.plannedLights === 20, oiiiInsight.digest && oiiiInsight.digest.plannedLights);
  }

  if (failed) {
    console.error('\nFAILED', failed);
    process.exit(1);
  }
  console.log('\nAll session-log checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
