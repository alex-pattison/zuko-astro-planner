#!/usr/bin/env node
/**
 * Build a simulated ASIAIR dump for Veil Import testing and point Dev at it.
 *
 * Creates: F:\zuko_dev\ASIAIR-VolumeDump\Autorun\{Light,Flat,Bias,Dark}
 * Lights live under Light/NGC 6960/ (matches Veil / Cygnus Loop).
 * Clones real FITS from Veil Ha 260803 with FILTER + DATE-OBS rewritten.
 *
 * Also appends Captured (not imported) shoot-log rows on Veil for those nights,
 * and sets asiairSourcePath → the dump root.
 *
 * Keeps existing volume-seeded imported nights intact.
 *
 * Usage: node scripts/seed-veil-import-source.js
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'zuko-dashboard-data.json');
const PROJECT = 'F:\\zuko_dev\\Projects\\NGC6960_Q326';
const SRC_SHOOT = path.join(PROJECT, 'Ha', '260803_Ha_B9_Home');
const DUMP_ROOT = 'F:\\zuko_dev\\ASIAIR-VolumeDump';
const AUTORUN = path.join(DUMP_ROOT, 'Autorun');

const EXP_SEC = 180;
const TEMP_C = -10;
const GAIN = 120;
const TARGET_FOLDER = 'NGC 6960';
const OBJECT_NAME = 'NGC 6960';

/** Import-test nights: Captured in shoot log, frames only in the dump (not staged yet). */
const IMPORT_NIGHTS = [
  { yymmdd: '261010', yyyymmdd: '20261010', filter: 'Ha', letter: 'H', filterIndex: 0, lights: 24, hours: 1.2 },
  { yymmdd: '261011', yyyymmdd: '20261011', filter: 'OIII', letter: 'O', filterIndex: 1, lights: 20, hours: 1 },
  { yymmdd: '261012', yyyymmdd: '20261012', filter: 'SII', letter: 'S', filterIndex: 2, lights: 16, hours: 0.8 },
];

async function rm(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

function listFits(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => /\.fit[s]?$/i.test(n))
    .sort()
    .map((n) => path.join(dir, n));
}

function pad4(n) {
  return String(n).padStart(4, '0');
}

/** Patch first matching FITS header card (80-byte records). */
function patchCard(buf, keyword, buildValueFn) {
  const text = buf.toString('binary');
  const out = Buffer.from(buf);
  const key = String(keyword).toUpperCase().padEnd(8, ' ').slice(0, 8);
  for (let i = 0; i + 80 <= Math.min(text.length, 2880 * 16); i += 80) {
    const card = text.slice(i, i + 80);
    if (card.slice(0, 8).trim().toUpperCase() === 'END') break;
    if (card.slice(0, 8).toUpperCase() !== key) continue;
    const newVal = buildValueFn(card);
    const rebuilt = (key.trimEnd().padEnd(8, ' ') + '= ' + newVal + card.slice(10 + String(newVal).length))
      .slice(0, 80)
      .padEnd(80, ' ');
    Buffer.from(rebuilt, 'binary').copy(out, i);
    return out;
  }
  return out;
}

function patchFilter(buf, letter) {
  return patchCard(buf, 'FILTER', () => ("'" + String(letter).padEnd(8, ' ') + "'"));
}

function patchDateObs(buf, ymd, hms = '220000') {
  const isoDate = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  const hh = hms.slice(0, 2);
  const mm = hms.slice(2, 4);
  const ss = hms.slice(4, 6);
  const iso = `${isoDate}T${hh}:${mm}:${ss}`;
  return patchCard(buf, 'DATE-OBS', () => ("'" + iso + "'").padEnd(20, ' '));
}

function patchObject(buf, name) {
  const v = ("'" + String(name).slice(0, 68).padEnd(8, ' ') + "'");
  return patchCard(buf, 'OBJECT', () => v);
}

async function writePatched(src, dest, mutators) {
  let buf = await fsp.readFile(src);
  for (const fn of mutators) buf = fn(buf);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, buf);
}

