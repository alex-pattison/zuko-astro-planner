/**
 * Seed a synthetic second night (260721) for NGC7000 Dev project:
 * - Copy/hardlink lights+flats+biases+darks from each 260720 shoot (no process/masters)
 * - Reset preprocess/stack/cull meta; add second shoot log rows with fudged ingestMeta
 *
 * Usage: node scripts/seed-nan-second-night.js
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PROJECT = 'F:\\zuko_dev\\Projects\\NGC7000_260720';
const JSON_PATHS = [path.join(__dirname, '..', 'data', 'zuko-dashboard-data.json')];

const FILTERS = [
  { name: 'Ha', night1: '260720_Ha_B9_Home', night2: '260721_Ha_B9_Home', hours: 0.5, lights: 10 },
  { name: 'OIII', night1: '260720_OIII_B9_Home', night2: '260721_OIII_B9_Home', hours: 0.25, lights: 5 },
  { name: 'SII', night1: '260720_SII_B9_Home', night2: '260721_SII_B9_Home', hours: 0.25, lights: 5 },
];

const INPUT_DIRS = ['biases', 'darks', 'flats', 'lights'];

async function ensureLinkOrCopy(src, dest) {
  try {
    await fsp.unlink(dest);
  } catch {
    /* ignore */
  }
  try {
    await fsp.link(src, dest);
    return 'hardlink';
  } catch {
    await fsp.copyFile(src, dest);
    return 'copy';
  }
}

function fudgeName(name) {
  return String(name)
    .replace(/20260720/g, '20260721')
    .replace(/260720/g, '260721');
}

async function seedShoot(filter) {
  const srcRoot = path.join(PROJECT, filter.name, filter.night1);
  const destRoot = path.join(PROJECT, filter.name, filter.night2);
  if (!fs.existsSync(srcRoot)) {
    throw new Error(`Missing source shoot: ${srcRoot}`);
  }
  await fsp.mkdir(destRoot, { recursive: true });

  let linked = 0;
  for (const dir of INPUT_DIRS) {
    const srcDir = path.join(srcRoot, dir);
    const destDir = path.join(destRoot, dir);
    await fsp.mkdir(destDir, { recursive: true });
    // Clear dest dir first
    for (const name of await fsp.readdir(destDir)) {
      await fsp.rm(path.join(destDir, name), { force: true, recursive: true });
    }
    if (!fs.existsSync(srcDir)) continue;
    for (const name of await fsp.readdir(srcDir)) {
      if (!/\.fit[s]?$/i.test(name)) continue;
      const destName = fudgeName(name);
      await ensureLinkOrCopy(path.join(srcDir, name), path.join(destDir, destName));
      linked += 1;
    }
  }
  // Ensure no leftover process/masters from a prior seed attempt
  for (const extra of ['process', 'masters', 'scripts']) {
    await fsp.rm(path.join(destRoot, extra), { recursive: true, force: true });
  }
  return { destRoot, linked };
}

function buildNight2Shoot(filter, destRoot) {
  return {
    date: '260721',
    filterIndex: FILTERS.findIndex((f) => f.name === filter.name),
    hours: filter.hours,
    complete: true,
    creditedHours: filter.hours,
    sourcePath: PROJECT,
    ingestPath: destRoot,
    ingestMeta: {
      layout: 'zuko-stage-for-siril',
      nightDate: '20260721',
      shootFolder: filter.night2,
      filters: [filter.name],
      destRoots: [destRoot],
      biasLibrary: path.join(PROJECT, '_calibration', 'darkflats', '20260720'),
      darkLibrary: path.join(PROJECT, '_calibration', 'darks', '20260720'),
      filesStaged: filter.lights + 20,
      byType: {
        light: filter.lights,
        flat: 10,
        bias: 10,
        dark: 10,
      },
      lightCount: filter.lights,
      frameCount: filter.lights,
      exposureSec: 180,
      gain: 120,
      tempC: -10,
      stagedAt: new Date().toISOString(),
      note: 'Synthetic second night — hardlinked/copied from 260720 for multi-night PP2 testing.',
    },
    preprocessMeta: null,
  };
}

function resetAndPatchProject(project, night2ByFilter) {
  project.status = 'processing';
  project.processStatus = 'ingested';
  project.filterTargets = (project.filterTargets || []).map((f) => ({
    ...f,
    stackMeta: null,
    cullMeta: null,
    // Double target hours so two nights look intentional
    targetHrs: Number(f.targetHrs) > 0 ? Number(f.targetHrs) * 2 : f.targetHrs,
    loggedHrs: Number(f.loggedHrs) > 0 ? Number(f.loggedHrs) * 2 : f.loggedHrs,
  }));

  // Keep night-1 shoots; clear preprocess; ensure ingest paths stay
  const night1 = (project.shoots || [])
    .filter((sh) => String(sh.date) === '260720')
    .map((sh) => ({
      ...sh,
      preprocessMeta: null,
      complete: true,
    }));

  const night2 = FILTERS.map((f) => buildNight2Shoot(f, night2ByFilter[f.name]));
  project.shoots = [...night1, ...night2];
  return project;
}

async function patchJson(filePath, night2ByFilter) {
  if (!fs.existsSync(filePath)) {
    console.warn('skip missing json', filePath);
    return;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const idx = (raw.projects || []).findIndex(
    (p) =>
      (p.projectDir && String(p.projectDir).replace(/\\/g, '/').includes('NGC7000_260720')) ||
      (p.name && /North America/i.test(p.name))
  );
  if (idx < 0) {
    console.warn('NAN project not found in', filePath);
    return;
  }
  raw.projects[idx] = resetAndPatchProject(raw.projects[idx], night2ByFilter);
  // Ensure projectDir points at F pool
  raw.projects[idx].projectDir = PROJECT;
  await fsp.writeFile(filePath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
  console.log('patched', filePath, 'shoots=', raw.projects[idx].shoots.length);
}

async function main() {
  const night2ByFilter = {};
  for (const f of FILTERS) {
    const r = await seedShoot(f);
    night2ByFilter[f.name] = r.destRoot;
    console.log(`seeded ${f.name}: ${r.linked} frames → ${r.destRoot}`);
  }
  // Clear prior _stack results so PP2 starts clean
  for (const f of FILTERS) {
    await fsp.rm(path.join(PROJECT, f.name, '_stack'), { recursive: true, force: true });
  }
  for (const jp of JSON_PATHS) {
    await patchJson(jp, night2ByFilter);
  }
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
