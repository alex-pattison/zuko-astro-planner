#!/usr/bin/env node
/**
 * Restructure NGC7000_260720 into Zuko Stage-for-Siril layout:
 *   <projectDir>/_calibration/darkflats|darks/<YYYYMMDD>/
 *   <Filter>/<ShootCode>/{lights,flats,biases,darks}
 * Biases/darks are copied into _calibration then hardlinked/symlinked into channels.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = 'F:\\zuko_dev\\Projects\\NGC7000_260720';
const NIGHT = '20260720';
const CHANNEL_MAP = [
  { letter: 'H', filter: 'Ha', shootCode: '260720_Ha_B9_Home' },
  { letter: 'O', filter: 'OIII', shootCode: '260720_OIII_B9_Home' },
  { letter: 'S', filter: 'SII', shootCode: '260720_SII_B9_Home' },
];

async function ensureLink(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.access(dest);
    return 'exists';
  } catch {
    /* continue */
  }
  try {
    await fsp.link(src, dest);
    return 'hardlink';
  } catch {
    try {
      await fsp.symlink(src, dest, 'file');
      return 'symlink';
    } catch {
      await fsp.copyFile(src, dest);
      return 'copy';
    }
  }
}

async function listFits(dir) {
  try {
    return (await fsp.readdir(dir)).filter((n) => /\.fit$/i.test(n));
  } catch {
    return [];
  }
}

async function moveDirContents(srcDir, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  const names = await listFits(srcDir);
  for (const n of names) {
    const from = path.join(srcDir, n);
    const to = path.join(destDir, n);
    try {
      await fsp.access(to);
    } catch {
      await fsp.rename(from, to);
    }
  }
  return names.length;
}

