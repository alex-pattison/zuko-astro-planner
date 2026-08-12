#!/usr/bin/env node
/**
 * Volume-test seed for Veil (NGC6960_Q326).
 *
 * Builds fully imported (Capture + Import done, Calibrate clear) nights that
 * cover every Capture Plan target, with one 8h Ha night @ 180s (160 lights).
 * Frames are hardlinked (copy fallback) from the real Ha 260803 shoot so Siril
 * can actually calibrate them.
 *
 * Usage: node scripts/seed-veil-volume.js
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'zuko-dashboard-data.json');
const PROJECT = 'F:\\zuko_dev\\Projects\\NGC6960_Q326';
const SRC_SHOOT = path.join(PROJECT, 'Ha', '260803_Ha_B9_Home');

const EXP_SEC = 180;
const GAIN = 120;
const TEMP_C = -10;
const LIGHTS_PER_HOUR = 3600 / EXP_SEC; // 20

/** ASIAIR-style filter letter in filenames. */
const FILTER_LETTER = {
  Ha: 'H',
  OIII: 'O',
  SII: 'S',
  R: 'R',
  G: 'G',
  B: 'B',
};

/**
 * Nights to stage. hours ≤ 8. Frames = hours * 20 @ 180s.
 * filterIndex matches Veil filterTargets order in dashboard JSON.
 */
const NIGHTS = [
  {
    yymmdd: '260901',
    yyyymmdd: '20260901',
    filter: 'Ha',
    filterIndex: 0,
    location: 'Home',
    bortle: '9',
    hours: 8, // longest day — volume stress
  },
  {
    yymmdd: '260902',
    yyyymmdd: '20260902',
    filter: 'OIII',
    filterIndex: 1,
    location: 'Home',
    bortle: '9',
    hours: 4.5,
  },
  {
    yymmdd: '260903',
    yyyymmdd: '20260903',
    filter: 'SII',
    filterIndex: 2,
    location: 'Home',
    bortle: '9',
    hours: 2.5,
  },
  {
    yymmdd: '260904',
    yyyymmdd: '20260904',
    filter: 'SII',
    filterIndex: 3,
    location: 'Queechy',
    bortle: '5',
    hours: 1,
  },
  {
    yymmdd: '260905',
    yyyymmdd: '20260905',
    filter: 'R',
    filterIndex: 4,
    location: 'Home',
    bortle: '9',
    hours: 0.5,
  },
  {
    yymmdd: '260905',
    yyyymmdd: '20260905',
    filter: 'G',
    filterIndex: 5,
    location: 'Home',
    bortle: '9',
    hours: 0.5,
  },
  {
    yymmdd: '260905',
    yyyymmdd: '20260905',
    filter: 'B',
    filterIndex: 6,
    location: 'Home',
    bortle: '9',
    hours: 0.5,
  },
];

async function rm(p) {
  await fsp.rm(p, { recursive: true, force: true });
}

async function ensureLinkOrCopy(src, dest) {
  try {
    await fsp.unlink(dest);
  } catch {
    /* ignore */
  }
  try {
    await fsp.link(src, dest);
    return 'hardlink';
  } catch {
    await fsp.copyFile(src, dest);
    return 'copy';
  }
}

function shootFolder(night) {
  return `${night.yymmdd}_${night.filter}_B${night.bortle}_${night.location}`;
}

