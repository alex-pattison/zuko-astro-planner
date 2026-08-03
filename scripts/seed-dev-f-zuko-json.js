#!/usr/bin/env node
/**
 * Remap H: Beta Zuko paths → F:\zuko_dev in the Dev checkout dashboard JSON.
 *   H:\Photography\Astrophotography\Zuko\<project> → F:\zuko_dev\Projects\<project>
 *   H:\...\Zuko\Dark Library → F:\zuko_dev\Dark Library
 * Does not touch H: Beta dashboard JSON.
 *
 * Usage: node scripts/seed-dev-f-zuko-json.js [optionalSourceJson]
 * Default source/dest: <checkout>/data/zuko-dashboard-data.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DST = path.join(ROOT, 'data', 'zuko-dashboard-data.json');
const SRC = process.argv[2] ? path.resolve(process.argv[2]) : DST;
const H_ZUKO = 'H:\\Photography\\Astrophotography\\Zuko';
const F_ROOT = 'F:\\zuko_dev';
const F_PROJECTS = path.join(F_ROOT, 'Projects');
const F_DARK = path.join(F_ROOT, 'Dark Library');

function normalizeWin(s) {
  let t = String(s).trim().replace(/\//g, '\\');
  if (t.startsWith('\\\\')) {
    return '\\\\' + t.slice(2).replace(/\\+/g, '\\');
  }
  return t.replace(/\\+/g, '\\');
}

function remapPath(s) {
  if (typeof s !== 'string') return s;
  const t = normalizeWin(s);
  const hDark = H_ZUKO + '\\Dark Library';
  if (t === hDark || t.startsWith(hDark + '\\')) {
    return F_DARK + t.slice(hDark.length);
  }
  if (t === H_ZUKO || t.startsWith(H_ZUKO + '\\')) {
    // Project / other trees under Zuko → Dev Projects pool
    return F_PROJECTS + t.slice(H_ZUKO.length);
  }
  // Also fix older F:\\Zuko paths if re-run
  const oldRoot = 'F:\\Zuko';
  if (t === oldRoot || t.startsWith(oldRoot + '\\')) {
    const rest = t.slice(oldRoot.length); // e.g. \NGC7000... or \Dark Library or \Projects\...
    if (rest === '\\Dark Library' || rest.startsWith('\\Dark Library\\')) {
      return F_DARK + rest.slice('\\Dark Library'.length);
    }
    if (rest === '\\Projects' || rest.startsWith('\\Projects\\')) {
      return F_PROJECTS + rest.slice('\\Projects'.length);
    }
    // Bare project folders that sat next to Projects
    return F_PROJECTS + rest;
  }
  return t;
}

function looksLikeFsPath(s) {
  return (
    /^[A-Za-z]:\\/.test(s) ||
    s.includes('Photography\\Astrophotography\\Zuko') ||
    s.includes('Photography/Astrophotography/Zuko') ||
    s.includes('F:\\Zuko') ||
    s.includes('F:/Zuko')
  );
}

function walk(o) {
  if (Array.isArray(o)) return o.map(walk);
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) out[k] = walk(v);
    return out;
  }
  if (typeof o === 'string' && looksLikeFsPath(o)) return remapPath(o);
  return o;
}

const data = walk(JSON.parse(fs.readFileSync(SRC, 'utf8')));

for (const pr of data.projects || []) {
  if (/North America/i.test(pr.name || '')) {
    pr.projectDir = path.join(F_PROJECTS, 'NGC7000_260720');
  }
  if (/Veil/i.test(pr.name || '')) {
    pr.projectDir = path.join(F_PROJECTS, 'NGC6960_Q326', '260725');
  }
}

data.darkLibrary = {
  path: F_DARK,
  index: [],
  indexedAt: null,
};

if (!data.appMeta) data.appMeta = {};
data.appMeta.savedAt = new Date().toISOString();

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, JSON.stringify(data, null, 2), 'utf8');

console.log('Wrote', DST);
for (const pr of data.projects || []) {
  console.log(' -', pr.name, '=>', pr.projectDir);
}
console.log('darkLibrary', data.darkLibrary);
