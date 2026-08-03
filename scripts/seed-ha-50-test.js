/**
 * Create Ha/260722_Ha_B9_Test50 with 50 light frames (cycled copies)
 * plus shared calib, and add a shoot-log row for log-timing tests.
 *
 * Usage: node scripts/seed-ha-50-test.js
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PROJECT = 'F:\\zuko_dev\\Projects\\NGC7000_260720';
const SRC = path.join(PROJECT, 'Ha', '260720_Ha_B9_Home');
const DEST = path.join(PROJECT, 'Ha', '260722_Ha_B9_Test50');
const JSON_PATHS = [
  'F:\\GitHub\\zuko-astro-planner\\data\\zuko-dashboard-data.json',
  path.join(__dirname, '..', 'data', 'zuko-dashboard-data.json'),
];

async function linkOrCopy(src, dest) {
  try {
    await fsp.unlink(dest);
  } catch {
    /* ignore */
  }
  try {
    await fsp.link(src, dest);
  } catch {
    await fsp.copyFile(src, dest);
  }
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error('missing ' + SRC);
  await fsp.mkdir(DEST, { recursive: true });

  for (const dir of ['biases', 'darks', 'flats']) {
    const srcDir = path.join(SRC, dir);
    const destDir = path.join(DEST, dir);
    await fsp.mkdir(destDir, { recursive: true });
    for (const name of await fsp.readdir(destDir)) {
      await fsp.rm(path.join(destDir, name), { force: true, recursive: true });
    }
    for (const name of await fsp.readdir(srcDir)) {
      if (!/\.fit[s]?$/i.test(name)) continue;
      await linkOrCopy(path.join(srcDir, name), path.join(destDir, name));
    }
  }

  const lightsSrc = path.join(SRC, 'lights');
  const lightsDest = path.join(DEST, 'lights');
  await fsp.mkdir(lightsDest, { recursive: true });
  for (const name of await fsp.readdir(lightsDest)) {
    await fsp.rm(path.join(lightsDest, name), { force: true, recursive: true });
  }
  const srcLights = (await fsp.readdir(lightsSrc)).filter((n) => /\.fit[s]?$/i.test(n)).sort();
  if (!srcLights.length) throw new Error('no source lights');

  for (let i = 1; i <= 50; i++) {
    const src = path.join(lightsSrc, srcLights[(i - 1) % srcLights.length]);
    const destName = `Light_NGC7000_180.0s_Bin2_H_20260722-TEST_${String(i).padStart(4, '0')}.fit`;
    await linkOrCopy(src, path.join(lightsDest, destName));
  }

  for (const extra of ['process', 'masters', 'scripts']) {
    await fsp.rm(path.join(DEST, extra), { recursive: true, force: true });
  }
  await fsp.mkdir(path.join(PROJECT, 'working'), { recursive: true });

  const shoot = {
    date: '260722',
    filterIndex: 0,
    hours: 2.5,
    complete: true,
    creditedHours: 2.5,
    sourcePath: PROJECT,
    ingestPath: DEST,
    ingestMeta: {
      layout: 'zuko-stage-for-siril',
      nightDate: '20260722',
      shootFolder: '260722_Ha_B9_Test50',
      filters: ['Ha'],
      destRoots: [DEST],
      biasLibrary: path.join(PROJECT, '_calibration', 'darkflats', '20260720'),
      darkLibrary: path.join(PROJECT, '_calibration', 'darks', '20260720'),
      filesStaged: 80,
      byType: { light: 50, flat: 10, bias: 10, dark: 10 },
      lightCount: 50,
      frameCount: 50,
      exposureSec: 180,
      gain: 120,
      tempC: -10,
      stagedAt: new Date().toISOString(),
      note: 'Synthetic 50-light Ha shoot for longer Calibration / log testing.',
    },
    preprocessMeta: null,
  };

  for (const jp of JSON_PATHS) {
    if (!fs.existsSync(jp)) continue;
    const raw = JSON.parse(fs.readFileSync(jp, 'utf8'));
    const p = (raw.projects || []).find(
      (x) =>
        (x.projectDir && String(x.projectDir).includes('NGC7000_260720')) ||
        (x.name && /North America/i.test(x.name))
    );
    if (!p) continue;
    p.shoots = (p.shoots || []).filter(
      (s) => !(String(s.date) === '260722' && s.filterIndex === 0)
    );
    p.shoots.push(shoot);
    // bump Ha logged hours for the test night
    if (p.filterTargets && p.filterTargets[0]) {
      p.filterTargets[0].loggedHrs = Number(p.filterTargets[0].loggedHrs || 0) + 2.5;
      p.filterTargets[0].targetHrs = Math.max(
        Number(p.filterTargets[0].targetHrs || 0),
        Number(p.filterTargets[0].loggedHrs)
      );
      p.filterTargets[0].cullMeta = null;
      p.filterTargets[0].stackMeta = null;
    }
    await fsp.writeFile(jp, JSON.stringify(raw, null, 2) + '\n', 'utf8');
    console.log('patched', jp, 'shoots=', p.shoots.length);
  }

  console.log('created', DEST, 'with 50 lights');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
