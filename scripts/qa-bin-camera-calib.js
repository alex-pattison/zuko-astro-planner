#!/usr/bin/env node
/**
 * Bin + camera calibration identity.
 * Bin1 and Bin2 of the same camera are different grids and must not share darks,
 * flats, or dark flats. Smoke-reads the Pacman Bin1 copy when it is on disk.
 *
 * Usage: node scripts/qa-bin-camera-calib.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  canonicalCameraId,
  expectedSensorMode,
  calibrationProfile,
  darkLibrarySetFolderName,
  parseLibrarySetFolderName,
  matchMasterDarks,
  buildScoredFlatSets,
  parseAsiairFilename,
  parseFitFile,
  scanSession,
  indexDarkLibrary,
} = require('../src/ingest/asiairIngest');

const PACMAN = 'F:\\Astrophotography Dev\\zuko_dev\\Pacman Nebula';
const DARK_LIB = 'F:\\Astrophotography Dev\\zuko_dev\\Dark Library';

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok ', name);
  else {
    failed += 1;
    console.error('  FAIL', name, detail == null ? '' : detail);
  }
}

function dark(extra) {
  return {
    filePath: extra.filePath || 'd.fit',
    fileName: extra.fileName || 'd.fit',
    kind: extra.kind || 'master',
    exposureSec: 180,
    gain: 120,
    tempC: -10,
    offset: 30,
    ...extra,
  };
}

console.log('=== camera id ===');
check('294MM → asi294mm', canonicalCameraId('294MM') === 'asi294mm');
check('ASI294MM → asi294mm', canonicalCameraId('ASI294MM') === 'asi294mm');
check('header instrument', canonicalCameraId('ZWO ASI294MM Pro') === 'asi294mm');
check('color is a different id', canonicalCameraId('ASI294MC Pro') === 'asi294mc');
check('filename Bin1 294MM', parseAsiairFilename(
  'Light_NGC 281_180.0s_Bin1_294MM_H_gain120_20261018-192609_283deg_-10.0C_0001.fit'
).camera === 'asi294mm');
check('filename Bin1', parseAsiairFilename(
  'Light_NGC 281_180.0s_Bin1_294MM_H_gain120_20261018-192609_283deg_-10.0C_0001.fit'
).bin === 1);

console.log('\n=== library folder names ===');
check(
  'legacy name unchanged',
  darkLibrarySetFolderName({ exposureSec: 180, bin: 2, tempC: -10 }) === 'Darks_180s_Bin2_-10c',
);
const named = darkLibrarySetFolderName({ exposureSec: 180, bin: 1, tempC: -10, camera: '294MM' });
check('new set names the camera', named === 'Darks_180s_Bin1_asi294mm_-10c', named);
const parsed = parseLibrarySetFolderName(named);
check('parser reads camera folder', parsed && parsed.bin === 1 && parsed.camera === 'asi294mm' && parsed.tempC === -10, JSON.stringify(parsed));
const legacy = parseLibrarySetFolderName('Darks_180s_Bin2_-10c');
check('parser still reads legacy folder', legacy && legacy.bin === 2 && legacy.camera == null && legacy.tempC === -10, JSON.stringify(legacy));

console.log('\n=== dark match ===');
const bin2 = dark({
  filePath: 'lib\\master.fit',
  bin: 2,
  camera: 'asi294mm',
  naxis1: 4144,
  naxis2: 2822,
});
const bin1 = dark({
  filePath: 'sess\\dark.fit',
  kind: 'sub',
  bin: 1,
  camera: 'asi294mm',
  naxis1: 8288,
  naxis2: 5644,
});
const lightBin1 = {
  exposureSec: 180,
  gain: 120,
  tempC: -10,
  bin: 1,
  camera: 'asi294mm',
  naxis1: 8288,
  naxis2: 5644,
  offset: 30,
};
const rejectedLib = matchMasterDarks({ index: [bin2], ...lightBin1 });
check(
  'Bin2 master does not match Bin1 lights',
  rejectedLib.matches.length === 0 && rejectedLib.rejected.some((r) => r.reason === 'bin mismatch'),
  JSON.stringify(rejectedLib.rejected.map((r) => r.reason)),
);
const sessionOk = matchMasterDarks({ index: [bin1, bin2], ...lightBin1 });
check('Bin1 session dark matches', sessionOk.matches.length === 1 && sessionOk.matches[0].bin === 1);
const missingBin = matchMasterDarks({
  index: [dark({ bin: null, naxis1: null, naxis2: null, camera: null })],
  exposureSec: 180,
  gain: 120,
  tempC: -10,
  bin: 1,
});
check('dark with no bin is rejected', missingBin.matches.length === 0 && missingBin.rejected[0].reason === 'bin missing');
const otherCam = matchMasterDarks({
  index: [dark({ bin: 1, camera: 'asi294mc', naxis1: 8288, naxis2: 5644 })],
  ...lightBin1,
});
check('different camera rejected', otherCam.matches.length === 0 && otherCam.rejected[0].reason === 'camera mismatch');
const badSize = matchMasterDarks({
  index: [dark({ bin: 1, camera: 'asi294mm', naxis1: 4144, naxis2: 2822 })],
  ...lightBin1,
});
check('same bin, wrong frame size rejected', badSize.matches.length === 0 && badSize.rejected[0].reason === 'geometry mismatch');
const badOffset = matchMasterDarks({
  index: [dark({ bin: 1, camera: 'asi294mm', naxis1: 8288, naxis2: 5644, offset: 50 })],
  ...lightBin1,
});
check('offset mismatch rejected', badOffset.matches.length === 0 && badOffset.rejected[0].reason === 'offset mismatch');
const omitted = matchMasterDarks({
  index: [dark({ bin: 2, camera: null, naxis1: null, naxis2: null, offset: null })],
  exposureSec: 180,
  gain: 120,
  tempC: -10,
});
check('callers that omit bin still match (older tests)', omitted.matches.length === 1);

console.log('\n=== flat set vs light bin ===');
const lights = [{ filter: 'Ha', exposureSec: 180, bin: 1, camera: 'asi294mm', rotatorDeg: 283, tempC: -10 }];
const flats = [
  { filePath: 'f1', filter: 'Ha', exposureSec: 0.5, gain: 120, bin: 2, camera: 'asi294mm', rotatorDeg: 283, tempC: -10 },
  { filePath: 'f2', filter: 'Ha', exposureSec: 0.5, gain: 120, bin: 1, camera: 'asi294mm', rotatorDeg: 283, tempC: -10 },
];
const scored = buildScoredFlatSets({ flats, lights, biases: [], lightTempC: -10 });
const def = (scored.sets || []).find((s) => s.isDefault);
check('default flat set is Bin1', def && def.bin === 1, def && def.label);
check('Bin2 flat set is not default', (scored.sets || []).some((s) => s.bin === 2 && !s.isDefault));

const mode = expectedSensorMode('ZWO ASI294MM Pro', 1);
check('Bin1 full frame is 8288×5644', mode && mode.naxis1 === 8288 && mode.naxis2 === 5644);
const mode2 = expectedSensorMode('asi294mm', 2);
check('Bin2 full frame is 4144×2822', mode2 && mode2.naxis1 === 4144 && mode2.naxis2 === 2822);

const mixed = calibrationProfile([
  { bin: 1, camera: 'asi294mm', naxis1: 8288, naxis2: 5644 },
  { bin: 2, camera: 'asi294mm', naxis1: 4144, naxis2: 2822 },
]);
check('mixed bins flagged', mixed.binMixed === true && mixed.bin == null);

async function smokePacman() {
  console.log('\n=== Pacman Bin1 smoke ===');
  if (!fs.existsSync(PACMAN)) {
    console.log('  skip  Pacman copy not on this machine');
    return;
  }
  const sample = path.join(
    PACMAN, 'Light', 'NGC 281',
    'Light_NGC 281_180.0s_Bin1_294MM_H_gain120_20261018-192609_283deg_-10.0C_0001.fit',
  );
  const one = await parseFitFile(sample, 'light');
  check('header bin 1', one.bin === 1, String(one.bin));
  check('header camera', one.camera === 'asi294mm', one.camera);
  check('header 8288×5644', one.naxis1 === 8288 && one.naxis2 === 5644, `${one.naxis1}x${one.naxis2}`);
  check('header pixel 2.315 µm', one.pixelUm != null && Math.abs(one.pixelUm - 2.315) < 0.01, String(one.pixelUm));
  check('header offset 30', one.offset === 30, String(one.offset));
  check('header gain 120', one.gain === 120);

  const scan = await scanSession({ projectDir: PACMAN, skipTargetHint: true });
  check('scan ok', scan.ok === true, scan.error);
  const lightsN = (scan.lights || []).length;
  const filters = [...new Set((scan.lights || []).map((l) => l.filter))].sort();
  check('SHO lights present', lightsN > 0 && filters.join(',') === 'Ha,OIII,SII', `${lightsN} ${filters.join(',')}`);
  const bins = [...new Set((scan.lights || []).map((l) => l.bin))];
  check('every light is Bin1', bins.length === 1 && bins[0] === 1, bins.join(','));
  const cams = [...new Set((scan.lights || []).map((l) => l.camera))];
  check('every light is asi294mm', cams.length === 1 && cams[0] === 'asi294mm', cams.join(','));
  const rows = scan.filters || [];
  check(
    'filter rows carry Bin1',
    rows.filter((r) => r.lights).every((r) => r.bin === 1 && r.camera === 'asi294mm' && r.naxis1 === 8288),
    rows.map((r) => `${r.filter} bin=${r.bin} ${r.naxis1}x${r.naxis2} n=${r.lights}`).join(' | '),
  );
  const flatBins = [...new Set((scan.flats || []).map((f) => f.bin))];
  const darkBins = [...new Set((scan.darks || []).map((d) => d.bin))];
  const biasBins = [...new Set((scan.biases || []).map((b) => b.bin))];
  check('flats Bin1', flatBins.length === 1 && flatBins[0] === 1, flatBins.join(','));
  check('session darks Bin1', darkBins.length === 1 && darkBins[0] === 1 && (scan.darks || []).length >= 1, `${(scan.darks || []).length} bins=${darkBins}`);
  check('dark flats Bin1', biasBins.length === 1 && biasBins[0] === 1, biasBins.join(','));

  const ha = (scan.filters || []).find((r) => r.filter === 'Ha');
  const sessionMatch = matchMasterDarks({
    index: scan.darks || [],
    exposureSec: ha.exposureSec,
    gain: ha.gain,
    tempC: ha.tempC,
    bin: ha.bin,
    camera: ha.camera,
    naxis1: ha.naxis1,
    naxis2: ha.naxis2,
    offset: ha.offset,
  });
  check('session Bin1 darks match Ha', sessionMatch.matches.length >= 1, `m=${sessionMatch.matches.length}`);

  if (fs.existsSync(DARK_LIB)) {
    const lib = await indexDarkLibrary(DARK_LIB);
    check('dark library indexed', lib.ok && (lib.index || []).length > 0, lib.error);
    const libMatch = matchMasterDarks({
      index: lib.index || [],
      exposureSec: ha.exposureSec,
      gain: ha.gain,
      tempC: ha.tempC,
      bin: ha.bin,
      camera: ha.camera,
      naxis1: ha.naxis1,
      naxis2: ha.naxis2,
      offset: ha.offset,
    });
    check(
      'Bin2 library does not match Bin1 Ha',
      libMatch.matches.length === 0,
      `matches=${libMatch.matches.length} reasons=${[...new Set((libMatch.rejected || []).map((r) => r.reason))].join(',')}`,
    );
    const asBin2 = matchMasterDarks({
      index: lib.index || [],
      exposureSec: 180,
      gain: 120,
      tempC: -10,
      bin: 2,
      camera: 'asi294mm',
      naxis1: 4144,
      naxis2: 2822,
      offset: 30,
    });
    check('same library still matches a Bin2 profile', asBin2.matches.length >= 1, `m=${asBin2.matches.length}`);
  } else {
    console.log('  skip  Dark Library not on this machine');
  }
}

smokePacman().then(() => {
  if (failed) {
    console.error(`\n${failed} checks failed`);
    process.exit(1);
  }
  console.log('\nqa-bin-camera-calib: all checks passed');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
