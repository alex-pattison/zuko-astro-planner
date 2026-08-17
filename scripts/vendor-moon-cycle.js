#!/usr/bin/env node
/**
 * Vendor NASA SVS moon stills (acamarata/moon-cycle mm-256-75) into vendor/.
 *
 * jsdelivr 403s these in Electron; GitHub raw/zip often 429. Prefer a shallow
 * sparse git clone, then copy mm-256-75.
 *
 * Usage: node scripts/vendor-moon-cycle.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'vendor', 'moon-cycle', 'mm-256-75');
const COUNT = 708;
const REPO = 'https://github.com/acamarata/moon-cycle.git';

function countFrames(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((n) => /^\d{3}\.webp$/.test(n)).length;
}

function copyFrames(fromDir) {
  fs.mkdirSync(DEST, { recursive: true });
  const files = fs.readdirSync(fromDir).filter((n) => /^\d{3}\.webp$/.test(n));
  for (const f of files) {
    fs.copyFileSync(path.join(fromDir, f), path.join(DEST, f));
  }
  return files.length;
}

async function main() {
  const have = countFrames(DEST);
  if (have === COUNT) {
    console.log('vendor-moon-cycle: already have ' + have + ' frames in ' + DEST);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zuko-moon-'));
  console.log('vendor-moon-cycle: sparse-clone ' + REPO);
  execFileSync(
    'git',
    ['clone', '--depth', '1', '--filter=blob:none', '--sparse', REPO, tmp],
    { stdio: 'inherit' }
  );
  execFileSync('git', ['-C', tmp, 'sparse-checkout', 'set', 'mm-256-75'], { stdio: 'inherit' });
  const src = path.join(tmp, 'mm-256-75');
  if (!fs.existsSync(src)) throw new Error('mm-256-75 missing after clone');
  const n = copyFrames(src);
  const final = countFrames(DEST);
  if (final !== COUNT) {
    throw new Error('expected ' + COUNT + ' frames, have ' + final + ' (copied ' + n + ')');
  }
  console.log('vendor-moon-cycle: ' + final + ' frames in ' + DEST);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
