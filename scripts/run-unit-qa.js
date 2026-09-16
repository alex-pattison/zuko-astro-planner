#!/usr/bin/env node
/** Run Node unit/integration QA scripts (no Electron UI). */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const fs = require('fs');

function defaultAsiairQaSrc() {
  if (process.env.ASIAIR_QA_SRC && String(process.env.ASIAIR_QA_SRC).trim()) {
    return String(process.env.ASIAIR_QA_SRC).trim();
  }
  const desktop = path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop', 'asiaIRDUMP');
  try {
    if (!fs.existsSync(desktop)) return '';
    const logDir = path.join(desktop, 'log');
    const hasLog = fs.existsSync(logDir) && fs.readdirSync(logDir).some((n) => /\.txt$/i.test(n));
    const autorun = path.join(desktop, 'Autorun');
    const hasFit = (dir) => {
      if (!fs.existsSync(dir)) return false;
      const walk = (d, n = 0) => {
        if (n > 400) return false;
        for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, ent.name);
          if (ent.isFile() && /\.fit$/i.test(ent.name)) return true;
          if (ent.isDirectory() && walk(p, n + 1)) return true;
        }
        return false;
      };
      return walk(autorun);
    };
    if (hasLog || hasFit(autorun)) return desktop;
  } catch {
    /* ignore */
  }
  return '';
}

const scripts = [
  'scripts/qa-project-framer-fov.js',
  'scripts/qa-filters.js',
  'scripts/qa-asiair-filename.js',
  'scripts/qa-asiair-session-logs.js',
  'scripts/smoke-session-log-pipeline.js',
  'scripts/_test-calib-focused-qa.js',
  'scripts/qa-asiair-ingest.js',
  'scripts/qa-flat-set-picker.js',
  'scripts/qa-target-match-flow.js',
  'scripts/qa-target-match-deep.js',
  'scripts/qa-sky-astro-modules.js',
  'scripts/qa-sky-forecast-credits.js',
  'scripts/qa-siril-cull-seq.js',
  'scripts/qa-siril-register-stack.js',
  'scripts/qa-preprocess-settings.js',
  'scripts/qa-siril-cd-command.js',
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
      ...(defaultAsiairQaSrc() ? { ASIAIR_QA_SRC: defaultAsiairQaSrc() } : {}),
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
