'use strict';

/**
 * Add California Nebula + Elephant Trunk (planned Sept 2026) to Beta dashboard.
 * Always backups first. Never writes empty projects.
 *
 *   node scripts/add-sept-nebulae-beta.js
 */
const fs = require('fs');
const path = require('path');

const BETA = 'H:/Astrophotography/Dashboard/zuko-dashboard-data.json';

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

function ft(filter, location, bortle, targetHrs) {
  return {
    filter,
    location,
    bortle,
    targetHrs,
    loggedHrs: 0,
    stackMeta: null,
    cullMeta: null,
    aggregateMeta: null,
    registerMeta: null,
  };
}

function plannedShoot(date, filterIndex, hours) {
  return {
    date,
    filterIndex,
    hours,
    complete: false,
    creditedHours: 0,
    sourcePath: null,
    ingestPath: null,
    ingestMeta: null,
    preprocessMeta: null,
  };
}

function californiaProject() {
  // NGC 1499 center; ξ Per (Menkib) is ~1.1° SW — inside reducer FOV (~3.9°×2.7°).
  return {
    name: 'California Nebula',
    target: 'NGC 1499 / Sh2-220 (California) + ξ Persei (Menkib)',
    frameMode: 'Reducer + Bin2 · 280mm f/3.9',
    centerCoords: 'RA 4h03m18s  Dec +36°25\'18"',
    rotation: '0°',
    status: 'planning',
    notes:
      'H II region ionized by O7 star ξ Per (Menkib). ~2.5°×0.7° — fits one FRA400 reducer frame; keep Menkib in the SW corner. Home Bortle 9 only. ' +
      'Visually this is the classic Hβ (“California filter”) object; photographically Ha still wins on photons (Balmer Ha/Hβ ≈ 2.85) even though ASI294MM QE is near peak at 486 nm (~90%) vs ~75–80% at Ha 656 nm. ' +
      '15h: Ha 9h (structure/luminance) + Hβ 4h (second Balmer — will not match Ha SNR) + OIII 2h (weak). No RGB — use NB/HOO stars. Skip SII. ' +
      'Session window is sunset→23:00 (~2–3h after twilight). RA 4h is still low in the east at 11 PM in early Sept (~20°); wait until late Sept / October when it is ~40°+ by 11 PM. Elephant Trunk takes the early-Sept evenings. Re-shoot flats if rotation changes.',
    filterTargets: [
      ft('Ha', 'Home', '9', 9),
      ft('Hb', 'Home', '9', 4),
      ft('OIII', 'Home', '9', 2),
    ],
    checklist: [
      { id: 'cal-frame', text: 'Framer: 2.5° length along long FOV axis; ξ Per in SW corner', done: false },
      { id: 'cal-hb', text: 'Include Hβ in the ASIAIR plan (Baader slot 8) — not just Ha', done: false },
      { id: 'cal-window', text: 'Do not start until late Sept — must be up by 23:00, not a midnight target', done: false },
      { id: 'cal-flats', text: 'Shoot flats for this rotation (Ha / Hβ / OIII)', done: false },
    ],
    shoots: [
      plannedShoot('260925', 0, 2.5),
    ],
    astrobinLinks: [],
    savedTarget: {
      name: 'NGC 1499',
      ra: 60.825,
      dec: 36.42167,
    },
    framerMode: 'reducer',
    framerRotation: 0,
    projectDir: '',
    processStatus: '',
    ignoredAsiairFolders: [],
    asiairBoundFolders: [],
    asiairIgnoredSources: [],
    startDate: '2026-09-20',
    endDate: '2026-10-20',
    startDateManual: true,
    endDateManual: true,
    imagingConfig: 'reducer-bin2',
  };
}

