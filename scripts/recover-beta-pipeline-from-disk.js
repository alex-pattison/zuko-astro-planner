'use strict';

/**
 * Rebuild Beta shoot + pipeline status from on-disk Siril trees.
 * Does NOT invent Captured nights that have no staged folder.
 *
 * Usage: node scripts/recover-beta-pipeline-from-disk.js
 */
const fs = require('fs');
const path = require('path');
const fsp = fs.promises;

const BETA_FILE = 'H:/Photography/Astrophotography/Dashboard/zuko-dashboard-data.json';
const FIT_RE = /\.fit[s]?$/i;

function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function countFits(dir, nameRe) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((n) => {
    if (nameRe) return nameRe.test(n);
    return FIT_RE.test(n);
  }).length;
}

function mtimeIso(p) {
  try {
    return fs.statSync(p).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function parseShootFolder(name) {
  // 260815_Ha_B9_Home or 260725_SII_B5_Queechy
  const m = String(name).match(/^(\d{6})_([^_]+)_(B[0-9.]+)_(.+)$/i);
  if (!m) return null;
  return {
    date: m[1],
    filter: m[2],
    bortle: m[3].replace(/^B/i, ''),
    location: m[4].replace(/_/g, ' '),
    shootFolder: name,
  };
}

function ensureFilterTarget(project, filterName, extras = {}) {
  const list = project.filterTargets || (project.filterTargets = []);
  let idx = list.findIndex((f) => f && String(f.filter) === String(filterName));
  if (idx < 0) {
    list.push({
      filter: filterName,
      hours: 0,
      bortle: extras.bortle != null ? Number(extras.bortle) || extras.bortle : null,
      location: extras.location || null,
      loggedHrs: 0,
      stackMeta: null,
      cullMeta: null,
      aggregateMeta: null,
      registerMeta: null,
    });
    idx = list.length - 1;
  } else {
    const ft = list[idx];
    if (extras.bortle != null && (ft.bortle == null || ft.bortle === '')) {
      ft.bortle = Number(extras.bortle) || extras.bortle;
    }
    if (extras.location && !ft.location) ft.location = extras.location;
  }
  return idx;
}

function findShoot(project, date, filterName) {
  const want = String(filterName || '');
  return (project.shoots || []).findIndex((s) => {
    if (!s || String(s.date) !== String(date)) return false;
    const ft = project.filterTargets[s.filterIndex];
    return ft && String(ft.filter) === want;
  });
}

function lightExposureGuess(lightsDir) {
  if (!fs.existsSync(lightsDir)) return { exposureSec: null, gain: null, tempC: null };
  const files = fs.readdirSync(lightsDir).filter((n) => FIT_RE.test(n));
  if (!files.length) return { exposureSec: null, gain: null, tempC: null };
  const name = files[0];
  const exp = name.match(/_(\d+(?:\.\d+)?)s_/i);
  const gain = name.match(/_G(\d+(?:\.\d+)?)_/i) || name.match(/Gain[_-]?(\d+)/i);
  const temp = name.match(/_(-?\d+(?:\.\d+)?)[Cc]_/);
  return {
    exposureSec: exp ? Number(exp[1]) : null,
    gain: gain ? Number(gain[1]) : null,
    tempC: temp ? Number(temp[1]) : null,
  };
}

function recoverProjectFromDisk(project) {
  const root = project.projectDir;
  if (!root || !fs.existsSync(root)) {
    return { ok: false, error: 'projectDir missing', shoots: 0 };
  }
  if (!Array.isArray(project.shoots)) project.shoots = [];

  const filterDirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !/^(autorun|plan|_calibration|sirilic|working|dark|bias|\.)/i.test(n));

  let shootsTouched = 0;
  const filterStats = {};

  for (const filterName of filterDirs) {
    const filterPath = path.join(root, filterName);
    const kids = fs.readdirSync(filterPath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const shootName of kids) {
      const parsed = parseShootFolder(shootName);
      if (!parsed) continue;
      // Folder filter segment should match; prefer folder name under Filter/
      const filter = filterName;
      const shootDir = path.join(filterPath, shootName);
      const lightsDir = path.join(shootDir, 'lights');
      const lightCount = countFits(lightsDir);
      if (!lightCount) continue;

      const fi = ensureFilterTarget(project, filter, {
        bortle: parsed.bortle,
        location: parsed.location,
      });
      let si = findShoot(project, parsed.date, filter);
      if (si < 0) {
        project.shoots.push({
          date: parsed.date,
          filterIndex: fi,
          hours: 0,
          complete: true,
          sourcePath: null,
          ingestPath: null,
          ingestMeta: null,
          preprocessMeta: null,
          notes: '',
          creditedHours: 0,
        });
        si = project.shoots.length - 1;
      } else {
        // Point shoot at the canonical filter target index for this filter name.
        project.shoots[si].filterIndex = fi;
      }

      const sh = project.shoots[si];
      sh.complete = true;
      sh.ingestPath = shootDir;

      const params = lightExposureGuess(lightsDir);
      const ppLightCount = countFits(path.join(shootDir, 'process'), /^pp_light_/i);
      const flatCount = countFits(path.join(shootDir, 'flats'));
      const biasCount = countFits(path.join(shootDir, 'biases'));
      const darkCount = countFits(path.join(shootDir, 'darks'))
        + (fs.existsSync(path.join(shootDir, 'masters', 'dark_stacked.fit')) ? 1 : 0);

      const stagedAt = (sh.ingestMeta && sh.ingestMeta.stagedAt)
        || mtimeIso(lightsDir);

      sh.ingestMeta = {
        ...(sh.ingestMeta || {}),
        nightDate: parsed.date.length === 6
          ? ((parseInt(parsed.date.slice(0, 2), 10) >= 70 ? '19' : '20') + parsed.date)
          : parsed.date,
        shootFolder: shootName,
        filters: [filter],
        destRoots: [shootDir],
        filesStaged: lightCount + flatCount + biasCount + darkCount,
        byType: {
          light: lightCount,
          flat: flatCount,
          bias: biasCount,
          dark: darkCount,
        },
        lightCount,
        frameCount: lightCount,
        exposureSec: (sh.ingestMeta && sh.ingestMeta.exposureSec != null)
          ? sh.ingestMeta.exposureSec
          : params.exposureSec,
        gain: (sh.ingestMeta && sh.ingestMeta.gain != null)
          ? sh.ingestMeta.gain
          : params.gain,
        tempC: (sh.ingestMeta && sh.ingestMeta.tempC != null)
          ? sh.ingestMeta.tempC
          : params.tempC,
        stagedAt,
        recoveredFromDisk: true,
      };

      if (sh.ingestMeta.exposureSec && (!sh.hours || sh.hours === 0)) {
        sh.hours = Math.round((lightCount * sh.ingestMeta.exposureSec / 3600) * 100) / 100;
      }

      if (ppLightCount > 0) {
        const processDir = path.join(shootDir, 'process');
        sh.preprocessMeta = {
          calibratedAt: (sh.preprocessMeta && sh.preprocessMeta.calibratedAt)
            || mtimeIso(processDir),
          shootDir,
          ppLightCount,
          logPath: path.join(shootDir, 'scripts', 'calibrate.log'),
          recoveredFromDisk: true,
        };
      }

      shootsTouched += 1;
      if (!filterStats[filter]) filterStats[filter] = { shoots: 0, calibrated: 0 };
      filterStats[filter].shoots += 1;
      if (ppLightCount > 0) filterStats[filter].calibrated += 1;
    }

    // Filter-level Aggregate / Register / Cull / Stack
    const aggregateDir = path.join(filterPath, 'Aggregate');
    const stackDir = path.join(filterPath, '_stack');
    const fi = ensureFilterTarget(project, filterName);
    const ft = project.filterTargets[fi];

    const ppAgg = countFits(aggregateDir, /^pp_light_/i);
    const rppAgg = countFits(aggregateDir, /^r_pp_light_/i);
    const culled = fs.existsSync(path.join(aggregateDir, 'culled.txt'));
    const resultNamed = path.join(stackDir, `result_${filterName}.fit`);
    const resultPlain = path.join(stackDir, 'result.fit');
    const resultPath = fs.existsSync(resultNamed)
      ? resultNamed
      : (fs.existsSync(resultPlain) ? resultPlain : null);

    if (ppAgg > 0 || rppAgg > 0) {
      ft.aggregateMeta = {
        aggregatedAt: (ft.aggregateMeta && ft.aggregateMeta.aggregatedAt) || mtimeIso(aggregateDir),
        aggregateDir,
        shootCount: filterStats[filterName] ? filterStats[filterName].calibrated : null,
        frameCount: ppAgg || rppAgg,
        recoveredFromDisk: true,
      };
    }
    if (rppAgg > 0) {
      ft.registerMeta = {
        registeredAt: (ft.registerMeta && ft.registerMeta.registeredAt) || mtimeIso(aggregateDir),
        aggregateDir,
        shootCount: filterStats[filterName] ? filterStats[filterName].calibrated : null,
        frameCount: rppAgg,
        rPpLightCount: rppAgg,
        logPath: path.join(aggregateDir, 'scripts', 'register.log'),
        recoveredFromDisk: true,
      };
    }
    if (culled && rppAgg > 0) {
      let included = rppAgg;
      let excluded = 0;
      try {
        const txt = fs.readFileSync(path.join(aggregateDir, 'culled.txt'), 'utf8');
        const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        // Heuristic: excluded basenames listed
        excluded = lines.filter((l) => !l.startsWith('#')).length;
        if (excluded > 0 && excluded < rppAgg) included = rppAgg - excluded;
      } catch { /* ignore */ }
      ft.cullMeta = {
        completedAt: (ft.cullMeta && ft.cullMeta.completedAt) || mtimeIso(path.join(aggregateDir, 'culled.txt')),
        aggregateDir,
        includedCount: included,
        excludedCount: excluded,
        recoveredFromDisk: true,
      };
    }
    if (resultPath) {
      const workingDir = path.join(root, 'working_pass1_260816');
      const workingResult = path.join(workingDir, `result_${filterName}.fit`);
      ft.stackMeta = {
        stackedAt: (ft.stackMeta && ft.stackMeta.stackedAt) || mtimeIso(resultPath),
        resultPath: fs.existsSync(workingResult) ? workingResult : resultPath,
        shootCount: filterStats[filterName] ? filterStats[filterName].calibrated : null,
        ppLightCount: countFits(stackDir, /^pp_light_/i) || rppAgg || ppAgg,
        logPath: path.join(stackDir, 'scripts', 'stack.log'),
        stackDir,
        workingDir: fs.existsSync(workingDir) ? workingDir : path.join(root, 'working'),
        aggregateDir,
        recoveredFromDisk: true,
      };
    }
  }

  // Drop duplicate filter targets with the same name (keep first; remap shoots).
  {
    const seen = new Map();
    const keep = [];
    const remap = new Map();
    (project.filterTargets || []).forEach((ft, oldIdx) => {
      if (!ft || !ft.filter) return;
      const key = String(ft.filter);
      if (seen.has(key)) {
        remap.set(oldIdx, seen.get(key));
        // Prefer richer pipeline meta on the kept row.
        const kept = keep[seen.get(key)];
        for (const k of ['aggregateMeta', 'registerMeta', 'cullMeta', 'stackMeta']) {
          if (!kept[k] && ft[k]) kept[k] = ft[k];
        }
        return;
      }
      seen.set(key, keep.length);
      remap.set(oldIdx, keep.length);
      keep.push(ft);
    });
    project.filterTargets = keep;
    for (const sh of project.shoots || []) {
      if (sh && remap.has(sh.filterIndex)) sh.filterIndex = remap.get(sh.filterIndex);
    }
  }

  // Dedupe shoots by date + filter name (prefer ingested / calibrated rows).
  {
    const best = new Map();
    for (const sh of project.shoots || []) {
      if (!sh) continue;
      const ft = project.filterTargets[sh.filterIndex];
      const key = `${sh.date}|${ft ? ft.filter : sh.filterIndex}`;
      const score = (sh.ingestPath ? 4 : 0)
        + (sh.preprocessMeta && sh.preprocessMeta.calibratedAt ? 2 : 0)
        + (sh.ingestMeta && sh.ingestMeta.lightCount ? 1 : 0);
      const prev = best.get(key);
      if (!prev || score > prev.score) best.set(key, { sh, score });
    }
    project.shoots = [...best.values()].map((x) => x.sh);
  }

  // Recompute logged hours
  for (const ft of project.filterTargets || []) ft.loggedHrs = 0;
  for (const sh of project.shoots || []) {
    if (!sh.complete) {
      sh.creditedHours = 0;
      continue;
    }
    let hrs = Number(sh.hours) || 0;
    if (sh.ingestMeta && sh.ingestMeta.lightCount != null && sh.ingestMeta.exposureSec != null) {
      hrs = (Number(sh.ingestMeta.lightCount) * Number(sh.ingestMeta.exposureSec)) / 3600;
    }
    hrs = Math.round(hrs * 100) / 100;
    sh.creditedHours = hrs;
    const ft = project.filterTargets[sh.filterIndex];
    if (ft) ft.loggedHrs = Math.round(((ft.loggedHrs || 0) + hrs) * 100) / 100;
  }

  const anyCal = (project.shoots || []).some((s) => s.preprocessMeta && s.preprocessMeta.calibratedAt);
  const anyStack = (project.filterTargets || []).some((f) => f.stackMeta && f.stackMeta.resultPath);
  if (anyStack) project.processStatus = 'processing';
  else if (anyCal) project.processStatus = 'processing';
  else if ((project.shoots || []).some((s) => s.ingestPath)) project.processStatus = 'ingested';

  return { ok: true, shoots: shootsTouched, filterStats };
}

async function main() {
  const data = JSON.parse(fs.readFileSync(BETA_FILE, 'utf8'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bakDir = path.join(path.dirname(BETA_FILE), 'backups');
  fs.mkdirSync(bakDir, { recursive: true });
  const bak = path.join(bakDir, `zuko-dashboard-data.pre-disk-recover.${stamp}.json`);
  fs.copyFileSync(BETA_FILE, bak);
  console.log('backup', bak);

  const report = [];
  for (const project of (data.projects || [])) {
    if (!project.projectDir) {
      report.push({ name: project.name, skipped: 'no projectDir' });
      continue;
    }
    const r = recoverProjectFromDisk(project);
    report.push({
      name: project.name,
      ...r,
      shootSummaries: (project.shoots || []).map((s) => {
        const ft = project.filterTargets[s.filterIndex];
        return {
          date: s.date,
          filter: ft && ft.filter,
          complete: !!s.complete,
          lights: s.ingestMeta && s.ingestMeta.lightCount,
          calibrated: !!(s.preprocessMeta && s.preprocessMeta.calibratedAt),
          pp: s.preprocessMeta && s.preprocessMeta.ppLightCount,
        };
      }),
      filterPipeline: (project.filterTargets || []).map((f) => ({
        filter: f.filter,
        agg: !!(f.aggregateMeta && f.aggregateMeta.aggregateDir),
        reg: !!(f.registerMeta && f.registerMeta.registeredAt),
        cull: !!(f.cullMeta && f.cullMeta.completedAt),
        stack: !!(f.stackMeta && f.stackMeta.resultPath),
      })),
    });
  }

  data.appMeta = {
    ...(data.appMeta || {}),
    version: '0.3.0',
    build: 30,
    savedAt: new Date().toISOString(),
    recoveredPipelineFromDisk: true,
  };

  atomicWrite(BETA_FILE, data);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