function lightFileName(night, letter, seq) {
  const hh = String(22 + Math.floor((seq - 1) / 40)).padStart(2, '0');
  const mm = String(((seq - 1) * 3) % 60).padStart(2, '0');
  const ss = String((seq * 11) % 60).padStart(2, '0');
  return `Light_${TARGET_FOLDER}_${EXP_SEC}.0s_Bin2_${letter}_${night.yyyymmdd}-${hh}${mm}${ss}_${TEMP_C}.0C_${pad4(seq)}.fit`;
}

function flatFileName(night, letter, seq) {
  return `Flat_500.0ms_Bin2_${letter}_${night.yyyymmdd}-1849${pad4(seq).slice(-2)}_-10.0C_${pad4(seq)}.fit`;
}

function biasFileName(seq) {
  return `Bias_500.0ms_Bin2_H_20261001-1854${pad4(seq).slice(-2)}_-10.5C_${pad4(seq)}.fit`;
}

function darkFileName(seq) {
  return `Dark_${EXP_SEC}.0s_Bin2_H_20261001-2000${pad4(seq).slice(-2)}_-10.0C_${pad4(seq)}.fit`;
}

async function buildDump(srcLights, srcFlats, srcBiases, srcDarks) {
  await rm(AUTORUN);
  const lightRoot = path.join(AUTORUN, 'Light', TARGET_FOLDER);
  const flatDir = path.join(AUTORUN, 'Flat');
  const biasDir = path.join(AUTORUN, 'Bias');
  const darkDir = path.join(AUTORUN, 'Dark');
  await fsp.mkdir(lightRoot, { recursive: true });
  await fsp.mkdir(flatDir, { recursive: true });
  await fsp.mkdir(biasDir, { recursive: true });
  await fsp.mkdir(darkDir, { recursive: true });

  let written = 0;

  for (const night of IMPORT_NIGHTS) {
    for (let i = 1; i <= night.lights; i++) {
      const src = srcLights[(i - 1) % srcLights.length];
      const dest = path.join(lightRoot, lightFileName(night, night.letter, i));
      const hms = String(220000 + i).padStart(6, '0').slice(-6);
      await writePatched(src, dest, [
        (b) => patchFilter(b, night.letter),
        (b) => patchDateObs(b, night.yyyymmdd, hms),
        (b) => patchObject(b, OBJECT_NAME),
      ]);
      written += 1;
    }
    // Matching flats per filter/night (8 each — enough for import pairing)
    const flatN = 8;
    for (let i = 1; i <= flatN; i++) {
      const src = srcFlats[(i - 1) % srcFlats.length];
      const dest = path.join(flatDir, flatFileName(night, night.letter, i));
      await writePatched(src, dest, [
        (b) => patchFilter(b, night.letter),
        (b) => patchDateObs(b, night.yyyymmdd, '185000'),
      ]);
      written += 1;
    }
  }

  // Shared biases / darks (session calib)
  for (let i = 1; i <= Math.min(20, srcBiases.length || 20); i++) {
    const src = srcBiases[(i - 1) % srcBiases.length];
    await writePatched(src, path.join(biasDir, biasFileName(i)), [
      (b) => patchDateObs(b, '20261001', '185400'),
    ]);
    written += 1;
  }
  for (let i = 1; i <= Math.min(20, srcDarks.length || 20); i++) {
    const src = srcDarks[(i - 1) % srcDarks.length];
    await writePatched(src, path.join(darkDir, darkFileName(i)), [
      (b) => patchDateObs(b, '20261001', '200000'),
    ]);
    written += 1;
  }

  // Distractor: mismatched target folder for Review source
  const otherDir = path.join(AUTORUN, 'Light', 'NGC 7000');
  await fsp.mkdir(otherDir, { recursive: true });
  for (let i = 1; i <= 3; i++) {
    const src = srcLights[(i - 1) % srcLights.length];
    const name = `Light_NGC 7000_${EXP_SEC}.0s_Bin2_H_20261013-2210${pad4(i).slice(-2)}_-10.0C_${pad4(i)}.fit`;
    await writePatched(src, path.join(otherDir, name), [
      (b) => patchFilter(b, 'H'),
      (b) => patchDateObs(b, '20261013', '221000'),
      (b) => patchObject(b, 'NGC 7000'),
    ]);
    written += 1;
  }

  return written;
}

