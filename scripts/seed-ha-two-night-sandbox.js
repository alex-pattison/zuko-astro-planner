#!/usr/bin/env node
/**
 * Reset Dev dashboard to a single-filter (Ha) sandbox with two synthetic nights.
 *
 * - Hardlinks/copies real frames from NGC7000 Ha 260720
 * - Rewrites filenames / shoot dates to 260901 + 260902
 * - Clears cal / cull / stack so Imaging Pipeline can be walked fresh
 * - Backs up prior data/zuko-dashboard-data.json
 *
 * Usage: node scripts/seed-ha-two-night-sandbox.js
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'zuko-dashboard-data.json');
const PROJECT = 'F:\\zuko_dev\\Projects\\NGC7000_260720';
const SRC_SHOOT = path.join(PROJECT, 'Ha', '260720_Ha_B9_Home');

const NIGHTS = [
  { yymmdd: '260901', yyyymmdd: '20260901', folder: '260901_Ha_B9_Home' },
  { yymmdd: '260902', yyyymmdd: '20260902', folder: '260902_Ha_B9_Home' },
];

const INPUT_DIRS = ['biases', 'darks', 'flats', 'lights'];
const EXP_SEC = 180;
const GAIN = 120;
const TEMP_C = -10;

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

function rewriteName(name, fromYyyymmdd, toYyyymmdd, fromYymmdd, toYymmdd) {
  return String(name)
    .replace(new RegExp(fromYyyymmdd, 'g'), toYyyymmdd)
    .replace(new RegExp(fromYymmdd, 'g'), toYymmdd)
    .replace(/20260720/g, toYyyymmdd)
    .replace(/260720/g, toYymmdd);
}

async function seedNight(night) {
  const destRoot = path.join(PROJECT, 'Ha', night.folder);
  await rm(destRoot);
  await fsp.mkdir(destRoot, { recursive: true });

  let linked = 0;
  let mode = 'hardlink';
  for (const dir of INPUT_DIRS) {
    const srcDir = path.join(SRC_SHOOT, dir);
    const destDir = path.join(destRoot, dir);
    await fsp.mkdir(destDir, { recursive: true });
    if (!fs.existsSync(srcDir)) continue;
    for (const name of await fsp.readdir(srcDir)) {
      if (!/\.fit[s]?$/i.test(name)) continue;
      const destName = rewriteName(name, '20260720', night.yyyymmdd, '260720', night.yymmdd);
      const how = await ensureLinkOrCopy(path.join(srcDir, name), path.join(destDir, destName));
      if (how === 'copy') mode = 'copy';
      linked += 1;
    }
  }
  for (const extra of ['process', 'masters', 'scripts']) {
    await rm(path.join(destRoot, extra));
  }
  return { destRoot, linked, mode };
}

function countFits(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((n) => /\.fit[s]?$/i.test(n)).length;
}

function buildShoot(night, destRoot, filterIndex, lightCount) {
  const hours = Math.round(((lightCount * EXP_SEC) / 3600) * 100) / 100;
  return {
    date: night.yymmdd,
    filterIndex,
    hours,
    complete: true,
    creditedHours: hours,
    sourcePath: null,
    ingestPath: destRoot,
    ingestMeta: {
      layout: 'zuko-stage-for-siril',
      nightDate: night.yyyymmdd,
      shootFolder: night.folder,
      filters: ['Ha'],
      destRoots: [destRoot],
      filesStaged: lightCount + 30,
      byType: {
        light: lightCount,
        flat: countFits(path.join(destRoot, 'flats')),
        bias: countFits(path.join(destRoot, 'biases')),
        dark: countFits(path.join(destRoot, 'darks')),
      },
      lightCount,
      frameCount: lightCount,
      exposureSec: EXP_SEC,
      gain: GAIN,
      tempC: TEMP_C,
      stagedAt: new Date().toISOString(),
      note: `Synthetic sandbox night — frames hardlinked/copied from 260720_Ha_B9_Home with date metadata rewritten to ${night.yyyymmdd}.`,
    },
    preprocessMeta: null,
  };
}

async function cleanHaExtras(keepFolders) {
  const haRoot = path.join(PROJECT, 'Ha');
  const keep = new Set(keepFolders);
  keep.add('260720_Ha_B9_Home'); // preserve real source shoot
  if (!fs.existsSync(haRoot)) return [];
  const removed = [];
  for (const name of await fsp.readdir(haRoot)) {
    const full = path.join(haRoot, name);
    if (!fs.statSync(full).isDirectory()) continue;
    if (keep.has(name)) continue;
    await rm(full);
    removed.push(full);
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

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(ROOT, 'data', `zuko-dashboard-data.pre-ha-sandbox.${stamp}.json`);
  if (fs.existsSync(DATA_PATH)) {
    await fsp.copyFile(DATA_PATH, backup);
    console.log('Backed up dashboard →', backup);
  }

  const prev = fs.existsSync(DATA_PATH)
    ? JSON.parse(await fsp.readFile(DATA_PATH, 'utf8'))
    : {};

  console.log('Seeding two Ha nights from', SRC_SHOOT);
  const seeded = [];
  for (const night of NIGHTS) {
    const r = await seedNight(night);
    seeded.push({ night, ...r });
    console.log(`  ${night.folder}: ${r.linked} frames (${r.mode})`);
  }

  const removed = await cleanHaExtras(NIGHTS.map((n) => n.folder));
  if (removed.length) {
    console.log('Removed old Ha folders:');
    removed.forEach((p) => console.log('  -', p));
  }

  const lightCount = countFits(path.join(seeded[0].destRoot, 'lights'));
  const hoursEach = Math.round(((lightCount * EXP_SEC) / 3600) * 100) / 100;
  const shoots = seeded.map(({ night, destRoot }, i) =>
    buildShoot(night, destRoot, 0, countFits(path.join(destRoot, 'lights')))
  );

  const data = {
    rigName: prev.rigName || 'Zuko',
    forecastLocation: prev.forecastLocation || { name: 'NYC', lat: 40.7157, lon: -73.986 },
    projects: [
      {
        name: '[Sandbox] Ha two-night pipeline',
        target: 'NGC 7000 — Ha-only synthetic sandbox (2 nights from real 260720 frames)',
        frameMode: 'Reducer 280mm f/3.9 · Bin2 — sandbox',
        projectDir: PROJECT,
        centerCoords: 'RA 20h56m34.4s  Dec +43°50\'11.3"',
        rotation: '122°',
        status: 'active',
        notes:
          'Sandbox for Imaging Pipeline: one Ha channel, two captured+imported nights. ' +
          'Frames are hardlinked/copied from real 260720_Ha_B9_Home with dates rewritten. ' +
          'Calibrate → Cull → Register from a clean state.',
        filterTargets: [
          {
            filter: 'Ha',
            location: 'Home',
            bortle: '9',
            targetHrs: hoursEach * 2,
            loggedHrs: hoursEach * 2,
            stackMeta: null,
            cullMeta: null,
          },
        ],
        checklist: [
          { id: 'sbx-cal', text: 'Calibrate both Ha nights', done: false },
          { id: 'sbx-cull', text: 'Mark Cull done', done: false },
          { id: 'sbx-reg', text: 'Run Registration', done: false },
        ],
        shoots,
        astrobinLinks: [],
        processStatus: 'ingested',
        ignoredAsiairFolders: [],
        asiairBoundFolders: [],
        asiairIgnoredSources: [],
      },
    ],
    notes: [
      {
        icon: '🧪',
        text: 'Ha two-night sandbox ready — open [Sandbox] Ha two-night pipeline → Imaging Pipeline.',
      },
    ],
    assets: Array.isArray(prev.assets) ? prev.assets : [],
    darkLibrary: prev.darkLibrary || { path: '', index: [], sizeBytes: 0 },
    uiSections: {
      'tracked-projects': true,
      'sky-forecast': false,
      'action-items': true,
      'calibration-libraries': false,
      'optical-train': false,
      'power-data': false,
      'rig-assets': false,
      'filter-wheel': false,
      'imaging-configs': false,
    },
    asiairSourcePath: prev.asiairSourcePath || '',
    appMeta: prev.appMeta || undefined,
  };

  await fsp.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fsp.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');

  console.log('\nDashboard reset →', DATA_PATH);
  console.log('Project: [Sandbox] Ha two-night pipeline');
  console.log(`Ha nights: ${NIGHTS.map((n) => n.yymmdd).join(' + ')} · ${lightCount} lights × ${EXP_SEC}s ≈ ${hoursEach}h each`);
  console.log('Reload Dev to pick up the new JSON.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
