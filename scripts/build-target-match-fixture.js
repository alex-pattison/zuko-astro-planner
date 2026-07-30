/**
 * Build ASIAIR fixture for RA/Dec + ROTATOR (camera angle) target-match QA.
 *
 * Fixture: staging/asiair-test-target-match/
 * Planner savedTarget = Rosette Nebula (J2000 ≈ 97.98°, +4.94°)
 * Planner framerRotation = 27° (set on test project)
 *
 * ASIAIR FITS use ROTATOR = camera angle (same keyword as real ASIAIR dumps).
 *
 * Usage: node scripts/build-target-match-fixture.js
 * Quit Electron before running (dashboard JSON is rewritten).
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'staging', 'asiair-test-target-match');
const DATA_PATH = path.join(ROOT, 'data', 'zuko-dashboard-data.json');
const PREFERRED_DATA = path.join(
  'H:\\Photography\\Astrophotography\\Dashboard',
  'zuko-dashboard-data.json',
);

const PLANNER = {
  name: 'Rosette Nebula',
  ra: 97.9792,
  dec: 4.9428,
  framerRotation: 27, // Target Framer setting — left Aladin pane
};

const GAIN = 120;
const TEMP = -10;
const EXP_LIGHT = 180;
const EXP_FLAT = 0.5;
const EXP_BIAS = 2;

/** Folders under Light/ — RA/Dec offsets + ROTATOR (camera angle). */
const FOLDERS = {
  near: {
    folder: 'Rosette_Near',
    object: 'Rosette Nebula',
    ra: 98.05,
    dec: 5.05,
    rotator: 27, // matches planner framer — FOV boxes should align
  },
  nearRotated: {
    folder: 'Rosette_Rotated',
    object: 'Rosette Nebula',
    ra: 98.02,
    dec: 4.98,
    rotator: 209, // real ASIAIR-like camera angle (sample dumps use ~209)
  },
  confirm: {
    folder: 'Maybe_Close',
    object: 'Maybe Close Field',
    ra: 99.35,
    dec: 5.0,
    rotator: 45,
  },
  confirmTwist: {
    folder: 'Maybe_Twisted',
    object: 'Close Field Twisted',
    ra: 99.1,
    dec: 5.2,
    rotator: 120,
  },
  far: {
    folder: 'Orion_Far',
    object: 'M42 Orion Nebula',
    ra: 83.8221,
    dec: -5.3911,
    rotator: 0,
  },
  noCoords: {
    folder: 'Mystery_NoCoords',
    object: 'Unknown Object',
    ra: null,
    dec: null,
    rotator: 15,
  },
};

function pad80(s) {
  const t = String(s).slice(0, 80);
  return t + ' '.repeat(80 - t.length);
}

function fitsValue(v) {
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  if (typeof v === 'number') {
    const s = Number.isInteger(v) ? String(v) : String(v);
    return s.padStart(20, ' ');
  }
  const q = `'${String(v).replace(/'/g, "''")}'`;
  return q.padEnd(20, ' ');
}

function fitsCard(key, value, comment) {
  const k = String(key).toUpperCase().padEnd(8, ' ').slice(0, 8);
  let card;
  if (value === undefined) {
    card = k;
  } else {
    card = `${k}= ${fitsValue(value)}`;
    if (comment) card += ` / ${comment}`;
  }
  return pad80(card);
}

function buildMinimalFits(kw = {}) {
  const cards = [
    fitsCard('SIMPLE', true, 'target-match test FITS'),
    fitsCard('BITPIX', 8),
    fitsCard('NAXIS', 0),
    fitsCard('EXTEND', true),
  ];
  for (const [k, v] of Object.entries(kw)) {
    if (v == null) continue;
    cards.push(fitsCard(k, v, k === 'ROTATOR' ? 'Camera Angle' : undefined));
  }
  cards.push(pad80('END'));
  let header = cards.join('');
  const pad = (2880 - (header.length % 2880)) % 2880;
  header += ' '.repeat(pad);
  return Buffer.from(header, 'ascii');
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function writeFit(filePath, kw) {
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, buildMinimalFits(kw));
}

function stamp(ymd, hms) {
  return `${ymd}-${hms}`;
}

function lightName(target, filterLetter, ymd, hms, seq) {
  return `Light_${target}_180.0s_Bin2_${filterLetter}_${stamp(ymd, hms)}_${TEMP.toFixed(1)}C_${String(seq).padStart(4, '0')}.fit`;
}