function countFits(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((n) => /\.fit[s]?$/i.test(n)).length;
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

function lightName(night, letter, seq) {
  // ASIAIR-ish: Light_<target>_<exp>s_Bin2_<F>_<YYYYMMDD>-HHMMSS_<temp>C_####.fit
  const hh = String(22 + Math.floor((seq - 1) / 60)).padStart(2, '0');
  const mm = String((seq - 1) % 60).padStart(2, '0');
  const ss = String((seq * 7) % 60).padStart(2, '0');
  return `Light_Veil volume_${EXP_SEC}.0s_Bin2_${letter}_${night.yyyymmdd}-${hh}${mm}${ss}_${TEMP_C}.0C_${pad4(seq)}.fit`;
}

function rewriteCalibName(name, night, letter) {
  return String(name)
    .replace(/_H_/g, `_${letter}_`)
    .replace(/_O_/g, `_${letter}_`)
    .replace(/_S_/g, `_${letter}_`)
    .replace(/_R_/g, `_${letter}_`)
    .replace(/_G_/g, `_${letter}_`)
    .replace(/_B_/g, `_${letter}_`)
    .replace(/20260803|20260804|20260714|20260725|20260726/g, night.yyyymmdd)
    .replace(/260803|260804|260725/g, night.yymmdd);
}

async function seedNight(night, srcLights, srcFlats, srcBiases, srcDarks) {
  const folder = shootFolder(night);
  const destRoot = path.join(PROJECT, night.filter, folder);
  const letter = FILTER_LETTER[night.filter] || 'H';
  const lightCount = Math.round(night.hours * LIGHTS_PER_HOUR);

  await rm(destRoot);
  await fsp.mkdir(path.join(destRoot, 'lights'), { recursive: true });
  await fsp.mkdir(path.join(destRoot, 'flats'), { recursive: true });
  await fsp.mkdir(path.join(destRoot, 'biases'), { recursive: true });
  await fsp.mkdir(path.join(destRoot, 'darks'), { recursive: true });

  let mode = 'hardlink';
  let linked = 0;

  for (let i = 1; i <= lightCount; i++) {
    const src = srcLights[(i - 1) % srcLights.length];
    const dest = path.join(destRoot, 'lights', lightName(night, letter, i));
    const how = await ensureLinkOrCopy(src, dest);
    if (how === 'copy') mode = 'copy';
    linked += 1;
  }

  async function linkCalib(srcs, sub) {
    let n = 0;
    for (const src of srcs) {
      const destName = rewriteCalibName(path.basename(src), night, letter);
      const how = await ensureLinkOrCopy(src, path.join(destRoot, sub, destName));
      if (how === 'copy') mode = 'copy';
      n += 1;
      linked += 1;
    }
    return n;
  }

  const flatN = await linkCalib(srcFlats, 'flats');
  const biasN = await linkCalib(srcBiases, 'biases');
  const darkN = await linkCalib(srcDarks, 'darks');

  for (const extra of ['process', 'masters', 'scripts', 'Aggregate', '_stack']) {
    await rm(path.join(destRoot, extra));
  }

  return {
    destRoot,
    folder,
    lightCount,
    flatN,
    biasN,
    darkN,
    linked,
    mode,
  };
}

function buildShoot(night, seeded) {
  const hours = Math.round(((seeded.lightCount * EXP_SEC) / 3600) * 1000) / 1000;
  return {
    date: night.yymmdd,
    filterIndex: night.filterIndex,
    hours,
    complete: true,
    creditedHours: hours,
    sourcePath: null,
    ingestPath: seeded.destRoot,
    ingestMeta: {
      layout: 'zuko-stage-for-siril',
      nightDate: night.yyyymmdd,
      shootFolder: seeded.folder,
      filters: [night.filter],
      destRoots: [seeded.destRoot],
      filesStaged: seeded.linked,
      byType: {
        light: seeded.lightCount,
        flat: seeded.flatN,
        bias: seeded.biasN,
        dark: seeded.darkN,
      },
      lightCount: seeded.lightCount,
      frameCount: seeded.lightCount,
      exposureSec: EXP_SEC,
      gain: GAIN,
      tempC: TEMP_C,
      stagedAt: new Date().toISOString(),
      note:
        `Volume seed — ${seeded.lightCount}×${EXP_SEC}s ${night.filter} hardlinked/copied from Ha/260803_Ha_B9_Home ` +
        `(${seeded.mode}). Ready for Calibrate.`,
    },
    preprocessMeta: null,
  };
}

function recomputeLoggedHrs(project) {
  for (const ft of project.filterTargets || []) ft.loggedHrs = 0;
  for (const sh of project.shoots || []) {
    if (!sh.complete) continue;
    const ft = project.filterTargets[sh.filterIndex];
    if (!ft) continue;
    const h = Number(sh.creditedHours != null ? sh.creditedHours : sh.hours) || 0;
    ft.loggedHrs = Math.round(((ft.loggedHrs || 0) + h) * 1000) / 1000;
  }
}

async function cleanVolumeFolders(keepFoldersByFilter) {
  const removed = [];
  for (const filter of Object.keys(FILTER_LETTER)) {
    const root = path.join(PROJECT, filter);
    if (!fs.existsSync(root)) continue;
    const keep = new Set(keepFoldersByFilter[filter] || []);
    // Preserve the real source shoot used for cloning.
    if (filter === 'Ha') keep.add('260803_Ha_B9_Home');
    for (const name of await fsp.readdir(root)) {
      const full = path.join(root, name);
      if (!fs.statSync(full).isDirectory()) continue;
      if (name === 'Aggregate' || name === '_stack') {
        await rm(full);
        removed.push(full);
        continue;
      }
      if (keep.has(name)) continue;
      // Only remove prior volume seeds (2609xx) — leave other real nights alone.
      if (!/^2609\d{2}_/.test(name)) continue;
      await rm(full);
      removed.push(full);
    }
  }
  for (const filter of Object.keys(FILTER_LETTER)) {
    await rm(path.join(PROJECT, filter, 'Aggregate'));
    await rm(path.join(PROJECT, filter, '_stack'));
  }
  const working = path.join(PROJECT, 'working');
  if (fs.existsSync(working)) {
    for (const name of await fsp.readdir(working)) {
      await rm(path.join(working, name));
    }
  }
  return removed;
}

async function main() {
  if (!fs.existsSync(SRC_SHOOT)) {
    throw new Error('Missing real Ha source shoot: ' + SRC_SHOOT);
  }
  const srcLights = listFits(path.join(SRC_SHOOT, 'lights'));
  const srcFlats = listFits(path.join(SRC_SHOOT, 'flats'));
  const srcBiases = listFits(path.join(SRC_SHOOT, 'biases'));
  const srcDarks = listFits(path.join(SRC_SHOOT, 'darks'));
  if (!srcLights.length) throw new Error('No source lights in ' + SRC_SHOOT);

  console.log('Source:', SRC_SHOOT);
  console.log(
    `  lights=${srcLights.length} flats=${srcFlats.length} biases=${srcBiases.length} darks=${srcDarks.length}`,
  );

  const bak = DATA_PATH.replace(
    /\.json$/i,
    `.pre-veil-volume.${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await fsp.copyFile(DATA_PATH, bak);
  console.log('Backup JSON →', bak);

  const keepByFilter = {};
  const shoots = [];
  let anyCopy = false;

  for (const night of NIGHTS) {
    const lightCount = Math.round(night.hours * LIGHTS_PER_HOUR);
    process.stdout.write(
      `Seeding ${night.filter} ${night.yymmdd} ${night.hours}h (${lightCount} lights)… `,
    );
    const seeded = await seedNight(night, srcLights, srcFlats, srcBiases, srcDarks);
    if (seeded.mode === 'copy') anyCopy = true;
    console.log(`${seeded.mode}, ${seeded.linked} links`);
    if (!keepByFilter[night.filter]) keepByFilter[night.filter] = [];
    keepByFilter[night.filter].push(seeded.folder);
    shoots.push(buildShoot(night, seeded));
  }

  const removed = await cleanVolumeFolders(keepByFilter);
  if (removed.length) {
    console.log('Removed prior volume folders:', removed.length);
  }

  const raw = JSON.parse(await fsp.readFile(DATA_PATH, 'utf8'));
  const project = (raw.projects || []).find((p) => /Veil/i.test(p.name || ''));
  if (!project) throw new Error('Veil project not found in dashboard JSON');

  project.shoots = shoots;
  project.status = 'processing';
  project.processStatus = 'ingested';
  for (const ft of project.filterTargets || []) {
    ft.aggregateMeta = null;
    ft.cullMeta = null;
    ft.stackMeta = null;
  }
  recomputeLoggedHrs(project);

  if (!raw.appMeta) raw.appMeta = {};
  raw.appMeta.savedAt = new Date().toISOString();
  await fsp.writeFile(DATA_PATH, JSON.stringify(raw, null, 2) + '\n');

  console.log('\nVeil Capture Plan coverage:');
  for (const ft of project.filterTargets) {
    const ok = (ft.loggedHrs || 0) >= (ft.targetHrs || 0);
    console.log(
      `  ${ft.filter} ${ft.location}: ${ft.loggedHrs}h / ${ft.targetHrs}h ${ok ? '✓' : '✗'}`,
    );
  }
  console.log(`\nShoots staged: ${shoots.length}`);
  console.log(`Link mode: ${anyCopy ? 'some copies (hardlink failed)' : 'hardlink'}`);
  console.log('Calibrate / Aggregate / Cull / Register cleared — Import done.');
  console.log('Reload Electron (Ctrl+R) and open Veil → Imaging Pipeline.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
