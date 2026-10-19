'use strict';

const fs = require('fs');
const path = require('path');

const BETA_FILE = 'H:/Astrophotography/Dashboard/zuko-dashboard-data.json';
const DEV_FILE = path.join(__dirname, '..', 'data', 'zuko-dashboard-data.json');
const BETA_PROJECTS = 'H:/Astrophotography/Zuko';
const DEV_PROJECTS = 'F:/zuko_dev/Projects';

function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function remapDir(dir) {
  if (!dir) return dir;
  const norm = path.resolve(String(dir));
  const devRoot = path.resolve(DEV_PROJECTS);
  if (norm.toLowerCase().startsWith(devRoot.toLowerCase())) {
    return path.join(BETA_PROJECTS, path.relative(devRoot, norm));
  }
  return dir;
}

function fixLightCounts(sh) {
  if (!sh || !sh.ingestMeta) return;
  const staged = sh.ingestMeta.byType && sh.ingestMeta.byType.light;
  if (staged != null) {
    sh.ingestMeta.lightCount = staged;
    sh.ingestMeta.frameCount = staged;
  }
}

function remapIngestMeta(meta) {
  if (!meta) return meta;
  const out = { ...meta };
  if (Array.isArray(out.destRoots)) out.destRoots = out.destRoots.map(remapDir);
  if (out.darkLibrary) {
    out.darkLibrary = String(out.darkLibrary)
      .replace(/F:\\zuko_dev\\Dark Library/gi, 'H:\\Astrophotography\\Zuko\\Dark Library')
      .replace(/F:\/zuko_dev\/Dark Library/gi, 'H:/Astrophotography/Zuko/Dark Library');
  }
  return out;
}

const wiped = JSON.parse(fs.readFileSync(BETA_FILE, 'utf8'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const bakDir = path.join(path.dirname(BETA_FILE), 'backups');
fs.mkdirSync(bakDir, { recursive: true });
const wipedBak = path.join(bakDir, `zuko-dashboard-data.wiped-empty-projects.${stamp}.json`);
fs.copyFileSync(BETA_FILE, wipedBak);
console.log('saved wiped copy', wipedBak);

const dev = JSON.parse(fs.readFileSync(DEV_FILE, 'utf8'));
const projects = [];

for (const p of (dev.projects || [])) {
  if (/^\[TEST\]/i.test(p.name || '')) continue;
  const copy = JSON.parse(JSON.stringify(p));

  if (/veil/i.test(copy.name || '') && fs.existsSync(path.join(BETA_PROJECTS, 'NGC6960_Q326'))) {
    copy.projectDir = path.join(BETA_PROJECTS, 'NGC6960_Q326');
  } else if (/north america|ngc\s*7000/i.test(copy.name || '')
    && fs.existsSync(path.join(BETA_PROJECTS, 'NGC7000_260720'))) {
    copy.projectDir = path.join(BETA_PROJECTS, 'NGC7000_260720');
  } else {
    copy.projectDir = remapDir(copy.projectDir);
  }

  for (const sh of (copy.shoots || [])) {
    if (sh.ingestPath) sh.ingestPath = remapDir(sh.ingestPath);
    if (sh.ingestMeta) {
      sh.ingestMeta = remapIngestMeta(sh.ingestMeta);
      const folder = sh.ingestMeta.shootFolder;
      const filter = (copy.filterTargets
        && copy.filterTargets[sh.filterIndex]
        && copy.filterTargets[sh.filterIndex].filter) || null;
      if (folder && filter && copy.projectDir) {
        const candidate = path.join(copy.projectDir, filter, folder);
        if (fs.existsSync(candidate)) {
          sh.ingestPath = candidate;
          sh.ingestMeta.destRoots = [candidate];
        }
      } else if (sh.ingestMeta.destRoots && sh.ingestMeta.destRoots[0]) {
        sh.ingestPath = sh.ingestMeta.destRoots[0];
      }
      fixLightCounts(sh);
    }
  }
  projects.push(copy);
}

const restored = {
  ...wiped,
  projects,
  asiairSourcePath: wiped.asiairSourcePath || dev.asiairSourcePath || 'G:\\',
  appMeta: {
    version: '0.3.0',
    build: 30,
    savedAt: new Date().toISOString(),
    restoredFrom: 'dev-remap-after-empty-projects-wipe',
  },
};

atomicWrite(BETA_FILE, restored);
const verify = JSON.parse(fs.readFileSync(BETA_FILE, 'utf8'));
console.log(JSON.stringify({
  projects: (verify.projects || []).map((p) => ({
    name: p.name,
    dir: p.projectDir,
    dirExists: !!(p.projectDir && fs.existsSync(p.projectDir)),
    shoots: (p.shoots || []).length,
    ingested: (p.shoots || []).filter((s) => s.ingestPath).map((s) => ({
      date: s.date,
      lights: s.ingestMeta && s.ingestMeta.lightCount,
      byType: s.ingestMeta && s.ingestMeta.byType && s.ingestMeta.byType.light,
      path: s.ingestPath,
      exists: !!(s.ingestPath && fs.existsSync(s.ingestPath)),
    })),
  })),
  assets: (verify.assets || []).length,
  filters: (verify.filters || []).length,
}, null, 2));
