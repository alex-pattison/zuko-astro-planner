'use strict';

/**
 * 1) Prove / remove phantom 260725 Ha+OIII shoot logs (no disk folders).
 * 2) Mirror cleaned Beta dashboard → Dev, with projectDirs junctioned to H: trees.
 *
 * Usage: node scripts/sync-dev-from-beta-veil.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BETA_FILE = 'H:/Photography/Astrophotography/Dashboard/zuko-dashboard-data.json';
const DEV_FILE = path.join(__dirname, '..', 'data', 'zuko-dashboard-data.json');
const BETA_ZUKO = 'H:\\Photography\\Astrophotography\\Zuko';
const DEV_PROJECTS = 'F:\\zuko_dev\\Projects';

function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function backup(file, tag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `zuko-dashboard-data.${tag}.${stamp}.json`);
  fs.copyFileSync(file, dest);
  return dest;
}

function ensureJunction(linkPath, targetPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  if (fs.existsSync(linkPath)) {
    try {
      fs.rmdirSync(linkPath);
    } catch {
      const aside = `${linkPath}.pre-beta-mirror.${Date.now()}`;
      fs.renameSync(linkPath, aside);
      console.log('moved aside', aside);
    }
  }
  fs.symlinkSync(targetPath, linkPath, 'junction');
  console.log('junction', linkPath, '->', targetPath);
}

function listShootFolders(projectDir) {
  const out = [];
  if (!projectDir || !fs.existsSync(projectDir)) return out;
  for (const filt of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (!filt.isDirectory()) continue;
    if (/autorun|calib|siril|working|dark|bias|\./i.test(filt.name)) continue;
    const base = path.join(projectDir, filt.name);
    for (const name of fs.readdirSync(base, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      if (!/^\d{6}_/.test(name.name)) continue;
      out.push({ filter: filt.name, folder: name.name, path: path.join(base, name.name) });
    }
  }
  return out;
}

function stripPhantomShoots(project, diskFolders) {
  const diskKeys = new Set(diskFolders.map((d) => `${d.folder.split('_')[0]}|${d.filter}`));
  // Also allow Captured-only if folder exists for that date+filter
  const before = (project.shoots || []).length;
  project.shoots = (project.shoots || []).filter((sh) => {
    const ft = project.filterTargets[sh.filterIndex];
    const filter = ft && ft.filter;
    const key = `${sh.date}|${filter}`;
    if (sh.ingestPath || (sh.ingestMeta && sh.ingestMeta.lightCount)) return true;
    // No ingest: only keep if a staged folder exists for date+filter
    if (diskKeys.has(key)) return true;
    // Special case: phantom 260725 Ha/OIII — never on disk
    if (String(sh.date) === '260725' && (filter === 'Ha' || filter === 'OIII')) {
      console.log('REMOVE phantom', project.name, sh.date, filter);
      return false;
    }
    // Keep other Captured-without-ingest (e.g. planned logs) only if not known phantoms
    return true;
  });
  // Drop 260725 Ha/OIII even if somehow marked ingested without folder
  project.shoots = project.shoots.filter((sh) => {
    const ft = project.filterTargets[sh.filterIndex];
    const filter = ft && ft.filter;
    if (String(sh.date) === '260725' && (filter === 'Ha' || filter === 'OIII')) {
      const hasFolder = diskFolders.some(
        (d) => d.filter === filter && d.folder.startsWith('260725_')
      );
      if (!hasFolder) {
        console.log('REMOVE unverified', project.name, sh.date, filter);
        return false;
      }
    }
    return true;
  });
  return before - project.shoots.length;
}

function recomputeHours(project) {
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
}

function main() {
  const betaBak = backup(BETA_FILE, 'pre-phantom-strip');
  const devBak = backup(DEV_FILE, 'pre-beta-mirror');
  console.log('backups', { betaBak, devBak });

  const beta = JSON.parse(fs.readFileSync(BETA_FILE, 'utf8'));
  const veil = (beta.projects || []).find((p) => /veil/i.test(p.name || ''));
  if (!veil) throw new Error('Beta Veil missing');

  const disk = listShootFolders(veil.projectDir);
  console.log('disk shoot folders:', disk.map((d) => `${d.filter}/${d.folder}`));

  const removed = stripPhantomShoots(veil, disk);
  recomputeHours(veil);
  console.log('removed phantom shoots from Beta:', removed);

  beta.appMeta = {
    ...(beta.appMeta || {}),
    savedAt: new Date().toISOString(),
    note: 'stripped phantom 260725 Ha/OIII (no disk folders; Dev QA leftovers)',
  };
  atomicWrite(BETA_FILE, beta);

  // Junctions for Dev
  const veilLink = path.join(DEV_PROJECTS, 'NGC6960_Q326_beta_mirror');
  const naLink = path.join(DEV_PROJECTS, 'NGC7000_260720_beta_mirror');
  ensureJunction(veilLink, path.join(BETA_ZUKO, 'NGC6960_Q326'));
  if (fs.existsSync(path.join(BETA_ZUKO, 'NGC7000_260720'))) {
    ensureJunction(naLink, path.join(BETA_ZUKO, 'NGC7000_260720'));
  }

  const dev = JSON.parse(fs.readFileSync(DEV_FILE, 'utf8'));
  // Preserve Dev-only assets/notes/filters/darkLibrary path if preferred, but replace projects from Beta.
  const betaClone = JSON.parse(JSON.stringify(beta));
  for (const p of betaClone.projects || []) {
    if (/veil/i.test(p.name || '')) p.projectDir = veilLink;
    if (/north america|ngc\s*7000/i.test(p.name || '')) p.projectDir = naLink;
    // Remap ingest paths under H: veil → junction
    for (const sh of p.shoots || []) {
      if (sh.ingestPath && String(sh.ingestPath).includes('NGC6960_Q326')) {
        sh.ingestPath = String(sh.ingestPath).replace(
          /H:\\Photography\\Astrophotography\\Zuko\\NGC6960_Q326/i,
          veilLink
        );
      }
      if (sh.ingestMeta && Array.isArray(sh.ingestMeta.destRoots)) {
        sh.ingestMeta.destRoots = sh.ingestMeta.destRoots.map((r) =>
          String(r).replace(/H:\\Photography\\Astrophotography\\Zuko\\NGC6960_Q326/gi, veilLink)
        );
      }
      if (sh.preprocessMeta && sh.preprocessMeta.shootDir) {
        sh.preprocessMeta.shootDir = String(sh.preprocessMeta.shootDir).replace(
          /H:\\Photography\\Astrophotography\\Zuko\\NGC6960_Q326/gi,
          veilLink
        );
      }
    }
    for (const ft of p.filterTargets || []) {
      for (const key of ['aggregateMeta', 'registerMeta', 'cullMeta', 'stackMeta']) {
        const m = ft[key];
        if (!m) continue;
        for (const field of ['aggregateDir', 'stackDir', 'workingDir', 'resultPath']) {
          if (m[field]) {
            m[field] = String(m[field]).replace(
              /H:\\Photography\\Astrophotography\\Zuko\\NGC6960_Q326/gi,
              veilLink
            );
          }
        }
      }
    }
  }

  // Keep Dev dark library on F: if present
  const darkLib = (dev.darkLibrary && dev.darkLibrary.path) || 'F:\\zuko_dev\\Dark Library';
  const out = {
    ...dev,
    projects: betaClone.projects,
    asiairSourcePath: betaClone.asiairSourcePath || dev.asiairSourcePath || 'G:\\',
    filters: betaClone.filters || dev.filters,
    darkLibrary: {
      ...(dev.darkLibrary || {}),
      path: darkLib,
      // keep Dev index if present
      index: (dev.darkLibrary && dev.darkLibrary.index) || [],
      indexedAt: (dev.darkLibrary && dev.darkLibrary.indexedAt) || null,
    },
    appMeta: {
      version: '0.3.0',
      build: 31,
      savedAt: new Date().toISOString(),
      mirroredFromBeta: true,
    },
  };
  atomicWrite(DEV_FILE, out);

  const verifyDisk = listShootFolders(veilLink);
  const verifyDev = JSON.parse(fs.readFileSync(DEV_FILE, 'utf8'));
  const v = verifyDev.projects.find((p) => /veil/i.test(p.name));
  console.log(JSON.stringify({
    betaVeilShoots: (beta.projects.find((p) => /veil/i.test(p.name)).shoots || []).map((s) => {
      const f = veil.filterTargets[s.filterIndex];
      return `${s.date} ${f && f.filter} ingest=${!!s.ingestPath}`;
    }),
    devVeilShoots: (v.shoots || []).map((s) => {
      const f = v.filterTargets[s.filterIndex];
      return `${s.date} ${f && f.filter} ingest=${!!s.ingestPath}`;
    }),
    diskFolders: verifyDisk.map((d) => `${d.filter}/${d.folder}`),
    phantom260725HaOiiiOnDisk: verifyDisk.filter((d) => d.folder.startsWith('260725_') && (d.filter === 'Ha' || d.filter === 'OIII')),
  }, null, 2));
}

main();