function flatName(filterLetter, ymd, hms, seq) {
  return `Flat_500.0ms_Bin2_${filterLetter}_${stamp(ymd, hms)}_${TEMP.toFixed(1)}C_${String(seq).padStart(4, '0')}.fit`;
}

function biasName(ymd, hms, seq) {
  return `Bias_${EXP_BIAS}.0s_Bin2_H_${stamp(ymd, hms)}_${TEMP.toFixed(1)}C_${String(seq).padStart(4, '0')}.fit`;
}

function darkName(ymd, hms, seq) {
  return `Dark_${EXP_LIGHT}.0s_Bin2_H_${stamp(ymd, hms)}_${TEMP.toFixed(1)}C_${String(seq).padStart(4, '0')}.fit`;
}

function headerFor(opts) {
  const { ymd, hms, filter, imagetyp, object, ra, dec, rotator } = opts;
  const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
  const kw = {
    OBJECT: object,
    FILTER: filter,
    EXPTIME: opts.exptime,
    GAIN,
    'CCD-TEMP': TEMP,
    'SET-TEMP': TEMP,
    XBINNING: 2,
    'DATE-OBS': iso,
    IMAGETYP: imagetyp,
  };
  if (ra != null) kw.RA = ra;
  if (dec != null) kw.DEC = dec;
  if (rotator != null) kw.ROTATOR = rotator;
  return kw;
}

async function writeLightFolder(folderSpec, ymd, count, startHms, filter = 'Ha', letter = 'H') {
  const dir = path.join(FIXTURE, 'Autorun', 'Light', folderSpec.folder);
  const base = parseInt(startHms, 10);
  for (let i = 0; i < count; i++) {
    const hms = String(base + i * 3).padStart(6, '0');
    const ra = folderSpec.ra != null ? folderSpec.ra + (i - 1) * 0.01 : null;
    const dec = folderSpec.dec != null ? folderSpec.dec + (i - 1) * 0.005 : null;
    // Slight rotator jitter so median is meaningful
    const rotator = folderSpec.rotator != null
      ? folderSpec.rotator + (i === 1 ? 0 : (i - 1) * 0.5)
      : null;
    const name = lightName(folderSpec.folder.replace(/\s+/g, '_'), letter, ymd, hms, i + 1);
    await writeFit(path.join(dir, name), headerFor({
      ymd,
      hms,
      filter,
      imagetyp: 'Light',
      object: folderSpec.object,
      exptime: EXP_LIGHT,
      ra,
      dec,
      rotator,
    }));
  }
}

async function writeCalibs() {
  const flatDir = path.join(FIXTURE, 'Autorun', 'Flat');
  const biasDir = path.join(FIXTURE, 'Autorun', 'Bias');
  const darkDir = path.join(FIXTURE, 'Autorun', 'Dark');
  for (const [filter, letter, ymd, start] of [
    ['Ha', 'H', '20260729', 60100],
    ['OIII', 'O', '20260729', 60200],
    ['Ha', 'H', '20260731', 60300],
    ['SII', 'S', '20260801', 60400],
  ]) {
    for (let i = 0; i < 2; i++) {
      const hms = String(start + i).padStart(6, '0');
      await writeFit(path.join(flatDir, flatName(letter, ymd, hms, i + 1)), headerFor({
        ymd, hms, filter, imagetyp: 'Flat', object: 'Flat', exptime: EXP_FLAT,
      }));
    }
  }
  for (let i = 0; i < 3; i++) {
    const hms = String(120000 + i).padStart(6, '0');
    await writeFit(path.join(biasDir, biasName('20260727', hms, i + 1)), headerFor({
      ymd: '20260727', hms, filter: 'Ha', imagetyp: 'Bias', object: 'Bias', exptime: EXP_BIAS,
    }));
  }
  for (let i = 0; i < 2; i++) {
    const hms = String(140000 + i * 3).padStart(6, '0');
    await writeFit(path.join(darkDir, darkName('20260727', hms, i + 1)), headerFor({
      ymd: '20260727', hms, filter: 'Ha', imagetyp: 'Dark', object: 'Dark', exptime: EXP_LIGHT,
    }));
  }
}

