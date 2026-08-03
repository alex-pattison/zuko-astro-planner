/**
 * Build synthetic ASIAIR ingest test fixture + [TEST] Rosette project.
 *
 * Fixture: staging/asiair-test-rosette/
 *   Autorun/  — complete Ha night (Light/Flat/Bias/Dark) → Stage should succeed
 *   Plan/     — error / cross-session nights (Autorun+Plan are merged as one source):
 *               OIII missing Flat; SII complete via shared Bias from Autorun;
 *               Ha@45s missing Dark match
 *
 * Usage: node scripts/build-ingest-test-fixture.js
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'staging', 'asiair-test-rosette');
const DATA_PATH = path.join(ROOT, 'data', 'zuko-dashboard-data.json');
const PREFERRED_DATA = path.join(
  'H:\\Photography\\Astrophotography\\Dashboard',
  'zuko-dashboard-data.json',
);

const TARGET = 'NGC 2237';
const OBJECT = 'Rosette Nebula';
const GAIN = 120;
const TEMP = -10;
const EXP_LIGHT = 180;
const EXP_FLAT = 0.5;
const EXP_BIAS = 2;

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

/** Minimal header-only FITS (NAXIS=0) — enough for ingest header + filename parse. */
function buildMinimalFits(kw = {}) {
  const cards = [
    fitsCard('SIMPLE', true, 'synthetic test FITS'),
    fitsCard('BITPIX', 8, 'character'),
    fitsCard('NAXIS', 0, 'no image data'),
    fitsCard('EXTEND', true),
  ];
  for (const [k, v] of Object.entries(kw)) {
    if (v == null) continue;
    cards.push(fitsCard(k, v));
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

function lightName(target, expSec, filterLetter, ymd, hms, seq, tempC = TEMP) {
  const exp = Number.isInteger(expSec) ? `${expSec}.0s` : `${expSec}s`;
  return `Light_${target}_${exp}_Bin2_${filterLetter}_${stamp(ymd, hms)}_${tempC.toFixed(1)}C_${String(seq).padStart(4, '0')}.fit`;
}

function flatName(expSec, filterLetter, ymd, hms, seq) {
  const exp = expSec < 1 ? `${(expSec * 1000).toFixed(1)}ms` : `${expSec}.0s`;
  return `Flat_${exp}_Bin2_${filterLetter}_${stamp(ymd, hms)}_${TEMP.toFixed(1)}C_${String(seq).padStart(4, '0')}.fit`;
}

function biasName(ymd, hms, seq) {
  return `Bias_${EXP_BIAS}.0s_Bin2_H_${stamp(ymd, hms)}_${TEMP.toFixed(1)}C_${String(seq).padStart(4, '0')}.fit`;
}

function darkName(expSec, ymd, hms, seq) {
  return `Dark_${expSec}.0s_Bin2_H_${stamp(ymd, hms)}_${TEMP.toFixed(1)}C_${String(seq).padStart(4, '0')}.fit`;
}

function headerBase(opts) {
  const ymd = opts.ymd;
  const hms = opts.hms;
  const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
  return {
    OBJECT: opts.object || OBJECT,
    FILTER: opts.filter,
    EXPTIME: opts.exptime,
    GAIN,
    'CCD-TEMP': opts.tempC != null ? opts.tempC : TEMP,
    'SET-TEMP': TEMP,
    XBINNING: 2,
    'DATE-OBS': iso,
    IMAGETYP: opts.imagetyp,
  };
}

async function writeLights(dir, { filter, letter, ymd, count, expSec, startHms }) {
  const base = parseInt(startHms, 10);
  for (let i = 0; i < count; i++) {
    const hms = String(base + i * 3).padStart(6, '0');
    const name = lightName(TARGET, expSec, letter, ymd, hms, i + 1);
    await writeFit(path.join(dir, name), headerBase({
      filter, ymd, hms, exptime: expSec, imagetyp: 'Light',
    }));
  }
}

async function writeFlats(dir, { filter, letter, ymd, count, startHms }) {
  const base = parseInt(startHms, 10);
  for (let i = 0; i < count; i++) {
    const hms = String(base + i).padStart(6, '0');
    const name = flatName(EXP_FLAT, letter, ymd, hms, i + 1);
    await writeFit(path.join(dir, name), headerBase({
      filter, ymd, hms, exptime: EXP_FLAT, imagetyp: 'Flat', object: 'Flat',
    }));
  }
}

async function writeBiases(dir, { ymd, count, startHms }) {
  const base = parseInt(startHms, 10);
  for (let i = 0; i < count; i++) {
    const hms = String(base + i).padStart(6, '0');
    const name = biasName(ymd, hms, i + 1);
    await writeFit(path.join(dir, name), headerBase({
      filter: 'Ha', ymd, hms, exptime: EXP_BIAS, imagetyp: 'Bias', object: 'Bias',
    }));
  }
}

async function writeDarks(dir, { ymd, count, expSec, startHms }) {
  const base = parseInt(startHms, 10);
  for (let i = 0; i < count; i++) {
    const hms = String(base + i * 3).padStart(6, '0');
    const name = darkName(expSec, ymd, hms, i + 1);
    await writeFit(path.join(dir, name), headerBase({
      filter: 'Ha', ymd, hms, exptime: expSec, imagetyp: 'Dark', object: 'Dark',
    }));
  }
}

async function buildFixture() {
  if (fs.existsSync(FIXTURE)) {
    await fsp.rm(FIXTURE, { recursive: true, force: true });
  }

  // --- Autorun: complete Ha night 20260728 ---
  const autoLight = path.join(FIXTURE, 'Autorun', 'Light', TARGET);
  const autoFlat = path.join(FIXTURE, 'Autorun', 'Flat');
  const autoBias = path.join(FIXTURE, 'Autorun', 'Bias');
  const autoDark = path.join(FIXTURE, 'Autorun', 'Dark');
  await writeLights(autoLight, {
    filter: 'Ha', letter: 'H', ymd: '20260728', count: 3, expSec: EXP_LIGHT, startHms: '213000',
  });
  // Orphan lights: OIII on the Ha night — no shoot log entry for OIII on 260728
  await writeLights(autoLight, {
    filter: 'OIII', letter: 'O', ymd: '20260728', count: 2, expSec: EXP_LIGHT, startHms: '230000',
  });
  await writeFlats(autoFlat, {
    filter: 'Ha', letter: 'H', ymd: '20260729', count: 2, startHms: '060100',
  });
  await writeBiases(autoBias, { ymd: '20260727', count: 3, startHms: '120000' });
  await writeDarks(autoDark, { ymd: '20260727', count: 2, expSec: EXP_LIGHT, startHms: '140000' });

  // --- Plan: error-case nights (no Bias folder on purpose) ---
  const planLight = path.join(FIXTURE, 'Plan', 'Light', TARGET);
  const planFlat = path.join(FIXTURE, 'Plan', 'Flat');
  const planDark = path.join(FIXTURE, 'Plan', 'Dark');

  // OIII 20260729 — lights + darks, NO flats for OIII → Missing Flat (+ Missing Bias)
  await writeLights(planLight, {
    filter: 'OIII', letter: 'O', ymd: '20260729', count: 2, expSec: EXP_LIGHT, startHms: '220000',
  });

  // SII 20260730 — lights + flats, no Bias → Missing Bias
  await writeLights(planLight, {
    filter: 'SII', letter: 'S', ymd: '20260730', count: 2, expSec: EXP_LIGHT, startHms: '221500',
  });
  await writeFlats(planFlat, {
    filter: 'SII', letter: 'S', ymd: '20260731', count: 2, startHms: '061000',
  });

  // Ha 20260731 @ 45s — flats present, no Bias, no matching master/session dark → Missing Bias + Dark
  await writeLights(planLight, {
    filter: 'Ha', letter: 'H', ymd: '20260731', count: 2, expSec: 45, startHms: '230000',
  });
  await writeFlats(planFlat, {
    filter: 'Ha', letter: 'H', ymd: '20260801', count: 2, startHms: '062000',
  });

  // Session darks only for 180s (won't match 45s Ha)
  await writeDarks(planDark, { ymd: '20260729', count: 2, expSec: EXP_LIGHT, startHms: '150000' });

  const readme = `# [TEST] Rosette Nebula — ingest fixture

Synthetic ASIAIR dump for error-handling and happy-path ingest tests.
Real target: Rosette Nebula / NGC 2237. FITS are header-only (no image data).

Ingest merges **Autorun + Plan** into one source (Type column shows which folder lights came from).
Status column: **match** / **already staged** / **in log** / red **no shot log** / red **missing flats|bias|darks**.

## Sessions (merged)

### Autorun — happy path + orphan
Night **20260728** Ha: Light + Flat + Bias + Dark (180s / gain 120 / −10°C).
→ Ingest Ha shoot \`260728\` → Stage should succeed (master darks also match).
Bias here is also reused for Plan nights.

Also on **20260728**: orphan **OIII** lights (no OIII shoot that night) → Status **no shot log** (red).

### Plan — mixed
| Night   | Filter | What's wrong / special                 | Expect |
|---------|--------|----------------------------------------|--------|
| 260729  | OIII   | Shoot in log; lights; **no flats**     | Status **missing flats** (red); Stage blocked |
| 260730  | SII    | Lights+flats; Bias shared from Autorun | Stage succeeds |
| 260731  | Ha 45s | Has flats; no dark match at 45s        | Status **missing darks**; Stage blocked |

Uncheck "Use matching master darks" on 260731 to also exercise session-dark failure
(Plan only has 180s darks).

## Rebuild

\`\`\`
node scripts/build-ingest-test-fixture.js
\`\`\`
`;
  await fsp.writeFile(path.join(FIXTURE, 'README.md'), readme);
  console.log('Wrote fixture', FIXTURE);
}

function testProject(projectDir) {
  return {
    name: '[TEST] Rosette Nebula — Ingest QA',
    target: 'Rosette Nebula (NGC 2237 / NGC 2238 / NGC 2244) — synthetic ASIAIR dump for ingest testing',
    frameMode: 'Reducer, 280mm f/3.9 — TEST project (synthetic FITS, not real data)',
    projectDir,
    centerCoords: 'RA 6h31m55s  Dec +4°56\'34"',
    anchorStar: 'HD 46150 (mag ~6.8) — open cluster NGC 2244 core',
    rotation: '0° (test)',
    status: 'active',
    notes:
      'TEST PROJECT — real target (Rosette), synthetic FITS under staging/asiair-test-rosette. ' +
      'Autorun+Plan merged. Ha 260728 = happy path (+ orphan OIII lights → no shot log). ' +
      'OIII 260729 = missing flats (blocked). SII 260730 = Stage OK. Ha 260731 @45s = missing darks. ' +
      'See staging/asiair-test-rosette/README.md. Rebuild: node scripts/build-ingest-test-fixture.js',
    filterTargets: [
      { filter: 'Ha', location: 'Home', bortle: '9', targetHrs: 0.5, loggedHrs: 0.175 },
      { filter: 'OIII', location: 'Home', bortle: '9', targetHrs: 0.5, loggedHrs: 0.1 },
      { filter: 'SII', location: 'Home', bortle: '9', targetHrs: 0.5, loggedHrs: 0.1 },
    ],
    checklist: [
      { id: 'test-rosette-happy', text: 'TEST: Ha 260728 → Stage OK; orphan OIII row = no shot log (red)', done: false },
      { id: 'test-rosette-noflat', text: 'TEST: OIII 260729 → missing flats (red row), Stage blocked', done: false },
      { id: 'test-rosette-cross', text: 'TEST: SII 260730 → Stage succeeds (Bias from Autorun)', done: false },
      { id: 'test-rosette-nodark', text: 'TEST: Ha 260731 @45s → missing darks, Stage blocked', done: false },
    ],
    shoots: [
      {
        date: '260728',
        filterIndex: 0,
        hours: 0.15,
        complete: true,
        creditedHours: 0.15,
        sourcePath: null,
        ingestPath: null,
        ingestMeta: null,
      },
      {
        date: '260729',
        filterIndex: 1,
        hours: 0.1,
        complete: true,
        creditedHours: 0.1,
        sourcePath: null,
        ingestPath: null,
        ingestMeta: null,
      },
      {
        date: '260730',
        filterIndex: 2,
        hours: 0.1,
        complete: true,
        creditedHours: 0.1,
        sourcePath: null,
        ingestPath: null,
        ingestMeta: null,
      },
      {
        date: '260731',
        filterIndex: 0,
        hours: 0.025,
        complete: true,
        creditedHours: 0.025,
        sourcePath: null,
        ingestPath: null,
        ingestMeta: null,
      },
    ],
    astrobinLinks: [],
    savedTarget: {
      name: 'Rosette Nebula (NGC 2237)',
      ra: 97.9791667,
      dec: 4.9427778,
    },
    framerMode: 'reducer',
    framerRotation: 0,
    processStatus: 'planning',
  };
}

async function upsertProject() {
  const raw = await fsp.readFile(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  const projectDir = FIXTURE;
  const next = testProject(projectDir);
  const idx = (data.projects || []).findIndex((p) =>
    String(p.name || '').startsWith('[TEST] Rosette'));
  if (idx >= 0) {
    data.projects[idx] = next;
    console.log('Updated project at index', idx);
  } else {
    data.projects.push(next);
    console.log('Added project at index', data.projects.length - 1);
  }
  if (!data.appMeta) data.appMeta = {};
  data.appMeta.build = Math.max(Number(data.appMeta.build) || 0, 6);
  data.appMeta.savedAt = new Date().toISOString();
  const json = JSON.stringify(data, null, 2) + '\n';
  await fsp.writeFile(DATA_PATH, json);
  console.log('Wrote', DATA_PATH);
  // Do not mirror into H: Beta — Dev QA must never overwrite the live Beta dashboard.
}

async function main() {
  await buildFixture();
  const upsert = process.argv.includes('--upsert');
  if (upsert) {
    await upsertProject();
    console.log('\nDone. Quit/reload Electron, open [TEST] Rosette Nebula — Ingest QA.');
  } else {
    console.log('\nFixture FITS ready (dashboard not modified). Pass --upsert to add [TEST] project.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
