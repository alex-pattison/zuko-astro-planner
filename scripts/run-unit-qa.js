#!/usr/bin/env node
/** Run Node unit/integration QA scripts (no Electron UI). */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const scripts = [
  'scripts/qa-project-framer-fov.js',
  'scripts/qa-filters.js',
  'scripts/qa-asiair-filename.js',
  'scripts/qa-asiair-session-logs.js',
  'scripts/smoke-session-log-pipeline.js',
  'scripts/_test-calib-focused-qa.js',
  'scripts/qa-asiair-ingest.js',
  'scripts/qa-target-match-flow.js',
  'scripts/qa-target-match-deep.js',
  'scripts/qa-sky-astro-modules.js',
  'scripts/qa-siril-cull-seq.js',
  'scripts/qa-siril-register-stack.js',
  'scripts/qa-preprocess-settings.js',
  'scripts/qa-cleanup-helpers.js',
];

let failed = 0;
for (const rel of scripts) {
  console.log('\n===', rel, '===');
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ASIAIR_QA_SRC: process.env.ASIAIR_QA_SRC
        || path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', 'asiaIRDUMP'),
    },
  });
  if (r.status !== 0) {
    failed += 1;
    console.error('FAILED:', rel, 'exit', r.status);
  }
}

// Fixture QA upserts [TEST] projects — restore day-to-day dashboard afterward.
console.log('\n=== scripts/reset-dashboard-pre-ingest.js ===');
const reset = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'reset-dashboard-pre-ingest.js')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
});
if (reset.status !== 0) {
  console.error('FAILED to restore pre-ingest dashboard');
  process.exit(1);
}

if (failed) {
  console.error(`\n${failed}/${scripts.length} QA suites failed`);
  process.exit(1);
}
console.log(`\nAll ${scripts.length} unit/integration QA suites passed; dashboard restored to pre-ingest`);
