'use strict';

/**
 * Restore Veil SII@Queechy B5 capture-plan row in Beta (disk folder already exists),
 * remap 260725 shoot onto it, then mirror Beta projects → Dev with F: junctions.
 *
 * Usage: node scripts/restore-veil-queechy-and-mirror-dev.js
 */
const fs = require('fs');
const path = require('path');

const BETA_FILE = 'H:/Photography/Astrophotography/Dashboard/zuko-dashboard-data.json';
const DEV_FILE = path.join(__dirname, '..', 'data', 'zuko-dashboard-data.json');
const BETA_ZUKO = 'H:\\Photography\\Astrophotography\\Zuko';
const DEV_VEIL = 'F:\\zuko_dev\\Projects\\NGC6960_Q326_beta_mirror';
const DEV_NA = 'F:\\zuko_dev\\Projects\\NGC7000_260720_beta_mirror';

function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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

function ensureJunction(linkPath, targetPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  if (fs.existsSync(linkPath)) {
    try {
      fs.rmdirSync(linkPath);
    } catch {
      const aside = `${linkPath}.pre-queechy-fix.${Date.now()}`;
      fs.renameSync(linkPath, aside);
      console.log('moved aside', aside);
    }
  }
  fs.symlinkSync(targetPath, linkPath, 'junction');
  console.log('junction', linkPath, '->', targetPath);
}

function remapStringTree(obj, from, to) {
  if (obj == null) return;
  if (typeof obj === 'string') return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      if (typeof v === 'string' && v.includes(from.split('\\').pop() || from)) {
        // fall through to object walk for arrays of strings
      }
      if (typeof v === 'string' && v.includes(from)) obj[i] = v.split(from).join(to);
      else remapStringTree(v, from, to);
    });
    return;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && v.includes(from)) obj[k] = v.split(from).join(to);
      else remapStringTree(v, from, to);
    }
  }
}

function summarizeVeil(label, project) {
  console.log(`\n=== ${label} ===`);
  console.log('projectDir', project.projectDir);
  for (const [i, f] of (project.filterTargets || []).entries()) {
    console.log(`  ft[${i}] ${f.filter}@${f.location}/B${f.bortle} target=${f.targetHrs} logged=${f.loggedHrs}`);
  }
  for (const sh of project.shoots || []) {
    const ft = project.filterTargets[sh.filterIndex];
    console.log(
      `  shoot ${sh.date} -> ${ft ? `${ft.filter}@${ft.location}` : '?'} folder=${(sh.ingestMeta && sh.ingestMeta.shootFolder) || ''}`
    );
  }
}

function countFits(dir) {
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) n += countFits(p);
    else if (/\.fit/i.test(ent.name)) n += 1;
  }
  return n;
}

function restoreQueechyOnVeil(veil) {
  const fts = veil.filterTargets || (veil.filterTargets = []);
  let queechyFi = fts.findIndex((f) => f && f.filter === 'SII' && /queechy/i.test(String(f.location || '')));

  if (queechyFi < 0) {
    let insertAt = fts.findIndex((f) => f && f.filter === 'SII' && /home/i.test(String(f.location || '')));
    if (insertAt < 0) insertAt = fts.findIndex((f) => f && f.filter === 'SII');
    if (insertAt < 0) throw new Error('No SII filter target to insert after');
    insertAt += 1;
    fts.splice(insertAt, 0, {
      filter: 'SII',
      location: 'Queechy',
      bortle: '5',
      targetHrs: 1,
      loggedHrs: 0,
      stackMeta: null,
      cullMeta: null,
      aggregateMeta: null,
      registerMeta: null,
    });
    for (const sh of veil.shoots || []) {
      if (Number(sh.filterIndex) >= insertAt) sh.filterIndex = Number(sh.filterIndex) + 1;
    }
    queechyFi = insertAt;
    console.log('inserted SII@Queechy B5 at filterIndex', queechyFi);
  } else {
    console.log('Queechy filter target already present at', queechyFi);
  }

  let remapped = 0;
  for (const sh of veil.shoots || []) {
    const folder = (sh.ingestMeta && sh.ingestMeta.shootFolder) || '';
    const pathHint = String(sh.ingestPath || '');
    const isQueechyNight =
      /B5_Queechy/i.test(folder) ||
      /B5_Queechy/i.test(pathHint) ||
      (String(sh.date) === '260725' && /_SII_/i.test(folder || pathHint));
    if (!isQueechyNight) continue;
    if (Number(sh.filterIndex) !== queechyFi) {
      console.log('remap shoot', sh.date, 'filterIndex', sh.filterIndex, '->', queechyFi, folder || pathHint);
      sh.filterIndex = queechyFi;
      remapped += 1;
    }
  }
  recomputeHours(veil);
  return { queechyFi, remapped };
}