async function main() {
  if (!fs.existsSync(ROOT)) throw new Error('Missing ' + ROOT);

  const biasLib = path.join(ROOT, '_calibration', 'darkflats', NIGHT);
  const darkLib = path.join(ROOT, '_calibration', 'darks', NIGHT);
  await fsp.mkdir(biasLib, { recursive: true });
  await fsp.mkdir(darkLib, { recursive: true });

  // 1) Collect biases + darks into shared calibration (unique by basename)
  let biasCount = 0;
  let darkCount = 0;
  for (const ch of CHANNEL_MAP) {
    const letterRoot = path.join(ROOT, ch.letter);
    for (const n of await listFits(path.join(letterRoot, 'biases'))) {
      const from = path.join(letterRoot, 'biases', n);
      const to = path.join(biasLib, n);
      if (!fs.existsSync(to)) {
        await fsp.copyFile(from, to);
        biasCount += 1;
      }
    }
    for (const n of await listFits(path.join(letterRoot, 'darks'))) {
      const from = path.join(letterRoot, 'darks', n);
      const to = path.join(darkLib, n);
      if (!fs.existsSync(to)) {
        await fsp.copyFile(from, to);
        darkCount += 1;
      }
    }
  }
  console.log('Calibration library: biases', biasCount, 'darks', darkCount);

  const allBiases = (await listFits(biasLib)).map((n) => path.join(biasLib, n));
  const allDarks = (await listFits(darkLib)).map((n) => path.join(darkLib, n));

  // 2) Per filter: Filter/ShootCode/{lights,flats,biases,darks} + move results
  const summary = [];
  for (const ch of CHANNEL_MAP) {
    const letterRoot = path.join(ROOT, ch.letter);
    const shootRoot = path.join(ROOT, ch.filter, ch.shootCode);
    const lightsDir = path.join(shootRoot, 'lights');
    const flatsDir = path.join(shootRoot, 'flats');
    const biasesDir = path.join(shootRoot, 'biases');
    const darksDir = path.join(shootRoot, 'darks');
    await fsp.mkdir(lightsDir, { recursive: true });
    await fsp.mkdir(flatsDir, { recursive: true });
    await fsp.mkdir(biasesDir, { recursive: true });
    await fsp.mkdir(darksDir, { recursive: true });

    const lights = await moveDirContents(path.join(letterRoot, 'lights'), lightsDir);
    const flats = await moveDirContents(path.join(letterRoot, 'flats'), flatsDir);

    // Move stacked results into shoot folder
    try {
      for (const n of await fsp.readdir(letterRoot)) {
        if (!/\.fit$/i.test(n)) continue;
        const from = path.join(letterRoot, n);
        const st = await fsp.stat(from);
        if (!st.isFile()) continue;
        const to = path.join(shootRoot, n);
        if (!fs.existsSync(to)) await fsp.rename(from, to);
      }
    } catch {
      /* ignore */
    }

    let biasLinks = 0;
    let darkLinks = 0;
    for (const src of allBiases) {
      const dest = path.join(biasesDir, path.basename(src));
      await ensureLink(src, dest);
      biasLinks += 1;
    }
    for (const src of allDarks) {
      const dest = path.join(darksDir, path.basename(src));
      await ensureLink(src, dest);
      darkLinks += 1;
    }

    summary.push({
      filter: ch.filter,
      shootRoot,
      lights,
      flats,
      biasLinks,
      darkLinks,
    });
    console.log(ch.filter, '→', shootRoot, { lights, flats, biasLinks, darkLinks });
  }

  // 3) Remove old letter folders (biases/darks leftovers + empty dirs)
  for (const ch of CHANNEL_MAP) {
    const letterRoot = path.join(ROOT, ch.letter);
    if (!fs.existsSync(letterRoot)) continue;
    // Remove leftover calibration copies under letter folders
    for (const sub of ['biases', 'darks', 'lights', 'flats']) {
      const p = path.join(letterRoot, sub);
      if (!fs.existsSync(p)) continue;
      for (const n of await fsp.readdir(p)) {
        await fsp.rm(path.join(p, n), { force: true });
      }
      await fsp.rmdir(p).catch(() => {});
    }
    // Remove letter root if empty
    const left = await fsp.readdir(letterRoot).catch(() => []);
    if (!left.length) await fsp.rmdir(letterRoot).catch(() => {});
    else console.warn('Left in', letterRoot, left);
  }

  // 4) Update Dev JSON
  const jsonPath = 'F:\\GitHub\\zuko-astro-planner\\data\\zuko-dashboard-data.json';
  const data = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
  const nan = data.projects.find((p) => /North America/i.test(p.name));
  if (!nan) throw new Error('NAN project missing in Dev JSON');
  nan.projectDir = ROOT;

  nan.shoots = (nan.shoots || []).map((sh) => {
    const ft = nan.filterTargets[sh.filterIndex];
    const filter = ft && ft.filter ? ft.filter : 'Unknown';
    const ch = CHANNEL_MAP.find((c) => c.filter === filter);
    if (!ch) return sh;
    const dest = path.join(ROOT, ch.filter, ch.shootCode);
    const row = summary.find((s) => s.filter === filter);
    return {
      ...sh,
      complete: true,
      sourcePath: ROOT,
      ingestPath: dest,
      ingestMeta: {
        layout: 'zuko-stage-for-siril',
        nightDate: NIGHT,
        shootFolder: ch.shootCode,
        filters: [filter],
        destRoots: [dest],
        biasLibrary: biasLib,
        darkLibrary: darkLib,
        filesStaged: row ? row.lights + row.flats + row.biasLinks + row.darkLinks : null,
        byType: {
          light: row ? row.lights : 0,
          flat: row ? row.flats : 0,
          bias: row ? row.biasLinks : 0,
          dark: row ? row.darkLinks : 0,
        },
        lightCount: row ? row.lights : 0,
        frameCount: row ? row.lights : 0,
        exposureSec: 180,
        gain: 120,
        tempC: -10,
        stagedAt: new Date().toISOString(),
        note: 'Restructured from manual H/O/S layout to Zuko Filter/ShootCode + _calibration links.',
      },
    };
  });

  if (!data.appMeta) data.appMeta = {};
  data.appMeta.savedAt = new Date().toISOString();
  await fsp.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8');
  console.log('Updated', jsonPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
