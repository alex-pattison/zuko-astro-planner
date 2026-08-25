#!/usr/bin/env node
/**
 * QA + smoke for the Import flat-set picker.
 * Uses F:\zuko_dev\ASIAIR-flat-picker (header-only FITS). Stages into a throwaway
 * dest, never Veil / H: Beta.
 *
 *   node scripts/qa-flat-set-picker.js
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  scanSession,
  buildScoredFlatSets,
  stageSirilTree,
  normalizeFilter,
} = require('../src/ingest/asiairIngest');

const ROOT = path.resolve(__dirname, '..');
const DUMP = 'F:\\zuko_dev\\ASIAIR-flat-picker';
const DEST = 'F:\\zuko_dev\\Projects\\TEST_flat_set_picker_qa';
const LIGHT_CAA = 211;

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

function countFits(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((n) => /\.fit$/i.test(n)).length;
}

function fitNames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /\.fit$/i.test(n));
}

async function ensureDump() {
  const light = path.join(DUMP, 'Plan', 'Light');
  if (fs.existsSync(light)) return;
  console.log('Dump missing — building fixture (--no-upsert)');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-flat-set-picker-fixture.js'), '--no-upsert'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('fixture build failed');
}

async function scoredFor(ymd, filter) {
  const scan = await scanSession({
    projectDir: DUMP,
    nightDate: ymd,
    shootFilter: filter,
    skipTargetHint: true,
  });
  assert(`${ymd} ${filter} scan ok`, !!(scan && scan.ok), scan && scan.error);
  const ghost = (scan.filters || []).filter((r) => (r.lights || 0) === 0 && r.filter !== filter);
  assert(`${ymd} ${filter} no leftover 0-light rows`, ghost.length === 0, ghost.map((g) => g.filter).join(','));
  const lights = (scan.lights || []).filter((l) => normalizeFilter(l.filter) === filter);
  const scored = buildScoredFlatSets({
    flats: scan.flats || [],
    lights,
    biases: scan.biases || [],
    framerCaaDeg: LIGHT_CAA,
    lightTempC: -10,
    filters: [filter],
  });
  const sets = (scored.sets || []).filter((s) => s.filter === filter);
  return { scan, lights, scored, sets };
}

async function stageChoice({ night, filter, folder, choiceId, expectNight, expectCount }) {
  const staged = await stageSirilTree({
    projectDir: DEST,
    sourceDir: DUMP,
    nightDate: night,
    shootFolder: folder,
    shootFilter: filter,
    skipTargetHint: true,
    includeTargets: ['Picker target'],
    refCaaDeg: LIGHT_CAA,
    framerRotation: LIGHT_CAA,
    useMasterDarks: false,
    force: true,
    flatSetChoice: choiceId ? { [filter]: choiceId } : {},
  });
  assert(`${folder} stage ok`, !!(staged && staged.ok), staged && (staged.error || staged.code));
  const flatsDir = path.join(DEST, filter, folder, 'flats');
  const lightsDir = path.join(DEST, filter, folder, 'lights');
  const names = fitNames(flatsDir);
  assert(`${folder} lights copied`, countFits(lightsDir) >= 1, `n=${countFits(lightsDir)}`);
  assert(`${folder} flat count`, names.length === expectCount, `n=${names.length} expect ${expectCount}`);
  const otherNight = names.filter((n) => !n.includes(expectNight));
  assert(
    `${folder} flats are ${expectNight} only`,
    otherNight.length === 0,
    otherNight.slice(0, 3).join(', '),
  );
  return staged;
}

async function main() {
  console.log('Zuko flat-set picker QA');
  if (!fs.existsSync('F:\\zuko_dev')) {
    console.log('skip — F:\\zuko_dev not present');
    process.exit(0);
  }
  await ensureDump();
  if (fs.existsSync(DEST)) await fsp.rm(DEST, { recursive: true, force: true });
  await fsp.mkdir(DEST, { recursive: true });

  const ha824 = await scoredFor('20260824', 'Ha');
  assert('260824 Ha has 3 sets', ha824.sets.length === 3, `n=${ha824.sets.length}`);
  const haDef = ha824.sets.find((s) => s.isDefault);
  assert('260824 Ha closest is Aug 23', !!(haDef && haDef.night === '20260823'), haDef && haDef.stampLabel);
  assert(
    '260824 Ha radios are 10 / 8 / 5',
    ha824.sets.map((s) => s.count).sort((a, b) => b - a).join(',') === '10,8,5',
    ha824.sets.map((s) => s.count).join(','),
  );

  const oiii824 = await scoredFor('20260824', 'OIII');
  assert('260824 OIII has 3 sets', oiii824.sets.length === 3, `n=${oiii824.sets.length}`);
  const oiiiDef = oiii824.sets.find((s) => s.isDefault);
  assert('260824 OIII closest is Aug 22', !!(oiiiDef && oiiiDef.night === '20260822'), oiiiDef && oiiiDef.stampLabel);

  const ha821 = await scoredFor('20260821', 'Ha');
  const ha821Def = ha821.sets.find((s) => s.isDefault);
  assert('260821 Ha closest is Aug 20', !!(ha821Def && ha821Def.night === '20260820'), ha821Def && ha821Def.stampLabel);

  const scanAll = await scanSession({
    projectDir: DUMP,
    nightDate: '20260824',
    skipTargetHint: true,
  });
  const siiRow = (scanAll.filters || []).find((r) => r.filter === 'SII' && (r.lights || 0) === 0);
  assert('unfiltered scan has no SII 0-light row (no SII in dump)', !siiRow, siiRow && JSON.stringify(siiRow));

  const oldestHa = ha824.sets.find((s) => s.night === '20260816');
  assert('oldest Ha set present', !!(oldestHa && oldestHa.count === 5), oldestHa && oldestHa.label);

  await stageChoice({
    night: '20260824',
    filter: 'Ha',
    folder: 'qa_260824_Ha_default',
    choiceId: haDef.id,
    expectNight: '20260823',
    expectCount: 10,
  });
  await stageChoice({
    night: '20260824',
    filter: 'Ha',
    folder: 'qa_260824_Ha_aug16',
    choiceId: oldestHa.id,
    expectNight: '20260816',
    expectCount: 5,
  });
  await stageChoice({
    night: '20260824',
    filter: 'OIII',
    folder: 'qa_260824_OIII_default',
    choiceId: oiiiDef.id,
    expectNight: '20260822',
    expectCount: 9,
  });
  await stageChoice({
    night: '20260821',
    filter: 'Ha',
    folder: 'qa_260821_Ha_default',
    choiceId: ha821Def.id,
    expectNight: '20260820',
    expectCount: 8,
  });

  await fsp.rm(DEST, { recursive: true, force: true });
  pass('cleaned throwaway dest', DEST);

  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);
  console.log(`\n== Summary: ${passed.length} passed, ${failed.length} failed ==`);
  if (failed.length) {
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