function buildImportShoot(night) {
  return {
    date: night.yymmdd,
    filterIndex: night.filterIndex,
    hours: night.hours,
    complete: true,
    creditedHours: night.hours,
    sourcePath: null,
    ingestPath: null,
    ingestMeta: null,
    preprocessMeta: null,
  };
}

async function main() {
  if (!fs.existsSync(SRC_SHOOT)) {
    throw new Error('Missing real Ha source shoot: ' + SRC_SHOOT);
  }
  const srcLights = listFits(path.join(SRC_SHOOT, 'lights'));
  const srcFlats = listFits(path.join(SRC_SHOOT, 'flats'));
  const srcBiases = listFits(path.join(SRC_SHOOT, 'biases'));
  const srcDarks = listFits(path.join(SRC_SHOOT, 'darks'));
  if (!srcLights.length || !srcFlats.length) {
    throw new Error('Need lights+flats in ' + SRC_SHOOT);
  }

  console.log('Building ASIAIR dump at', DUMP_ROOT);
  console.log('  cloning from', SRC_SHOOT);
  const n = await buildDump(srcLights, srcFlats, srcBiases, srcDarks);
  console.log(`  wrote ${n} FITS files`);

  // Quick scan sanity
  const { scanSession } = require('../src/ingest/asiairIngest');
  const scan = await scanSession({ projectDir: DUMP_ROOT, skipTargetHint: true });
  if (!scan.ok) throw new Error('scan failed: ' + (scan.error || '?'));
  console.log(`  scan: ${scan.lights.length} lights, ${scan.flats.length} flats, targets=`,
    (scan.targets || []).map((t) => t.folder).join(', '));

  const bak = DATA_PATH.replace(
    /\.json$/i,
    `.pre-veil-import-src.${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await fsp.copyFile(DATA_PATH, bak);
  console.log('Backup JSON →', bak);

  const raw = JSON.parse(await fsp.readFile(DATA_PATH, 'utf8'));
  raw.asiairSourcePath = DUMP_ROOT;

  const project = (raw.projects || []).find((p) => /Veil/i.test(p.name || ''));
  if (!project) throw new Error('Veil project not found');

  // Drop prior import-test shoot rows (2610xx), keep volume / other nights
  project.shoots = (project.shoots || []).filter((sh) => !/^2610/.test(String(sh.date || '')));
  for (const night of IMPORT_NIGHTS) {
    project.shoots.push(buildImportShoot(night));
  }

  // Recompute logged hrs from complete shoots (imported or not — credited when captured)
  for (const ft of project.filterTargets || []) ft.loggedHrs = 0;
  for (const sh of project.shoots || []) {
    if (!sh.complete) continue;
    const ft = project.filterTargets[sh.filterIndex];
    if (!ft) continue;
    const h = Number(sh.creditedHours != null ? sh.creditedHours : sh.hours) || 0;
    ft.loggedHrs = Math.round(((ft.loggedHrs || 0) + h) * 1000) / 1000;
  }

  if (!raw.appMeta) raw.appMeta = {};
  raw.appMeta.savedAt = new Date().toISOString();
  await fsp.writeFile(DATA_PATH, JSON.stringify(raw, null, 2) + '\n');

  console.log('\nASIAIR source →', DUMP_ROOT);
  console.log('Veil shoot log: appended Captured / not-imported nights:');
  for (const night of IMPORT_NIGHTS) {
    console.log(`  ${night.yymmdd} ${night.filter} ${night.hours}h (${night.lights}×${EXP_SEC}s) → Import`);
  }
  console.log('Also: Light/NGC 7000 (3 lights) for Review source mismatch.');
  console.log('Reload Electron (Ctrl+R). Settings / Review source / Import should use the dump.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
