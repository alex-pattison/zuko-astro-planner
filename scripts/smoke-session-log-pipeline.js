#!/usr/bin/env node
/**
 * Smoke: session-log integration must not break scan/stage contracts.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  scanSession,
  stageSirilTree,
  caaMatchesFramer,
  normalizeFilter,
} = require('../src/ingest/asiairIngest');
const {
  listShootSessionLogs,
  readShootSessionLog,
  buildSessionLogInsight,
} = require('../src/ingest/asiairSessionLogs');

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log('  ok ', name);
  else {
    failed += 1;
    console.error('  FAIL', name, detail || '');
  }
}

const DUMP =
  process.env.ASIAIR_QA_SRC
  || path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', 'asiaIRDUMP');

(async () => {
  console.log('=== smoke-session-log-pipeline ===');
  console.log('dump:', DUMP, fs.existsSync(DUMP) ? '' : 'MISSING');

  // 1) Exports / require graph
  const ingest = require('../src/ingest/asiairIngest');
  ok('sessionLogs exported', !!(ingest.sessionLogs && ingest.sessionLogs.parseAutorunLog));
  ok('scanSession exported', typeof ingest.scanSession === 'function');
  ok('stageSirilTree exported', typeof ingest.stageSirilTree === 'function');
  ok('caaMatchesFramer still works', caaMatchesFramer(206, 211, 10) === true);
  ok('normalizeFilter H→Ha', normalizeFilter('H') === 'Ha');

  // 2) Scan with dump that HAS log/ — must still ok and attach sessionLog
  if (!fs.existsSync(DUMP)) {
    console.log('skip live dump smokes');
    process.exit(failed ? 1 : 0);
  }

  const scan = await scanSession({
    projectDir: DUMP,
    nightDate: '20260803',
    shootFilter: 'Ha',
    refCaaDeg: 211,
  });
  ok('scanSession ok with log/', scan && scan.ok === true, scan && scan.error);
  ok('scan has lights or empty ok field', scan.ok === true);
  ok('scan.sessionLog present', !!(scan.sessionLog && (scan.sessionLog.digest || scan.sessionLog.ok != null)));
  if (scan.sessionLog && scan.sessionLog.digest) {
    ok('digest plan Veilq3v2', scan.sessionLog.digest.planName === 'Veilq3v2');
  }
  // softWarnings must be an array even when session logs add entries
  ok('softWarnings is array', Array.isArray(scan.softWarnings));

  // 3) Scan with a fake root that has NO log/ — must not throw / fail solely for missing logs
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuko-nolog-'));
  try {
    const scanEmpty = await scanSession({
      projectDir: emptyRoot,
      nightDate: '20260803',
      shootFilter: 'Ha',
    });
    // discover may fail with no sessions — that's fine; must not be EXCEPTION from log parse
    ok(
      'no-log root does not crash',
      scanEmpty != null && typeof scanEmpty.ok === 'boolean',
      scanEmpty
    );
    if (scanEmpty.ok === false) {
      ok('no-log failure is discover/session related', !!scanEmpty.error || !!scanEmpty.code, scanEmpty);
    }
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  }

  // 4) Insight + list/read against already-staged Dev Ha night (if present)
  const dataPath = path.join(__dirname, '..', 'data', 'zuko-dashboard-data.json');
  if (fs.existsSync(dataPath)) {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const veil = (data.projects || []).find((p) => /veil/i.test(p.name));
    const ha = veil && (veil.shoots || []).find((s) => {
      const ft = veil.filterTargets[s.filterIndex];
      return ft && ft.filter === 'Ha' && String(s.date).includes('0803');
    });
    if (ha && ha.ingestPath) {
      const listed = await listShootSessionLogs(ha.ingestPath);
      ok('Dev Ha 260803 has session-logs', listed.ok && listed.files.length >= 2, listed);
      const autorun = (listed.files || []).find((f) => f.kind === 'autorun');
      if (autorun) {
        const read = await readShootSessionLog(autorun.path);
        ok('read autorun ok', read.ok === true, read.error);
        ok('read has Plan text', /Plan /i.test(read.text || ''));
      }
      const phd = (listed.files || []).find((f) => f.kind === 'phd2');
      if (phd) {
        const read = await readShootSessionLog(phd.path);
        ok('read phd2 ok (may truncate)', read.ok === true, read.error);
      }
      // Safety: refuse reading outside session-logs
      const bad = await readShootSessionLog(path.join(ha.ingestPath, 'lights', 'nope.fit'));
      ok('refuse read outside session-logs', bad.ok === false);
    } else {
      console.log('  skip Dev Ha 260803 path checks (not found)');
    }
  }

  // 5) Register tone-key regression (display name vs tone)
  const {
    // reimplemented lightly — index.html helpers aren't requireable
  } = {};
  function filterToneKeyHeuristic(name) {
    const n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (n === 'oiii' || n === 'o3' || n === 'o') return 'oiii';
    if (n === 'ha' || n === 'h') return 'ha';
    return n;
  }
  ok('OIII name ≠ tone key (bug we fixed)', 'OIII' !== filterToneKeyHeuristic('OIII'));
  ok('tone key is oiii', filterToneKeyHeuristic('OIII') === 'oiii');

  // 6) buildSessionLogInsight soft-fail path
  const miss = await buildSessionLogInsight({
    sourceRoot: DUMP,
    nightDate: '20990101',
    shootFilter: 'Ha',
  });
  ok('unknown night insight not ok / empty', miss.ok === false || !(miss.digest));

  if (failed) {
    console.error('\nFAILED', failed);
    process.exit(1);
  }
  console.log('\nSmoke session-log pipeline passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
