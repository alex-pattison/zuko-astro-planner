#!/usr/bin/env node
/** Strip [TEST] projects and reset real projects to pre-ingest (no staging paths). */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'zuko-dashboard-data.json');
const H = path.join('H:', 'Photography', 'Astrophotography', 'Dashboard', 'zuko-dashboard-data.json');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const BUILD = Number(pkg.zukoBuild) || 8;

const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const before = (d.projects || []).map((p) => p.name);

d.projects = (d.projects || []).filter((p) => {
  const n = String(p.name || '');
  if (/\[TEST\]/i.test(n)) return false;
  if (/E2E/i.test(n)) return false;
  return true;
});

const removed = before.filter((n) => !d.projects.some((p) => p.name === n));

for (const p of d.projects) {
  if (p.projectDir && /[/\\]staging[/\\]/i.test(String(p.projectDir))) {
    p.projectDir = '';
  }
  p.ignoredAsiairFolders = [];
  p.asiairIgnoredSources = [];
  p.asiairBoundFolders = [];
  if (p.processStatus === 'ingested') p.processStatus = 'none';

  if (/Veil/i.test(p.name || '')) {
    // Known real Captured nights — clear sample-only 260720 leftover
    p.shoots = [
      {
        date: '260725',
        filterIndex: 0,
        hours: 0.25,
        complete: true,
        creditedHours: 0.25,
        sourcePath: null,
        ingestPath: null,
        ingestMeta: null,
      },
      {
        date: '260725',
        filterIndex: 1,
        hours: 0.25,
        complete: true,
        creditedHours: 0.25,
        sourcePath: null,
        ingestPath: null,
        ingestMeta: null,
      },
      {
        date: '260725',
        filterIndex: 3,
        hours: 1,
        complete: true,
        creditedHours: 1,
        sourcePath: null,
        ingestPath: null,
        ingestMeta: null,
      },
    ];
    // Prefer Dev imaging pool; fall back to Beta H: dump.
    const devDir = 'F:\\zuko_dev\\Projects\\NGC6960_Q326\\260725';
    const betaDir = 'H:\\Photography\\Astrophotography\\Zuko\\NGC6960_Q326\\260725';
    if (fs.existsSync(devDir)) {
      p.projectDir = devDir;
    } else if (fs.existsSync(path.join(betaDir, 'Autorun')) || fs.existsSync(betaDir)) {
      p.projectDir = betaDir;
    }
  } else {
    for (const sh of p.shoots || []) {
      sh.sourcePath = null;
      sh.ingestPath = null;
      sh.ingestMeta = null;
      sh.preprocessMeta = null;
      if (sh.complete) sh.creditedHours = Number(sh.hours) || 0;
    }
    // Keep NAN on Dev F: pool when present
    if (/North America|NGC7000/i.test(p.name || '') || /NGC7000/i.test(String(p.projectDir || ''))) {
      const nanDev = 'F:\\zuko_dev\\Projects\\NGC7000_260720';
      if (fs.existsSync(nanDev)) p.projectDir = nanDev;
    }
  }

  for (const ft of p.filterTargets || []) {
    ft.loggedHrs = 0;
    ft.cullMeta = null;
    ft.stackMeta = null;
  }
  for (const sh of p.shoots || []) {
    sh.preprocessMeta = null;
    if (!sh.complete) continue;
    const ft = p.filterTargets[sh.filterIndex];
    if (ft) {
      ft.loggedHrs = Math.round(((ft.loggedHrs || 0) + (Number(sh.hours) || 0)) * 1000) / 1000;
    }
  }
}

// Dev dark library on F: when present
const devDark = 'F:\\zuko_dev\\Dark Library';
if (!d.darkLibrary || typeof d.darkLibrary !== 'object') d.darkLibrary = {};
if (fs.existsSync(devDark)) {
  d.darkLibrary.path = devDark;
}

if (!d.appMeta) d.appMeta = {};
d.appMeta.version = pkg.version || '0.2.0';
d.appMeta.build = BUILD;
d.appMeta.savedAt = new Date().toISOString();

const json = JSON.stringify(d, null, 2);
fs.writeFileSync(DATA, json);
console.log('Wrote', DATA);
console.log('Removed:', removed);
console.log(
  'Remaining:',
  d.projects.map((p) => ({
    name: p.name,
    dir: p.projectDir || '(none)',
    shoots: (p.shoots || []).length,
    ingested: (p.shoots || []).filter((s) => s.ingestPath).length,
  })),
);

// Never mirror Dev checkout JSON onto H: Beta. Use --mirror-beta only when intentional.
if (process.argv.includes('--mirror-beta')) {
  try {
    if (fs.existsSync(path.dirname(H))) {
      fs.writeFileSync(H, json);
      console.log('Mirrored', H);
    }
  } catch (e) {
    console.warn('H mirror failed:', e.message);
  }
} else {
  console.log('Skipped H: Beta mirror (pass --mirror-beta to overwrite Beta dashboard)');
}
