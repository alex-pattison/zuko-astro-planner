#!/usr/bin/env node
/**
 * Filename parse checks for legacy + post-260815 ASIAIR naming
 * (camera / gain / rotator tokens).
 * Usage: node scripts/qa-asiair-filename.js
 */
'use strict';

const { parseAsiairFilename } = require('../src/ingest/asiairIngest');

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok ', name);
  else {
    failed += 1;
    console.error('  FAIL', name, detail == null ? '' : detail);
  }
}

function expect(name, file, want) {
  const got = parseAsiairFilename(file);
  const keys = Object.keys(want);
  const bad = keys.filter((k) => got[k] !== want[k]);
  check(name, bad.length === 0, bad.length ? JSON.stringify({ want, got: Object.fromEntries(keys.map((k) => [k, got[k]])) }) : '');
}

console.log('=== asiair filename parse ===');

expect('legacy light', 'Light_NGC 6960_180.0s_Bin2_S_20260725-233856_-10.0C_0001.fit', {
  type: 'light',
  target: 'NGC 6960',
  exposureSec: 180,
  bin: 2,
  camera: null,
  filter: 'SII',
  gain: null,
  date: '20260725',
  time: '233856',
  rotatorDeg: null,
  tempC: -10,
  sequence: 1,
  matched: true,
});

expect('legacy bias', 'Bias_500.0ms_Bin2_H_20260804-185515_-9.4C_0030.fit', {
  type: 'darkflat',
  camera: null,
  filter: 'Ha',
  gain: null,
  date: '20260804',
  time: '185515',
  rotatorDeg: null,
  tempC: -9.4,
  sequence: 30,
});

expect('new light camera+gain+rot', 'Light_Veil center ap q326_180.0s_Bin2_294MM_H_gain120_20260815-214722_211deg_-9.4C_0001.fit', {
  type: 'light',
  target: 'Veil center ap q326',
  exposureSec: 180,
  bin: 2,
  camera: '294MM',
  filter: 'Ha',
  gain: 120,
  date: '20260815',
  time: '214722',
  rotatorDeg: 211,
  tempC: -9.4,
  sequence: 1,
  matched: true,
});

expect('new flat OIII', 'Flat_500.0ms_Bin2_294MM_O_gain120_20260816-002800_211deg_-10.0C_0012.fit', {
  type: 'flat',
  camera: '294MM',
  filter: 'OIII',
  gain: 120,
  date: '20260816',
  rotatorDeg: 211,
  sequence: 12,
});

expect('new bias SII', 'Bias_500.0ms_Bin2_294MM_S_gain120_20260816-003100_211deg_-10.0C_0005.fit', {
  type: 'darkflat',
  camera: '294MM',
  filter: 'SII',
  gain: 120,
  rotatorDeg: 211,
  sequence: 5,
});

expect('ASI294MM camera strip', 'Light_T_1.0s_Bin1_ASI294MM_H_gain100_20260101-120000_0deg_-10.0C_0001.fit', {
  camera: '294MM',
  filter: 'Ha',
  gain: 100,
  rotatorDeg: 0,
  bin: 1,
});

check('garbage unmatched', parseAsiairFilename('not-a-fit.txt').matched === false);

if (failed) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log('\nqa-asiair-filename: all checks passed');