async function buildFixture() {
  if (fs.existsSync(FIXTURE)) {
    await fsp.rm(FIXTURE, { recursive: true, force: true });
  }

  // 260728 — mixed: near (rot 27°) + confirm (45°) + far + no-coords orphan
  await writeLightFolder(FOLDERS.near, '20260728', 3, '213000');
  await writeLightFolder(FOLDERS.confirm, '20260728', 3, '220000');
  await writeLightFolder(FOLDERS.far, '20260728', 3, '223000');
  await writeLightFolder(FOLDERS.noCoords, '20260728', 2, '231000');

  // 260729 — far only
  await writeLightFolder(FOLDERS.far, '20260729', 2, '230000');

  // 260730 — near with ASIAIR-like ROTATOR 209° (FOV twist vs planner 27°)
  await writeLightFolder(FOLDERS.nearRotated, '20260730', 4, '214000');
  await writeLightFolder(FOLDERS.nearRotated, '20260730', 2, '221000', 'OIII', 'O');

  // 260731 — confirm-band only + twisted rotation
  await writeLightFolder(FOLDERS.confirmTwist, '20260731', 3, '220000');

  // 260801 — near auto + confirm alone together (SII)
  await writeLightFolder(FOLDERS.near, '20260801', 2, '213000', 'SII', 'S');
  await writeLightFolder(FOLDERS.confirm, '20260801', 2, '220000', 'SII', 'S');

  await writeCalibs();

  const readme = `# [TEST] Target Match — RA/Dec + ROTATOR

Synthetic ASIAIR dump. Planner: **Rosette** @ ${PLANNER.ra}°, ${PLANNER.dec}° · framer **${PLANNER.framerRotation}°**.

Real ASIAIR lights use \`ROTATOR\` = **Camera Angle** (e.g. 209 on Veil samples).
Confirm UI: **left** = planner framer rotation · **right** = median FITS \`ROTATOR\`.

\`\`\`
node scripts/build-target-match-fixture.js
\`\`\`

## Nights / folders

| Night | Folders | What to test |
|-------|---------|--------------|
| 260728 | Near@27°, Maybe_Close@45°, Orion, Mystery_NoCoords | auto used (no popup); siblings excluded; Review source for Maybe/Orion |
| 260729 | Orion only | only_other force/reject |
| 260730 | Rosette_Rotated@209° (Ha+OIII) | auto match with **twisted FOV** vs planner 27° |
| 260731 | Maybe_Twisted@120° | confirm-only + rotation |
| 260801 | Near + Maybe_Close (SII) | multi-folder on SII |

## Chip colors

- **Green** Target matched / Target confirmed — this shoot’s target is bound
- **Yellow** Target assumed — no confident coords
`;
  await fsp.writeFile(path.join(FIXTURE, 'README.md'), readme);
  console.log('Wrote fixture', FIXTURE);
}

function shoot(date, filterIndex, hours, complete = true) {
  return {
    date,
    filterIndex,
    hours,
    complete: !!complete,
    creditedHours: complete ? hours : 0,
    sourcePath: null,
    ingestPath: null,
    ingestMeta: null,
  };
}

function testProject(projectDir) {
  return {
    name: '[TEST] Target Match — RA/Dec QA',
    target: 'Rosette Nebula — RA/Dec + ROTATOR fixture',
    frameMode: 'Reducer — TEST (synthetic FITS)',
    projectDir,
    centerCoords: `RA ${PLANNER.ra}°  Dec ${PLANNER.dec}°`,
    anchorStar: '—',
    rotation: `${PLANNER.framerRotation}° (test framer)`,
    status: 'active',
    notes:
      'TEST — RA/Dec + ROTATOR. Left Aladin = framer ' + PLANNER.framerRotation +
      '°. Right = FITS ROTATOR (camera angle). Nights 260728–260801. Rebuild: node scripts/build-target-match-fixture.js',
    savedTarget: {
      name: PLANNER.name,
      ra: PLANNER.ra,
      dec: PLANNER.dec,
    },
    framerMode: 'reducer',
    framerRotation: PLANNER.framerRotation,
    ignoredAsiairFolders: [],
    asiairIgnoredSources: [],
    asiairBoundFolders: [],
    processStatus: 'planning',
    filterTargets: [
      { filter: 'Ha', location: 'Home', bortle: '9', targetHrs: 2, loggedHrs: 0 },
      { filter: 'OIII', location: 'Home', bortle: '9', targetHrs: 1.5, loggedHrs: 0 },
      { filter: 'SII', location: 'Home', bortle: '9', targetHrs: 1, loggedHrs: 0 },
    ],
    checklist: [
      { id: 'tm-728', text: '260728: Near auto@27°; Maybe_Close popup@45°; Orion excluded', done: false },
      { id: 'tm-730', text: '260730: Rosette_Rotated auto but ROTATOR 209° vs framer 27° (FOV twist)', done: false },
      { id: 'tm-731', text: '260731: Maybe_Twisted confirm @120°', done: false },
      { id: 'tm-review', text: 'Review source shows no-log / mismatch rows', done: false },
    ],
    shoots: [
      // Captured (ready for ingest / already in log for fixture nights)
      shoot('260728', 0, 0.15, true),
      shoot('260729', 0, 0.1, true),
      shoot('260730', 0, 0.2, true),
      shoot('260730', 1, 0.1, true),
      shoot('260731', 0, 0.15, true),
      shoot('260801', 2, 0.1, true),
      // Planned but not Captured yet (Pending in shoot log)
      shoot('260802', 0, 1.0, false),   // Ha planned
      shoot('260802', 1, 0.75, false),  // OIII planned
      shoot('260803', 2, 0.5, false),   // SII planned
    ],
    astrobinLinks: [],
  };
}

