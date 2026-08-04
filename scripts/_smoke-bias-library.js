#!/usr/bin/env node
/**
 * Smoke: Bias Library import + index + match (no Siril stack).
 * Usage: node scripts/_smoke-bias-library.js [asiairSource] [biasLibrary]
 */
const path = require('path');
const fs = require('fs');
const {
  importBiasSubsToLibrary,
  indexBiasLibrary,
  matchMasterBiases,
  indexDarkLibrary,
  evaluateIngestFrameReadiness,
} = require('../src/ingest/asiairIngest');

const SRC = process.argv[2] || 'F:\\ASIAIR-SampleData';
const LIB = process.argv[3] || 'F:\\zuko_dev\\Bias Library';
const DARK = 'F:\\zuko_dev\\Dark Library';

async function main() {
  console.log('source', SRC);
  console.log('bias lib', LIB);
  if (!fs.existsSync(SRC)) {
    console.error('ASIAIR source missing — skip import, test index only if lib has files');
  } else {
    const imp = await importBiasSubsToLibrary({ sourceDir: SRC, libraryPath: LIB });
    console.log('import ok=', imp.ok, 'copied=', imp.copied, 'skipped=', imp.skipped, 'sets=', (imp.sets || []).length);
    if (!imp.ok && !(imp.copied > 0)) {
      console.error('import failed', imp.error);
      process.exit(1);
    }
  }

  const idx = await indexBiasLibrary(LIB);
  console.log('index ok=', idx.ok, 'frames=', idx.count, 'sets=', (idx.sets || []).length, 'size=', idx.sizeBytes);
  if (!idx.ok) {
    console.error(idx.error);
    process.exit(1);
  }

  const sample = (idx.index || []).find((f) => f.kind !== 'master' && f.exposureSec != null) || idx.index[0];
  if (sample) {
    const m = matchMasterBiases({
      index: idx.index,
      exposureSec: sample.exposureSec,
      gain: sample.gain,
      tempC: sample.tempC,
      bin: sample.bin,
    });
    console.log('match count=', m.matches.length, 'preferMaster sample kinds=', m.matches.map((x) => x.kind).slice(0, 5));
  }

  const darkIdx = await indexDarkLibrary(DARK);
  console.log('dark index ok=', darkIdx.ok, 'frames=', darkIdx.count, 'sets=', (darkIdx.sets || []).length);

  const readiness = evaluateIngestFrameReadiness({
    lights: [{ filter: 'Ha', exposureSec: 180 }],
    flats: [{ filter: 'Ha', exposureSec: 2 }],
    biases: [],
    sessionDarks: [],
    useMasterDarks: true,
    useMasterBiases: true,
    masterDarkCount: (darkIdx.index || []).length > 0 ? 10 : 0,
    masterBiasCount: (idx.index || []).length > 0 ? 1 : 0,
    filters: ['Ha'],
  });
  console.log('readiness with masters ok=', readiness.ok, readiness.missing || []);

  console.log('SMOKE OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