function main() {
  JSON.parse(fs.readFileSync(BETA_FILE, 'utf8')); // sanity

  const betaBak = backup(BETA_FILE, 'pre-queechy-restore');
  const devBak = backup(DEV_FILE, 'pre-beta-mirror-queechy');
  console.log('backups', { betaBak, devBak });

  const beta = JSON.parse(fs.readFileSync(BETA_FILE, 'utf8'));
  const veil = (beta.projects || []).find((p) => /veil/i.test(p.name || ''));
  if (!veil) throw new Error('Veil missing in Beta');

  const qDir = path.join(veil.projectDir || '', 'SII', '260725_SII_B5_Queechy');
  const fits = countFits(qDir);
  console.log('Queechy disk folder', qDir, 'exists=', fs.existsSync(qDir), 'fits=', fits);
  if (!fs.existsSync(qDir)) throw new Error('Queechy shoot folder missing on disk — aborting');

  const { remapped } = restoreQueechyOnVeil(veil);
  beta.appMeta = {
    ...(beta.appMeta || {}),
    savedAt: new Date().toISOString(),
    note: 'Restored Veil SII@Queechy B5 capture-plan row; 260725 points at Queechy (disk intact)',
  };
  atomicWrite(BETA_FILE, beta);
  JSON.parse(fs.readFileSync(BETA_FILE, 'utf8'));
  console.log('Beta written; remapped shoots:', remapped);
  summarizeVeil('BETA', veil);

  ensureJunction(DEV_VEIL, path.join(BETA_ZUKO, 'NGC6960_Q326'));
  if (fs.existsSync(path.join(BETA_ZUKO, 'NGC7000_260720'))) {
    ensureJunction(DEV_NA, path.join(BETA_ZUKO, 'NGC7000_260720'));
  }

  const dev = JSON.parse(fs.readFileSync(DEV_FILE, 'utf8'));
  const betaClone = JSON.parse(JSON.stringify(beta));
  for (const p of betaClone.projects || []) {
    if (/veil/i.test(p.name || '')) {
      p.projectDir = DEV_VEIL;
      remapStringTree(p, 'H:\\Photography\\Astrophotography\\Zuko\\NGC6960_Q326', DEV_VEIL);
    }
    if (/north america|ngc\s*7000/i.test(p.name || '')) {
      p.projectDir = DEV_NA;
      remapStringTree(p, 'H:\\Photography\\Astrophotography\\Zuko\\NGC7000_260720', DEV_NA);
    }
  }

  const darkLib = (dev.darkLibrary && dev.darkLibrary.path) || 'F:\\zuko_dev\\Dark Library';
  const out = {
    ...dev,
    projects: betaClone.projects,
    asiairSourcePath: betaClone.asiairSourcePath || dev.asiairSourcePath || 'G:\\',
    filters: betaClone.filters || dev.filters,
    darkLibrary: {
      ...(dev.darkLibrary || {}),
      path: darkLib,
      index: (dev.darkLibrary && dev.darkLibrary.index) || [],
      indexedAt: (dev.darkLibrary && dev.darkLibrary.indexedAt) || null,
    },
    appMeta: {
      ...(dev.appMeta || {}),
      savedAt: new Date().toISOString(),
      mirroredFromBeta: true,
      note: 'Dev mirrored from Beta after Queechy capture-plan restore',
    },
  };
  atomicWrite(DEV_FILE, out);
  const verify = JSON.parse(fs.readFileSync(DEV_FILE, 'utf8'));
  const v = verify.projects.find((p) => /veil/i.test(p.name || ''));
  summarizeVeil('DEV', v);
  console.log('\nDone. Quit/reload Dev (and Beta if open) so in-memory state does not overwrite.');
}

main();