function loadData() {
  const prefer = fs.existsSync(PREFERRED_DATA) ? PREFERRED_DATA : DATA_PATH;
  const raw = fs.readFileSync(prefer, 'utf8');
  return { data: JSON.parse(raw), prefer };
}

function saveData(data) {
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(DATA_PATH, json);
  console.log('Wrote', DATA_PATH);
  try {
    if (fs.existsSync(path.dirname(PREFERRED_DATA))) {
      fs.writeFileSync(PREFERRED_DATA, json);
      console.log('Mirrored', PREFERRED_DATA);
    }
  } catch (e) {
    console.warn('Could not mirror to H: drive:', e.message);
  }
}

async function upsertProject() {
  const { data } = loadData();
  if (!data.appMeta) data.appMeta = {};
  data.appMeta.build = Math.max(Number(data.appMeta.build) || 0, 6);
  const proj = testProject(FIXTURE);

  // Drop side-effect projects spawned during confirm QA (same ASIAIR dump).
  const before = (data.projects || []).length;
  data.projects = (data.projects || []).filter((p) => {
    if (/Target Match/i.test(p.name || '')) return true;
    const notes = String(p.notes || '');
    const sameDump = String(p.projectDir || '').replace(/\\/g, '/').includes('asiair-test-target-match');
    if (sameDump && /Created from ASIAIR folder/i.test(notes)) return false;
    return true;
  });
  const removed = before - data.projects.length;
  if (removed) console.log('Removed', removed, 'confirm side-effect project(s)');

  const idx = data.projects.findIndex((p) => /Target Match/i.test(p.name || ''));
  if (idx >= 0) {
    data.projects[idx] = {
      ...data.projects[idx],
      ...proj,
      shoots: proj.shoots,
      filterTargets: proj.filterTargets,
      checklist: proj.checklist,
      ignoredAsiairFolders: [],
      asiairIgnoredSources: [],
      asiairBoundFolders: [],
      processStatus: 'planning',
      astrobinLinks: proj.astrobinLinks || [],
    };
    console.log('Updated project at index', idx);
  } else {
    data.projects.push(proj);
    console.log('Added project at index', data.projects.length - 1);
  }
  // Recompute logged hrs (Captured only)
  const p = data.projects[idx >= 0 ? idx : data.projects.length - 1];
  for (const ft of p.filterTargets) ft.loggedHrs = 0;
  for (const sh of p.shoots) {
    if (!sh.complete) continue;
    const ft = p.filterTargets[sh.filterIndex];
    if (ft) ft.loggedHrs = Math.round(((ft.loggedHrs || 0) + (Number(sh.hours) || 0)) * 1000) / 1000;
  }
  saveData(data);
}

async function main() {
  await buildFixture();
  const upsert = process.argv.includes('--upsert');
  if (upsert) {
    await upsertProject();
    console.log('\nDone. Quit/reload Electron, open [TEST] Target Match — RA/Dec QA.');
  } else {
    console.log('\nFixture FITS ready (dashboard not modified). Pass --upsert to add [TEST] project.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
