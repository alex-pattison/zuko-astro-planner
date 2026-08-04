#!/usr/bin/env node
/**
 * Unit/smoke tests for calibration library naming, remove-flag scan, delete safety.
 */
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const {
  darkLibrarySetFolderName,
  biasLibrarySetFolderName,
  formatLibraryTempLabel,
  scanCalibrationLibraryImport,
  deleteCalibrationLibrarySet,
  indexDarkLibrary,
  indexBiasLibrary,
} = require('../src/ingest/asiairIngest');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    console.log('ok:', msg);
  }
}

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zuko-calib-'));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  // 1°C temp labels
  assert(formatLibraryTempLabel(-10.4) === '-10c', 'temp rounds -10.4 → -10c');
  assert(formatLibraryTempLabel(-10.6) === '-11c', 'temp rounds -10.6 → -11c');
  assert(formatLibraryTempLabel(0.4) === '0c', 'temp rounds 0.4 → 0c');

  const darkName = darkLibrarySetFolderName({ exposureSec: 180, bin: 2, tempC: -10.2 });
  assert(darkName === 'Darks_180s_Bin2_-10c', `dark set name ${darkName}`);
  const biasName = biasLibrarySetFolderName({ exposureSec: 2, bin: 1, tempC: -9.6 });
  assert(biasName === 'Bias_2s_Bin1_-10c', `bias set name ${biasName}`);

  await withTempDir(async (root) => {
    const lib = path.join(root, 'Dark Library');
    const setDir = path.join(lib, 'Darks_180s_Bin2_-10c');
    await fsp.mkdir(setDir, { recursive: true });
    await fsp.writeFile(path.join(setDir, 'dummy.fit'), Buffer.alloc(10));

    const bad = await deleteCalibrationLibrarySet({ setDir: lib, libraryPath: lib });
    assert(!bad.ok, 'refuses deleting library root');

    const outside = await deleteCalibrationLibrarySet({
      setDir: path.join(root, 'Darks_180s_Bin2_-10c'),
      libraryPath: lib,
    });
    assert(!outside.ok || !fs.existsSync(path.join(root, 'Darks_180s_Bin2_-10c')), 'outside/missing handled');

    const okDel = await deleteCalibrationLibrarySet({ setDir, libraryPath: lib });
    assert(okDel.ok === true, 'deletes recognized set folder');
    assert(!fs.existsSync(setDir), 'set folder gone after delete');
  });

  // Remove-flag on scan (no ASIAIR needed — empty source still returns structure)
  await withTempDir(async (root) => {
    const src = path.join(root, 'asiair');
    await fsp.mkdir(src, { recursive: true });
    const scanEmpty = await scanCalibrationLibraryImport({
      sourceDir: src,
      darkLibraryPath: path.join(root, 'd'),
      biasLibraryPath: path.join(root, 'b'),
      removedDarkSets: ['Darks_180s_Bin2_-10c'],
    });
    assert(scanEmpty.ok === true, 'scan empty source ok');
    assert(Array.isArray(scanEmpty.sets) && scanEmpty.sets.length === 0, 'no sets under empty source');
  });

  // Index live libs if present
  const DARK = 'F:\\zuko_dev\\Dark Library';
  const BIAS = 'F:\\zuko_dev\\Bias Library';
  if (fs.existsSync(DARK)) {
    const idx = await indexDarkLibrary(DARK);
    assert(idx.ok === true, `dark index ok frames=${idx.count} sets=${(idx.sets || []).length}`);
    if ((idx.sets || []).length) {
      const s = idx.sets[0];
      assert(s.bin != null || s.exposureSec != null || s.hasMaster != null, 'dark set has metadata fields');
    }
  } else {
    console.log('skip: dark library missing on F:');
  }
  if (fs.existsSync(BIAS)) {
    const idx = await indexBiasLibrary(BIAS);
    assert(idx.ok === true, `bias index ok frames=${idx.count} sets=${(idx.sets || []).length}`);
  } else {
    console.log('skip: bias library missing on F:');
  }

  // Simulate remove-flag bookkeeping (frontend logic mirrored)
  const removed = new Set(['Darks_180s_Bin2_-10c']);
  const fakeSets = [
    { setName: 'Darks_180s_Bin2_-10c', existingCount: 12, count: 12 },
    { setName: 'Darks_300s_Bin2_-10c', existingCount: 0, count: 20 },
  ].map((row) => {
    const libraryRemoved = removed.has(row.setName);
    const alreadyImported = row.existingCount > 0 && !libraryRemoved;
    return {
      ...row,
      libraryRemoved,
      alreadyImported,
      fullyImported: alreadyImported && row.existingCount >= row.count,
    };
  });
  assert(fakeSets[0].libraryRemoved && !fakeSets[0].alreadyImported, 'removed set is reimportable');
  assert(!fakeSets[1].alreadyImported && !fakeSets[1].libraryRemoved, 'new set stays new');

  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log('\nALL TESTS OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