function elephantTrunkProject() {
  // IC 1396A trunk; whole IC 1396 bubble (~3°) still fits reducer FOV.
  return {
    name: 'Elephant Trunk Nebula',
    target: 'IC 1396A (Elephant Trunk) in IC 1396 / Trumpler 37',
    frameMode: 'Reducer + Bin2 · 280mm f/3.9',
    centerCoords: 'RA 21h35m30s  Dec +57°23\'00"',
    rotation: '0°',
    status: 'planning',
    notes:
      'Cepheus H II / dark globule. Trunk is SII-bright; whole IC 1396 bubble is ~3° and fits the reducer. Home Bortle 9 only. Dec +57° / RA 21.6h is high in the evening from NYC — this is the sunset→23:00 target when you get back (~2–3h dark after twilight). California (RA 4h) does not fit that window until late Sept. ' +
      '15h SHO: Ha 6.5h + SII 4.5h + OIII 4h. No RGB — use SHO stars. Planned first night 260908 Ha 2.5h (adjust if you get back earlier). Re-shoot flats if rotation changes.',
    filterTargets: [
      ft('Ha', 'Home', '9', 6.5),
      ft('SII', 'Home', '9', 4.5),
      ft('OIII', 'Home', '9', 4),
    ],
    checklist: [
      { id: 'et-frame', text: 'Framer: trunk + HD 206267; whole IC 1396 bubble in reducer FOV', done: false },
      { id: 'et-sii', text: 'Prioritize SII on the trunk (moon-ok); OIII on darker nights', done: false },
      { id: 'et-window', text: 'Shoot sunset→23:00; this is the early-Sept evening object', done: false },
      { id: 'et-flats', text: 'Shoot flats for this rotation (Ha / SII / OIII)', done: false },
    ],
    shoots: [
      plannedShoot('260908', 0, 2.5),
    ],
    astrobinLinks: [],
    savedTarget: {
      name: 'IC 1396A',
      ra: 323.875,
      dec: 57.38333,
    },
    framerMode: 'reducer',
    framerRotation: 0,
    projectDir: '',
    processStatus: '',
    ignoredAsiairFolders: [],
    asiairBoundFolders: [],
    asiairIgnoredSources: [],
    startDate: '2026-09-05',
    endDate: '2026-10-05',
    startDateManual: true,
    endDateManual: true,
    imagingConfig: 'reducer-bin2',
  };
}

function upsertByName(projects, next) {
  const idx = projects.findIndex((p) => String(p.name || '').toLowerCase() === next.name.toLowerCase());
  if (idx >= 0) {
    projects[idx] = next;
    return { idx, action: 'updated' };
  }
  projects.push(next);
  return { idx: projects.length - 1, action: 'added' };
}

function main() {
  if (!fs.existsSync(BETA)) throw new Error('Beta dashboard missing: ' + BETA);
  const data = JSON.parse(fs.readFileSync(BETA, 'utf8'));
  const n = (data.projects || []).length;
  if (!n) throw new Error('Beta projects empty — aborting');

  const bak = backup(BETA, 'pre-sept-nebulae');
  console.log('backup', bak);

  const cal = upsertByName(data.projects, californiaProject());
  const et = upsertByName(data.projects, elephantTrunkProject());
  if (!(data.projects && data.projects.length)) throw new Error('refusing empty projects');

  data.appMeta = {
    ...(data.appMeta || {}),
    savedAt: new Date().toISOString(),
    note: 'California + Elephant Trunk: Home only, no RGB (SHO/HOO stars), sunset–23:00 window',
  };
  atomicWrite(BETA, data);
  JSON.parse(fs.readFileSync(BETA, 'utf8'));

  const verify = JSON.parse(fs.readFileSync(BETA, 'utf8'));
  console.log('projects', verify.projects.length, '(was', n + ')');
  console.log('California', cal);
  console.log('Elephant Trunk', et);
  const c = verify.projects.find((p) => /california/i.test(p.name));
  const e = verify.projects.find((p) => /elephant/i.test(p.name));
  const sum = (p) => (p.filterTargets || []).reduce((s, f) => s + Number(f.targetHrs || 0), 0);
  console.log('California hours', sum(c), 'filters', c.filterTargets.map((f) => f.filter + ' ' + f.targetHrs).join(', '));
  console.log('Elephant hours', sum(e), 'filters', e.filterTargets.map((f) => f.filter + ' ' + f.targetHrs).join(', '));
  console.log('ET planned', e.shoots);
  console.log('CA planned', c.shoots);
}

main();
