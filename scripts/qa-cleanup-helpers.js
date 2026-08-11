#!/usr/bin/env node
/**
 * Unit/integration checks for cleanup + pathExists helpers (no Electron UI).
 * Usage: node scripts/qa-cleanup-helpers.js
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const assert = require('assert');

const {
  inspectShootDisk,
  cleanShootIntermediates,
  cleanProjectIntermediates,
} = require('../src/siril/preprocess');

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  ok ', name);
  } else {
    failed += 1;
    console.error('  FAIL', name, detail || '');
  }
}

async function withTemp(fn) {
  const root = path.join(os.tmpdir(), `zuko-cleanup-qa-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await fsp.mkdir(root, { recursive: true });
  try {
    await fn(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

async function seedShoot(shoot) {
  for (const d of ['lights', 'flats', 'darks', 'biases', 'masters', 'process', 'scripts']) {
    await fsp.mkdir(path.join(shoot, d), { recursive: true });
  }
  await fsp.writeFile(path.join(shoot, 'lights', 'L_001.fit'), Buffer.alloc(2048, 1));
  await fsp.writeFile(path.join(shoot, 'flats', 'F_001.fit'), Buffer.alloc(512, 2));
  await fsp.writeFile(path.join(shoot, 'process', 'pp_light_001.fit'), Buffer.alloc(8192, 3));
  await fsp.writeFile(path.join(shoot, 'masters', 'dark_stacked.fit'), Buffer.alloc(4096, 4));
  await fsp.writeFile(path.join(shoot, 'scripts', 'calibrate.log'), 'log\n');
}

async function main() {
  console.log('=== cleanup helpers ===');

  await withTemp(async (root) => {
    const shoot = path.join(root, 'Ha', '260720_Ha_B9_Home');
    await seedShoot(shoot);

    const before = await inspectShootDisk(shoot);
    check('inspect dirty', before.ok && before.hasIntermediates && before.status === 'dirty');
    check('inspect size > intermediates', before.sizeBytes > before.intermediateBytes);
    check('inspect lists all three', before.intermediates.masters && before.intermediates.process && before.intermediates.scripts);

    const cleaned = await cleanShootIntermediates(shoot);
    check('cleanShoot ok', cleaned.ok);
    check('cleanShoot removed three', cleaned.removed.length === 3, cleaned.removed);
    check('cleanShoot status clean', cleaned.status === 'clean' && !cleaned.hasIntermediates);
    check('lights kept', fs.existsSync(path.join(shoot, 'lights', 'L_001.fit')));
    check('flats kept', fs.existsSync(path.join(shoot, 'flats', 'F_001.fit')));
    check('process gone', !fs.existsSync(path.join(shoot, 'process')));
    check('masters gone', !fs.existsSync(path.join(shoot, 'masters')));
    check('scripts gone', !fs.existsSync(path.join(shoot, 'scripts')));

    const again = await cleanShootIntermediates(shoot);
    check('idempotent clean ok', again.ok && again.removed.length === 0);

    const missing = await inspectShootDisk(path.join(root, 'nope'));
    check('missing folder status', missing.ok && missing.status === 'missing' && !missing.hasIntermediates);

    const bad = await cleanShootIntermediates('');
    check('empty shootDir fails', !bad.ok);
  });

  await withTemp(async (root) => {
    const ha = path.join(root, 'Ha', 'n1');
    const oiii = path.join(root, 'OIII', 'n1');
    await seedShoot(ha);
    await seedShoot(oiii);
    await fsp.mkdir(path.join(root, 'Ha', 'Aggregate'), { recursive: true });
    await fsp.mkdir(path.join(root, 'Ha', '_stack', 'scripts'), { recursive: true });
    await fsp.mkdir(path.join(root, 'OIII', 'Aggregate'), { recursive: true });
    await fsp.writeFile(path.join(root, 'Ha', 'Aggregate', 'pp.fit'), Buffer.alloc(100, 9));
    await fsp.writeFile(path.join(root, 'Ha', '_stack', 'scripts', 'stack.log'), 'x');
    await fsp.mkdir(path.join(root, 'working'), { recursive: true });
    await fsp.writeFile(path.join(root, 'working', 'result_Ha.fit'), Buffer.alloc(200, 7));

    const proj = await cleanProjectIntermediates({
      projectDir: root,
      shootDirs: [ha, oiii],
      filters: ['Ha', 'OIII'],
    });
    check('project clean ok', proj.ok, proj.error);
    check('channel removed Aggregate/_stack', proj.channelRemoved.length >= 2, proj.channelRemoved);
    check('Ha Aggregate gone', !fs.existsSync(path.join(root, 'Ha', 'Aggregate')));
    check('Ha _stack gone', !fs.existsSync(path.join(root, 'Ha', '_stack')));
    check('OIII Aggregate gone', !fs.existsSync(path.join(root, 'OIII', 'Aggregate')));
    check('working result kept', fs.existsSync(path.join(root, 'working', 'result_Ha.fit')));
    check('Ha lights kept', fs.existsSync(path.join(ha, 'lights', 'L_001.fit')));
    check('OIII lights kept', fs.existsSync(path.join(oiii, 'lights', 'L_001.fit')));
    check('Ha process gone', !fs.existsSync(path.join(ha, 'process')));
  });

  await withTemp(async (root) => {
    // Auto-discover filter dirs when filters omitted
    const shoot = path.join(root, 'SII', 'n1');
    await seedShoot(shoot);
    await fsp.mkdir(path.join(root, 'SII', 'Aggregate'), { recursive: true });
    await fsp.writeFile(path.join(root, 'SII', 'Aggregate', 'a.fit'), 'a');
    const proj = await cleanProjectIntermediates({
      projectDir: root,
      shootDirs: [shoot],
    });
    check('auto filter discover Aggregate', proj.ok && !fs.existsSync(path.join(root, 'SII', 'Aggregate')));
  });

  // Live Dev project smoke (if present): inspect only — do not mutate yet
  const nan = 'F:\\zuko_dev\\Projects\\NGC7000_260720';
  if (fs.existsSync(nan)) {
    console.log('=== live NAN inspect (read-only) ===');
    const ha = path.join(nan, 'Ha', '260720_Ha_B9_Home');
    if (fs.existsSync(ha)) {
      const info = await inspectShootDisk(ha);
      check('NAN Ha inspect ok', info.ok && info.exists);
      console.log('   Ha size', info.sizeBytes, 'intermediates', info.hasIntermediates, info.status);
    } else {
      console.log('  skip Ha night folder missing');
    }
  } else {
    console.log('=== skip live NAN (not mounted) ===');
  }

  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll cleanup QA checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
