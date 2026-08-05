#!/usr/bin/env node
/**
 * Focused QA: Dark Library naming, prefer-master, remove-subs, delete safety,
 * session-bias readiness (Bias Library removed).
 */
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const {
  darkLibrarySetFolderName,
  formatLibraryTempLabel,
  matchMasterDarks,
  collectUsableDarkflats,
  removeCalibrationLibrarySubs,
  deleteCalibrationLibrarySet,
  indexDarkLibrary,
  evaluateIngestFrameReadiness,
  scanCalibrationLibraryImport,
} = require('../src/ingest/asiairIngest');

let failed = 0;
function assert(cond, msg, detail) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg, detail != null ? detail : '');
  } else {
    console.log('ok:', msg);
  }
}

async function withTemp(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zuko-calib-qa-'));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  console.log('\n== Naming / temp ==');
  assert(formatLibraryTempLabel(-10.4) === '-10c', '1°C temp label');
  assert(
    darkLibrarySetFolderName({ exposureSec: 180, bin: 2, tempC: -10 }) === 'Darks_180s_Bin2_-10c',
    'dark folder name'
  );

  console.log('\n== Prefer master on match ==');
  const idx = [
    { filePath: 'X\\master.fit', fileName: 'master.fit', kind: 'master', exposureSec: 180, gain: 100, tempC: -10, bin: 2, setFolder: 'X' },
    { filePath: 'X\\sub1.fit', fileName: 'sub1.fit', kind: 'sub', exposureSec: 180, gain: 100, tempC: -10, bin: 2, setFolder: 'X' },
    { filePath: 'X\\sub2.fit', fileName: 'sub2.fit', kind: 'sub', exposureSec: 180, gain: 100, tempC: -10, bin: 2, setFolder: 'X' },
  ];
  const darkM = matchMasterDarks({ index: idx, exposureSec: 180, gain: 100, tempC: -10, bin: 2 });
  assert(darkM.matches.length === 1 && darkM.matches[0].kind === 'master', 'darks prefer master.fit');

  console.log('\n== Session bias readiness (no Bias Library) ==');
  const ready = evaluateIngestFrameReadiness({
    lights: [{ filter: 'Ha', exposureSec: 180, gain: 100, tempC: -10 }],
    flats: [{ filter: 'Ha', exposureSec: 2, gain: 100, tempC: -10, bin: 1 }],
    biases: [{ filter: 'Ha', exposureSec: 2, gain: 100, tempC: -10, bin: 1 }],
    sessionDarks: [],
    useMasterDarks: true,
    masterDarkCount: 1,
    filters: ['Ha'],
    lightTempC: -10,
  });
  assert(ready.ok === true, 'ok with session bias + master dark', ready.missing);

  const missBias = evaluateIngestFrameReadiness({
    lights: [{ filter: 'Ha', exposureSec: 180 }],
    flats: [{ filter: 'Ha', exposureSec: 2, gain: 100, tempC: -10 }],
    biases: [],
    sessionDarks: [],
    useMasterDarks: true,
    masterDarkCount: 1,
    filters: ['Ha'],
    lightTempC: -10,
  });
  assert(!missBias.ok && missBias.missing.some((m) => /Bias/i.test(m)), 'fails without session bias', missBias.missing);

  const wrongExp = evaluateIngestFrameReadiness({
    lights: [{ filter: 'Ha', exposureSec: 180, tempC: -10 }],
    flats: [{ filter: 'Ha', exposureSec: 2, gain: 100, tempC: -10, bin: 1 }],
    biases: [{ filter: 'Ha', exposureSec: 0.5, gain: 100, tempC: -10, bin: 1 }],
    sessionDarks: [],
    useMasterDarks: true,
    masterDarkCount: 1,
    filters: ['Ha'],
    lightTempC: -10,
  });
  assert(
    !wrongExp.ok && wrongExp.missing.some((m) => /Bias matching Flat/i.test(m)),
    'fails when darkflat exp ≠ flat exp',
    wrongExp.missing
  );

  const wrongFlatTemp = evaluateIngestFrameReadiness({
    lights: [{ filter: 'Ha', exposureSec: 180, tempC: -10 }],
    flats: [{ filter: 'Ha', exposureSec: 2, gain: 100, tempC: 5, bin: 1 }],
    biases: [{ filter: 'Ha', exposureSec: 2, gain: 100, tempC: -10, bin: 1 }],
    sessionDarks: [],
    useMasterDarks: true,
    masterDarkCount: 1,
    filters: ['Ha'],
    lightTempC: -10,
  });
  assert(
    !wrongFlatTemp.ok && wrongFlatTemp.missing.some((m) => /Flat/i.test(m)),
    'fails when flat temp far from lights',
    wrongFlatTemp.missing
  );

  const mixed = collectUsableDarkflats(
    [
      { fileName: 'a.fit', exposureSec: 2, gain: 100, tempC: -10, bin: 1 },
      { fileName: 'b.fit', exposureSec: 5, gain: 100, tempC: -10, bin: 1 },
      { fileName: 'c.fit', exposureSec: 2, gain: 100, tempC: 10, bin: 1 },
    ],
    [{ exposureSec: 2, gain: 100, tempC: -10, bin: 1 }],
    { lightTempC: -10 }
  );
  assert(mixed.matches.length === 1 && mixed.matches[0].fileName === 'a.fit', 'collectUsableDarkflats keeps matching exp + light temp');
  assert(mixed.rejected.length === 2, 'rejects wrong exp and wrong light temp', mixed.rejected);

  const masterBiasIgnored = evaluateIngestFrameReadiness({
    lights: [{ filter: 'Ha' }],
    flats: [{ filter: 'Ha' }],
    biases: [],
    sessionDarks: [],
    useMasterDarks: true,
    masterDarkCount: 1,
    masterBiasCount: 99,
    filters: ['Ha'],
  });
  assert(
    !masterBiasIgnored.ok && masterBiasIgnored.missing.some((m) => /Bias/i.test(m)),
    'masterBiasCount ignored — session bias required',
    masterBiasIgnored.missing
  );

  console.log('\n== remove-subs / delete ==');
  await withTemp(async (root) => {
    const lib = path.join(root, 'Dark Library');
    const setDir = path.join(lib, 'Darks_180s_Bin2_-10c');
    await fsp.mkdir(setDir, { recursive: true });
    await fsp.writeFile(path.join(setDir, 'a.fit'), Buffer.alloc(4));
    await fsp.writeFile(path.join(setDir, 'b.fit'), Buffer.alloc(4));
    await fsp.writeFile(path.join(setDir, 'master.fit'), Buffer.alloc(8));

    const noMasterDir = path.join(lib, 'Darks_300s_Bin2_-10c');
    await fsp.mkdir(noMasterDir, { recursive: true });
    await fsp.writeFile(path.join(noMasterDir, 'only.fit'), Buffer.alloc(4));
    const bad = await removeCalibrationLibrarySubs({ setDir: noMasterDir, libraryPath: lib });
    assert(!bad.ok, 'remove-subs refuses set without master');

    const ok = await removeCalibrationLibrarySubs({ setDir, libraryPath: lib });
    assert(ok.ok && ok.removedCount === 2, 'remove-subs deletes 2 subs', ok);
    assert(fs.existsSync(path.join(setDir, 'master.fit')), 'master kept');
    assert(!fs.existsSync(path.join(setDir, 'a.fit')), 'subs gone');

    const delRoot = await deleteCalibrationLibrarySet({ setDir: lib, libraryPath: lib });
    assert(!delRoot.ok, 'delete refuses library root');
    const del = await deleteCalibrationLibrarySet({ setDir, libraryPath: lib });
    assert(del.ok && !fs.existsSync(setDir), 'delete removes set folder');
  });

  console.log('\n== Remove-flag on dark import scan ==');
  await withTemp(async (root) => {
    const src = path.join(root, 'asiair');
    await fsp.mkdir(src, { recursive: true });
    const scan = await scanCalibrationLibraryImport({
      sourceDir: src,
      darkLibraryPath: path.join(root, 'd'),
      removedDarkSets: ['Darks_180s_Bin2_-10c'],
    });
    assert(scan.ok && scan.sets.length === 0, 'empty source scan ok');
  });

  console.log('\n== Live Dark Library (F:) ==');
  const DARK = 'F:\\zuko_dev\\Dark Library';
  if (fs.existsSync(DARK)) {
    const d = await indexDarkLibrary(DARK);
    assert(d.ok, `dark index frames=${d.count} sets=${(d.sets || []).length}`);
  } else {
    console.log('skip: no F: Dark Library');
  }

  if (failed) {
    console.error(`\n${failed} FAILURE(S)`);
    process.exit(1);
  }
  console.log('\nCALIB FOCUSED QA OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
