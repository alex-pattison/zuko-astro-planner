#!/usr/bin/env node
/**
 * Reset Dev testing state so you can walk ingest → calibrate → registration yourself.
 *
 * - NAN (NGC7000): keep only real 260720 shoots + ingest meta; clear cal/cull/stack
 * - Remove synthetic 260721 / Test50 shoot folders + Siril intermediates (_stack, process, …)
 * - Clear cal/cull/stack on other Dev projects (e.g. Veil)
 * - Writes <checkout>/data JSON only (does not touch H: Beta)
 *
 * Usage: node scripts/reset-dev-manual-try.js
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PROJECT = 'F:\\zuko_dev\\Projects\\NGC7000_260720';
const JSON_PATHS = [path.join(__dirname, '..', 'data', 'zuko-dashboard-data.json')];

const KEEP_SHOOTS = new Set([
  '260720_Ha_B9_Home',
  '260720_OIII_B9_Home',
  '260720_SII_B9_Home',
]);

const SYNTHETIC_DIRS = [
  path.join(PROJECT, 'Ha', '260721_Ha_B9_Home'),
  path.join(PROJECT, 'Ha', '260722_Ha_B9_Test50'),
  path.join(PROJECT, 'Ha', '260901_Ha_B9_Home'),
  path.join(PROJECT, 'Ha', '260902_Ha_B9_Home'),
  path.join(PROJECT, 'OIII', '260721_OIII_B9_Home'),
  path.join(PROJECT, 'SII', '260721_SII_B9_Home'),
];

async function rm(p) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await fsp.rm(p, { recursive: true, force: true });
      return true;
    } catch (err) {
      if (attempt === 3) {
        console.warn('  could not remove (locked?):', p, '—', err.code || err.message);
        return false;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return false;
}

async function cleanSirilOutputsUnder(shootRoot) {
  for (const name of ['process', 'masters', 'scripts']) {
    await rm(path.join(shootRoot, name));
  }
  // leftover full Mono_Preprocessing finals at shoot root
  if (!fs.existsSync(shootRoot)) return;
  for (const name of await fsp.readdir(shootRoot)) {
    if (/^result_.*\.fit[s]?$/i.test(name)) {
      await rm(path.join(shootRoot, name));
    }
  }
}

async function cleanProjectDisk() {
  const removed = [];
  const failed = [];
  for (const dir of SYNTHETIC_DIRS) {
    if (fs.existsSync(dir)) {
      if (await rm(dir)) removed.push(dir);
      else failed.push(dir);
    }
  }
  for (const filter of ['Ha', 'OIII', 'SII']) {
    for (const name of ['_stack', 'Aggregate']) {
      const dir = path.join(PROJECT, filter, name);
      if (fs.existsSync(dir)) {
        if (await rm(dir)) removed.push(dir);
        else failed.push(dir);
      }
    }
    const filterRoot = path.join(PROJECT, filter);
    if (!fs.existsSync(filterRoot)) continue;
    for (const name of await fsp.readdir(filterRoot)) {
      const shootRoot = path.join(filterRoot, name);
      if (!fs.statSync(shootRoot).isDirectory()) continue;
      if (name === '_stack' || name === 'Aggregate') continue;
      await cleanSirilOutputsUnder(shootRoot);
    }
  }
  const working = path.join(PROJECT, 'working');
  if (fs.existsSync(working)) {
    for (const name of await fsp.readdir(working)) {
      const target = path.join(working, name);
      if (await rm(target)) removed.push(target);
      else failed.push(target);
    }
  }
  return { removed, failed };
}

function shootFolderName(sh) {
  if (sh.ingestMeta && sh.ingestMeta.shootFolder) return String(sh.ingestMeta.shootFolder);
  if (sh.ingestPath) return path.basename(String(sh.ingestPath));
  return '';
}

function resetNanProject(p) {
  const kept = (p.shoots || []).filter((sh) => {
    const folder = shootFolderName(sh);
    if (KEEP_SHOOTS.has(folder)) return true;
    // fallback: original night only, no synthetic dates
    return String(sh.date || '') === '260720' && !/Test50|260721/i.test(folder);
  });

  p.shoots = kept.map((sh) => ({
    ...sh,
    preprocessMeta: null,
    // keep ingest so Calibrate is available without re-staging
  }));

  for (const ft of p.filterTargets || []) {
    ft.aggregateMeta = null;
    ft.cullMeta = null;
    ft.stackMeta = null;
    ft.loggedHrs = 0;
  }
  for (const sh of p.shoots) {
    if (!sh.complete) continue;
    const ft = p.filterTargets[sh.filterIndex];
    if (ft) {
      ft.loggedHrs = Math.round(((ft.loggedHrs || 0) + (Number(sh.hours) || 0)) * 1000) / 1000;
    }
  }
  return p;
}

function clearPipelineMeta(p) {
  for (const sh of p.shoots || []) {
    sh.preprocessMeta = null;
  }
  for (const ft of p.filterTargets || []) {
    ft.aggregateMeta = null;
    ft.cullMeta = null;
    ft.stackMeta = null;
  }
  return p;
}

function patchJson(filePath, diskRemoved) {
  if (!fs.existsSync(filePath)) {
    console.warn('skip missing', filePath);
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const p of raw.projects || []) {
    if (/North America|NGC7000/i.test(p.name || '') || /NGC7000_260720/i.test(p.projectDir || '')) {
      resetNanProject(p);
    } else {
      clearPipelineMeta(p);
    }
  }
  if (!raw.appMeta) raw.appMeta = {};
  raw.appMeta.savedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2));
  const nan = (raw.projects || []).find((p) => /North America/i.test(p.name || ''));
  console.log('Wrote', filePath);
  if (nan) {
    console.log(
      '  NAN shoots:',
      nan.shoots.map((s) => ({
        date: s.date,
        folder: shootFolderName(s),
        ingest: !!s.ingestPath,
        cal: !!s.preprocessMeta,
      })),
    );
    console.log(
      '  NAN filters:',
      nan.filterTargets.map((f) => ({
        f: f.filter,
        logged: f.loggedHrs,
        agg: !!f.aggregateMeta,
        cull: !!f.cullMeta,
        stack: !!f.stackMeta,
      })),
    );
  }
  return { filePath, diskRemoved };
}

async function main() {
  console.log('Cleaning Siril / synthetic folders under', PROJECT);
  console.log('(Quit Electron first if anything stays locked.)');
  const { removed, failed } = await cleanProjectDisk();
  for (const p of removed) console.log('  removed', p);
  if (failed.length) {
    console.log('  still locked:');
    for (const p of failed) console.log('   ', p);
  }

  for (const jp of JSON_PATHS) {
    patchJson(jp, removed);
  }

  console.log('\nReady for manual try:');
  console.log('  • Shoot log: 3× 260720 (Ha/OIII/SII), ingested, not calibrated');
  console.log('  • Pipeline: Capture/Ingest done; Calibrate / Aggregate / Cull / Register clear');
  console.log('  • Reload Electron (Ctrl+R) from C:\\Users\\alexp\\Projects\\zuko-astro-planner');
  if (failed.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
