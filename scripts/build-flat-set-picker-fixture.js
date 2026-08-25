#!/usr/bin/env node
/**
 * Synthetic ASIAIR dump for testing the Import flat-set picker.
 * Writes under F:\zuko_dev (not H: Beta). Header-only FITS.
 *
 *   F:\zuko_dev\ASIAIR-flat-picker\              ← dump (ASIAIR source)
 *   F:\zuko_dev\Projects\TEST_flat_set_picker\   ← empty Siril dest
 *
 * Default: build FITS + upsert [TEST] Flat-set picker into repo data/.
 *   node scripts/build-flat-set-picker-fixture.js
 *   node scripts/build-flat-set-picker-fixture.js --no-upsert
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { scanSession, buildScoredFlatSets, normalizeFilter } = require('../src/ingest/asiairIngest');

const ROOT = path.resolve(__dirname, '..');
const DUMP = 'F:\\zuko_dev\\ASIAIR-flat-picker';
const WORK = 'F:\\zuko_dev\\Projects\\TEST_flat_set_picker';
const DATA_PATH = path.join(ROOT, 'data', 'zuko-dashboard-data.json');

const TARGET = 'Picker target';
const OBJECT = 'Synthetic Picker Target';
const GAIN = 120;
const TEMP = -10;
const LIGHT_EXP = 180;
const LIGHT_YMD = '20260824';
const LIGHT_YMD_EARLY = '20260821';
const LIGHT_CAA = 211;
const FLAT_CAA = 32;

function pad80(s) {
  const t = String(s).slice(0, 80);
  return t + ' '.repeat(80 - t.length);
}

function fitsValue(v) {
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  if (typeof v === 'number') {
    const s = Number.isInteger(v) ? String(v) : String(v);
    return s.padStart(20, ' ');
  }
  const q = `'${String(v).replace(/'/g, "''")}'`;
  return q.padEnd(20, ' ');
}

function fitsCard(key, value, comment) {
  const k = String(key).toUpperCase().padEnd(8, ' ').slice(0, 8);
  let card;
  if (value === undefined) {
    card = k;
  } else {
    card = `${k}= ${fitsValue(value)}`;
    if (comment) card += ` / ${comment}`;
  }
  return pad80(card);
}

function buildMinimalFits(kw = {}) {
  const cards = [
    fitsCard('SIMPLE', true, 'synthetic picker fixture'),
    fitsCard('BITPIX', 8, 'character'),
    fitsCard('NAXIS', 0, 'no image data'),
    fitsCard('EXTEND', true),
  ];
  for (const [k, v] of Object.entries(kw)) {
    if (v == null) continue;
    cards.push(fitsCard(k, v));
  }
  cards.push(pad80('END'));
  let header = cards.join('');
  const pad = (2880 - (header.length % 2880)) % 2880;
  header += ' '.repeat(pad);
  return Buffer.from(header, 'ascii');
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function writeFit(filePath, kw) {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, buildMinimalFits(kw));
}

function expToken(sec) {
  if (sec < 1) return `${(sec * 1000).toFixed(1)}ms`;
  return Number.isInteger(sec) ? `${sec}.0s` : `${sec}s`;
}

function stamp(ymd, hms) {
  return `${ymd}-${hms}`;
}

function headerBase(opts) {
  const ymd = opts.ymd;
  const hms = opts.hms;
  const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
  return {
    OBJECT: opts.object || OBJECT,
    FILTER: opts.filter,
    EXPTIME: opts.exptime,
    GAIN,
    'CCD-TEMP': TEMP,
    'SET-TEMP': TEMP,
    XBINNING: 2,
    ROTATOR: opts.caa,
    'DATE-OBS': iso,
    IMAGETYP: opts.imagetyp,
  };
}

function lightName(target, letter, ymd, hms, seq) {
  return `Light_${target}_${expToken(LIGHT_EXP)}_Bin2_294MM_${letter}_gain${GAIN}_${stamp(ymd, hms)}_${LIGHT_CAA}deg_${TEMP.toFixed(1)}C_${String(seq).padStart(4, '0')}.fit`;
}

function calibName(kind, expSec, letter, ymd, hms, caa, seq) {
  return `${kind}_${expToken(expSec)}_Bin2_294MM_${letter}_gain${GAIN}_${stamp(ymd, hms)}_${caa}deg_${TEMP.toFixed(1)}C_${String(seq).padStart(4, '0')}.fit`;
}

async function writeSeq(dir, { kind, filter, letter, ymd, hms0, count, expSec, caa, object, imagetyp, nameFn }) {
  const base = parseInt(hms0, 10);
  for (let i = 0; i < count; i += 1) {
    const hms = String(base + i).padStart(6, '0');
    const name = nameFn({ letter, ymd, hms, seq: i + 1, expSec, caa });
    await writeFit(path.join(dir, name), headerBase({
      filter, ymd, hms, exptime: expSec, imagetyp, object, caa,
    }));
  }
}

async function buildDump() {
  if (fs.existsSync(DUMP)) await fsp.rm(DUMP, { recursive: true, force: true });
  if (fs.existsSync(WORK)) await fsp.rm(WORK, { recursive: true, force: true });
  await ensureDir(WORK);

  const lightDir = path.join(DUMP, 'Plan', 'Light', TARGET);
  const flatDir = path.join(DUMP, 'Autorun', 'Flat');
  const biasDir = path.join(DUMP, 'Autorun', 'Bias');
  const darkDir = path.join(DUMP, 'Autorun', 'Dark');

  await writeSeq(lightDir, {
    kind: 'Light', filter: 'Ha', letter: 'H', ymd: LIGHT_YMD, hms0: '203000', count: 6,
    expSec: LIGHT_EXP, caa: LIGHT_CAA, imagetyp: 'Light',
    nameFn: ({ letter, ymd, hms, seq }) => lightName(TARGET, letter, ymd, hms, seq),
  });
  await writeSeq(lightDir, {
    kind: 'Light', filter: 'OIII', letter: 'O', ymd: LIGHT_YMD, hms0: '211000', count: 6,
    expSec: LIGHT_EXP, caa: LIGHT_CAA, imagetyp: 'Light',
    nameFn: ({ letter, ymd, hms, seq }) => lightName(TARGET, letter, ymd, hms, seq),
  });
  await writeSeq(lightDir, {
    kind: 'Light', filter: 'Ha', letter: 'H', ymd: LIGHT_YMD_EARLY, hms0: '210000', count: 5,
    expSec: LIGHT_EXP, caa: LIGHT_CAA, imagetyp: 'Light',
    nameFn: ({ letter, ymd, hms, seq }) => lightName(TARGET, letter, ymd, hms, seq),
  });

  // Same exp/gain/CAA; nights a few days apart so the picker has multiple radios.
  const flatNights = [
    { filter: 'Ha', letter: 'H', ymd: '20260823', hms: '175500', count: 10 },
    { filter: 'Ha', letter: 'H', ymd: '20260820', hms: '180000', count: 8 },
    { filter: 'Ha', letter: 'H', ymd: '20260816', hms: '183000', count: 5 },
    { filter: 'OIII', letter: 'O', ymd: '20260822', hms: '174000', count: 9 },
    { filter: 'OIII', letter: 'O', ymd: '20260819', hms: '181000', count: 7 },
    { filter: 'OIII', letter: 'O', ymd: '20260815', hms: '184000', count: 4 },
  ];
  for (const set of flatNights) {
    const biasHms = String(parseInt(set.hms, 10) + 100).padStart(6, '0');
    await writeSeq(flatDir, {
      kind: 'Flat', filter: set.filter, letter: set.letter, ymd: set.ymd, hms0: set.hms, count: set.count,
      expSec: 0.5, caa: FLAT_CAA, imagetyp: 'Flat', object: 'Flat',
      nameFn: ({ letter, ymd, hms, seq, expSec, caa }) => calibName('Flat', expSec, letter, ymd, hms, caa, seq),
    });
    await writeSeq(biasDir, {
      kind: 'Bias', filter: set.filter, letter: set.letter, ymd: set.ymd, hms0: biasHms, count: set.count,
      expSec: 0.5, caa: FLAT_CAA, imagetyp: 'Bias', object: 'Bias',
      nameFn: ({ letter, ymd, hms, seq, expSec, caa }) => calibName('Bias', expSec, letter, ymd, hms, caa, seq),
    });
  }

  await writeSeq(darkDir, {
    kind: 'Dark', filter: 'Ha', letter: 'H', ymd: '20260822', hms0: '140000', count: 3,
    expSec: LIGHT_EXP, caa: 0, imagetyp: 'Dark', object: 'Dark',
    nameFn: ({ letter, ymd, hms, seq, expSec }) => calibName('Dark', expSec, letter, ymd, hms, 0, seq),
  });

  console.log('Wrote dump', DUMP);
  console.log('Wrote empty Siril dest', WORK);
}

function testProject() {
  return {
    name: '[TEST] Flat-set picker',
    target: 'Synthetic Picker Target — not a real object',
    frameMode: 'TEST — header-only FITS under F:\\zuko_dev\\ASIAIR-flat-picker',
    projectDir: WORK,
    centerCoords: 'RA 0h0m0s  Dec +0°0\'0"',
    rotation: '211°',
    status: 'active',
    notes:
      'TEST ONLY — dump F:\\zuko_dev\\ASIAIR-flat-picker (not Beta, not Desktop dump). ' +
      'Lights 260824 Ha(6)+OIII(6) and 260821 Ha(5). ' +
      'Ha flats Aug 23/20/16 · OIII flats Aug 22/19/15. ' +
      'Import 260824 Ha → closest Aug 23 (3 radios). Import 260824 OIII → closest Aug 22. ' +
      'Import 260821 Ha → closest Aug 20. Do not Import into Veil from this dump. ' +
      'Rebuild: node scripts/build-flat-set-picker-fixture.js',
    filterTargets: [
      { filter: 'Ha', location: 'Home', bortle: '9', targetHrs: 1, loggedHrs: 0.55 },
      { filter: 'OIII', location: 'Home', bortle: '9', targetHrs: 1, loggedHrs: 0.3 },
    ],
    checklist: [
      { id: 'test-flat-sets-824', text: 'TEST: Ha 260824 shows 3 flat-set radios; closest is Aug 23', done: false },
      { id: 'test-flat-sets-824-oiii', text: 'TEST: OIII 260824 shows 3 radios; closest is Aug 22', done: false },
      { id: 'test-flat-sets-821', text: 'TEST: Ha 260821 closest switches to Aug 20', done: false },
    ],
    shoots: [
      {
        date: '260824',
        filterIndex: 0,
        hours: 0.3,
        complete: true,
        creditedHours: 0.3,
        sourcePath: null,
        ingestPath: null,
        ingestMeta: null,
      },
      {
        date: '260824',
        filterIndex: 1,
        hours: 0.3,
        complete: true,
        creditedHours: 0.3,
        sourcePath: null,
        ingestPath: null,
        ingestMeta: null,
      },
      {
        date: '260821',
        filterIndex: 0,
        hours: 0.25,
        complete: true,
        creditedHours: 0.25,
        sourcePath: null,
        ingestPath: null,
        ingestMeta: null,
      },
    ],
    astrobinLinks: [],
    savedTarget: { name: 'Synthetic Picker Target', ra: 0, dec: 0 },
    framerMode: 'reducer',
    framerRotation: 211,
    processStatus: 'planning',
  };
}

async function upsertProject() {
  const raw = await fsp.readFile(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  const next = testProject();
  const idx = (data.projects || []).findIndex((p) =>
    String(p.name || '').startsWith('[TEST] Flat-set picker'));
  if (idx >= 0) {
    data.projects[idx] = next;
    console.log('Updated [TEST] Flat-set picker at index', idx);
  } else {
    data.projects = data.projects || [];
    data.projects.push(next);
    console.log('Added [TEST] Flat-set picker at index', data.projects.length - 1);
  }
  data.asiairSourcePath = DUMP;
  if (!data.appMeta) data.appMeta = {};
  data.appMeta.savedAt = new Date().toISOString();
  await fsp.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log('ASIAIR source →', DUMP);
  console.log('Wrote', DATA_PATH, '(Dev JSON only — Beta H: not touched)');
}

async function selfCheckNight(ymd, filter, expectFlatNight) {
  const scan = await scanSession({
    projectDir: DUMP,
    nightDate: ymd,
    shootFilter: filter,
    skipTargetHint: true,
  });
  if (!scan.ok) throw new Error(scan.error || 'scan failed');
  const ghost = (scan.filters || []).filter((r) => (r.lights || 0) === 0 && r.filter !== filter);
  if (ghost.length) {
    throw new Error(`${ymd} ${filter}: leftover 0-light rows ${ghost.map((g) => g.filter).join(',')}`);
  }
  const lights = (scan.lights || []).filter((l) => normalizeFilter(l.filter) === filter);
  if (!lights.length) throw new Error(`no ${filter} lights on ${ymd}`);
  const scored = buildScoredFlatSets({
    flats: scan.flats || [],
    lights,
    biases: scan.biases || [],
    framerCaaDeg: LIGHT_CAA,
    lightTempC: -10,
    filters: [filter],
  });
  const sets = (scored.sets || []).filter((s) => s.filter === filter);
  if (sets.length < 3) throw new Error(`expected ≥3 ${filter} flat sets, got ${sets.length}`);
  const def = sets.find((s) => s.isDefault);
  if (!def || def.night !== expectFlatNight) {
    throw new Error(`${ymd} ${filter}: default set should be ${expectFlatNight}, got ${def && def.night}`);
  }
  console.log(
    `Self-check ${ymd} ${filter} lights=${lights.length} —`,
    sets.map((s) => `${s.stampLabel} n=${s.count}${s.isDefault ? ' (closest)' : ''}`).join(' · '),
  );
}

async function selfCheck() {
  await selfCheckNight(LIGHT_YMD, 'Ha', '20260823');
  await selfCheckNight(LIGHT_YMD, 'OIII', '20260822');
  await selfCheckNight(LIGHT_YMD_EARLY, 'Ha', '20260820');
}

async function main() {
  const noUpsert = process.argv.includes('--no-upsert');
  await buildDump();
  await selfCheck();
  if (!noUpsert) await upsertProject();
  else console.log('Skipped dashboard upsert (--no-upsert)');
  console.log('\nTest: open [TEST] Flat-set picker (not Veil) → Import 260824 Ha, then OIII, then 260821 Ha');
  console.log('ASIAIR source:', DUMP);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
