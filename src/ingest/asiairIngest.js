/**
 * ASIAIR Ingest Tool
 *
 * Discover Autorun/Plan sessions under a project directory, read FITS headers
 * (filename fallback), match master-library darks, and stage a Siril tree:
 *
 *   <projectDir>/<Filter>/<ShootName>/{lights,flats,biases,darks}/
 *
 * Source ASIAIR folders are never modified.
 * - Lights/flats: copied directly into the Siril tree.
 * - Biases: copied into _calibration/darkflats/<night>/, then per-file
 *   symlinked into each channel's biases/.
 * - Darks: copied into _calibration/darks/<night>/, then per-file
 *   symlinked into each channel's darks/ (filter ignored; match exp/gain/temp).
 * ShootName comes from the shoot log code (e.g. 260725_SII_B9_NYCRoof).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const FRAME_TYPES = new Set(['light', 'flat', 'dark', 'bias', 'darkflat']);
const TYPE_FOLDERS = {
  light: 'lights',
  flat: 'flats',
  dark: 'darks',
  bias: 'biases',
  darkflat: 'biases', // ASIAIR "Bias" = dark flats → Siril biases/
};
const SESSION_DIR_NAMES = new Set(['autorun', 'plan']);
const FRAME_DIR_MAP = {
  light: 'light',
  lights: 'light',
  flat: 'flat',
  flats: 'flat',
  dark: 'dark',
  darks: 'dark',
  bias: 'bias',
  biases: 'bias',
  darkflat: 'bias',
  darkflats: 'bias',
};
const SKIP_DIR_NAMES = new Set(['live', 'preview', 'video', 'log', 'thumbnail', 'thumbnails']);
const FIT_EXT = /\.(fit|fits|fts)$/i;
const HEADER_KEYS = [
  'OBJECT', 'FILTER', 'EXPTIME', 'EXPOSURE', 'GAIN', 'EGAIN',
  'CCD-TEMP', 'SET-TEMP', 'XBINNING', 'DATE-OBS', 'IMAGETYP', 'FRAME',
  'RA', 'DEC', 'OBJCTRA', 'OBJCTDEC',
  'ROTATOR', 'CROTA2', 'CROTA1', 'POSANGLE',
];
const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 183;
const TEMP_TOLERANCE_C = 3;
/** Median angular separation (deg) at or below this → auto-include ASIAIR Light folder. */
const TARGET_MATCH_AUTO_DEG = 0.75;
/** Above auto and at or below this → pre-ingest confirm; farther → other target. */
const TARGET_MATCH_CONFIRM_DEG = 2.5;

function sanitizeFolderName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .trim() || 'unknown';
}

function normalizeFilter(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const map = {
    h: 'Ha', ha: 'Ha', halpha: 'Ha', 'h-alpha': 'Ha',
    o: 'OIII', o3: 'OIII', oiii: 'OIII',
    s: 'SII', s2: 'SII', sii: 'SII',
    hb: 'Hb', hbeta: 'Hb', 'h-beta': 'Hb',
    l: 'L', lum: 'L', luminance: 'L',
    r: 'R', red: 'R',
    g: 'G', green: 'G',
    b: 'B', blue: 'B',
  };
  const key = s.toLowerCase().replace(/\s+/g, '');
  return map[key] || s;
}

function parseExposureToSeconds(token) {
  if (!token) return null;
  const m = String(token).trim().match(/^([\d.]+)\s*(ms|s)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || 's').toLowerCase();
  return unit === 'ms' ? n / 1000 : n;
}

function normalizeNight(dateStr) {
  if (!dateStr) return null;
  const d = String(dateStr).replace(/[^0-9]/g, '');
  if (d.length === 8) return d;
  if (d.length === 6) {
    const yy = parseInt(d.slice(0, 2), 10);
    const century = yy >= 70 ? 1900 : 2000;
    return String(century + yy) + d.slice(2);
  }
  return null;
}

function ymdToDate(ymd) {
  const n = normalizeNight(ymd);
  if (!n) return null;
  return new Date(Date.UTC(
    parseInt(n.slice(0, 4), 10),
    parseInt(n.slice(4, 6), 10) - 1,
    parseInt(n.slice(6, 8), 10)
  ));
}

function dateToYmd(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function addDaysYmd(ymd, days) {
  const d = ymdToDate(ymd);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return dateToYmd(d);
}

/** Astronomical night label D includes calendar D and morning of D+1. */
function nightWindowYmds(nightYmd) {
  const n = normalizeNight(nightYmd);
  if (!n) return [];
  const next = addDaysYmd(n, 1);
  return next ? [n, next] : [n];
}

/**
 * Map a frame's DATE-OBS / filename stamp onto an evening night label.
 * Morning hours 00:00–11:59 → previous calendar evening.
 */
function astronomicalNightForFrame(dateYmd, timeHms) {
  const d = normalizeNight(dateYmd);
  if (!d) return null;
  let hour = null;
  if (timeHms != null) {
    const t = String(timeHms).replace(/[^0-9]/g, '');
    if (t.length >= 2) hour = parseInt(t.slice(0, 2), 10);
  }
  if (hour != null && hour < 12) return addDaysYmd(d, -1) || d;
  return d;
}

function parseDateObs(raw) {
  if (raw == null) return { date: null, time: null };
  const s = String(raw).trim();
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return { date: null, time: null };
  return {
    date: `${m[1]}${m[2]}${m[3]}`,
    time: m[4] != null ? `${m[4]}${m[5]}${m[6]}` : null,
  };
}

function parseAsiairFilename(fileName) {
  const base = path.basename(String(fileName || ''));
  const bare = base.replace(FIT_EXT, '');
  const empty = {
    fileName: base,
    type: null,
    target: null,
    exposureSec: null,
    bin: null,
    filter: null,
    gain: null,
    date: null,
    time: null,
    tempC: null,
    sequence: null,
    matched: false,
  };

  const re = /^(Light|Flat|Dark|Bias|DarkFlat|Dark-Flat|darkflat)_(.+)$/i;
  const typeMatch = bare.match(re);
  if (!typeMatch) return empty;

  let typeRaw = typeMatch[1].toLowerCase().replace(/-/g, '');
  if (typeRaw === 'darkflat') typeRaw = 'darkflat';
  /** ASIAIR Bias_* files are dark flats for this rig */
  if (typeRaw === 'bias') typeRaw = 'darkflat';
  let type = FRAME_TYPES.has(typeRaw) ? typeRaw : null;

  const rest = typeMatch[2];
  const parts = rest.split('_');
  let target = null;
  let idx = 0;
  const isExp = (p) => /^[\d.]+(ms|s)$/i.test(p);
  if (parts.length && !isExp(parts[0])) {
    const targetParts = [];
    while (idx < parts.length && !isExp(parts[idx]) && !/^Bin\d+/i.test(parts[idx])) {
      targetParts.push(parts[idx]);
      idx += 1;
    }
    if (targetParts.length) target = targetParts.join('_');
  }

  let exposureSec = null;
  if (idx < parts.length && isExp(parts[idx])) {
    exposureSec = parseExposureToSeconds(parts[idx]);
    idx += 1;
  }

  let bin = null;
  if (idx < parts.length && /^Bin(\d+)/i.test(parts[idx])) {
    bin = parseInt(parts[idx].replace(/^Bin/i, ''), 10);
    idx += 1;
  }

  let filter = null;
  if (idx < parts.length && !/^gain/i.test(parts[idx]) && !/^\d{8}-/.test(parts[idx])) {
    filter = normalizeFilter(parts[idx]);
    idx += 1;
  }

  let gain = null;
  if (idx < parts.length && /^gain([\d.]+)$/i.test(parts[idx])) {
    gain = parseFloat(parts[idx].replace(/^gain/i, ''));
    idx += 1;
  }

  let date = null;
  let time = null;
  if (idx < parts.length && /^\d{8}-\d{6}/.test(parts[idx])) {
    const [d, t] = parts[idx].split('-');
    date = d;
    time = t ? t.slice(0, 6) : null;
    idx += 1;
  }

  let tempC = null;
  if (idx < parts.length && /^-?[\d.]+C$/i.test(parts[idx])) {
    tempC = parseFloat(parts[idx].replace(/c$/i, ''));
    idx += 1;
  }

  let sequence = null;
  if (idx < parts.length && /^\d+$/.test(parts[idx])) {
    sequence = parseInt(parts[idx], 10);
  }

  const matched = !!(type && (exposureSec != null || date || filter));
  return {
    fileName: base,
    type,
    target,
    exposureSec,
    bin,
    filter,
    gain,
    date,
    time,
    tempC,
    sequence,
    matched,
  };
}

async function readFitsHeaderKeywords(filePath, keys = HEADER_KEYS) {
  const want = new Set(keys.map((k) => k.toUpperCase()));
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(2880 * 6);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf.slice(0, bytesRead).toString('binary');
    const out = {};
    for (let i = 0; i + 80 <= text.length; i += 80) {
      const card = text.slice(i, i + 80);
      const key = card.slice(0, 8).trim().toUpperCase();
      if (key === 'END') break;
      if (!want.has(key)) continue;
      if (card[8] !== '=') continue;
      let raw = card.slice(9, 80).trim();
      if (raw.startsWith("'")) {
        const end = raw.indexOf("'", 1);
        raw = end >= 0 ? raw.slice(1, end).trim() : raw.slice(1).trim();
        out[key] = raw;
      } else {
        const numPart = raw.split('/')[0].trim();
        const n = Number(numPart);
        out[key] = Number.isFinite(n) ? n : numPart;
      }
    }
    return out;
  } finally {
    await fh.close();
  }
}

/** Header values win over filename when present. */
function mergeHeaderIntoParsed(parsed, header) {
  if (!header) return parsed;
  const next = { ...parsed, header };

  if (header.FILTER != null && String(header.FILTER).trim() !== '') {
    next.filter = normalizeFilter(String(header.FILTER));
  }
  if (header.OBJECT != null && String(header.OBJECT).trim() !== '') {
    next.target = String(header.OBJECT).trim();
  }
  const ra = parseFitsAngleDegrees(header.RA != null ? header.RA : header.OBJCTRA);
  const dec = parseFitsAngleDegrees(header.DEC != null ? header.DEC : header.OBJCTDEC, true);
  if (ra != null) next.ra = ra;
  if (dec != null) next.dec = dec;
  const rotRaw = header.ROTATOR != null ? header.ROTATOR
    : (header.CROTA2 != null ? header.CROTA2
      : (header.POSANGLE != null ? header.POSANGLE : header.CROTA1));
  if (rotRaw != null && rotRaw !== '') {
    const rot = Number(rotRaw);
    if (Number.isFinite(rot)) next.rotatorDeg = rot;
  }
  if (header.EXPTIME != null || header.EXPOSURE != null) {
    next.exposureSec = Number(header.EXPTIME != null ? header.EXPTIME : header.EXPOSURE);
  }
  if (header.GAIN != null) next.gain = Number(header.GAIN);
  else if (header.EGAIN != null && next.gain == null) next.gain = Number(header.EGAIN);
  if (header['CCD-TEMP'] != null) next.tempC = Number(header['CCD-TEMP']);
  else if (header['SET-TEMP'] != null) next.tempC = Number(header['SET-TEMP']);
  if (header.XBINNING != null) next.bin = Number(header.XBINNING);

  if (header['DATE-OBS']) {
    const { date, time } = parseDateObs(header['DATE-OBS']);
    if (date) next.date = date;
    if (time) next.time = time;
  }

  const imagetyp = header.IMAGETYP || header.FRAME;
  if (imagetyp) {
    const t = String(imagetyp).toLowerCase();
    if (t.includes('light')) next.type = 'light';
    else if (t.includes('dark flat') || t.includes('darkflat') || t.includes('flat dark')) next.type = 'darkflat';
    else if (t.includes('flat')) next.type = 'flat';
    else if (t.includes('dark')) next.type = 'dark';
    else if (t.includes('bias') || t.includes('offset')) next.type = 'darkflat'; // treat bias as dark flat for this rig
  }

  next.night = astronomicalNightForFrame(next.date, next.time);
  next.matched = !!(next.type && (next.exposureSec != null || next.date || next.filter));
  return next;
}

function extractCatalogIds(text) {
  const s = String(text || '');
  const ids = [];
  const re = /\b(NGC|IC|M)\s*([0-9]+)\b/gi;
  let m;
  while ((m = re.exec(s))) {
    ids.push((m[1] + m[2]).toLowerCase());
  }
  return ids;
}

/** Parse FITS RA/Dec card value: decimal degrees or sexagesimal string. */
function parseFitsAngleDegrees(raw, isDec = false) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim().replace(/^'|'$/g, '');
  if (!s) return null;
  const asNum = Number(s);
  if (Number.isFinite(asNum) && !/[:hms]/i.test(s)) return asNum;
  // Sexagesimal: HH:MM:SS / DD:MM:SS or HHhMMmSSs
  const norm = s.replace(/[hHdD]/g, ':').replace(/[mM]/g, ':').replace(/[sS]/g, '').trim();
  const parts = norm.split(/[:\s]+/).map((p) => parseFloat(p)).filter((n) => Number.isFinite(n));
  if (!parts.length) return null;
  const sign = String(raw).trim().startsWith('-') || parts[0] < 0 ? -1 : 1;
  const a = Math.abs(parts[0]) || 0;
  const b = Math.abs(parts[1]) || 0;
  const c = Math.abs(parts[2]) || 0;
  let deg = a + b / 60 + c / 3600;
  if (!isDec) deg *= 15; // RA hours → degrees when sexagesimal
  return sign * deg;
}

/** Great-circle separation in degrees. */
function angularSeparationDeg(ra1, dec1, ra2, dec2) {
  if (![ra1, dec1, ra2, dec2].every((n) => n != null && Number.isFinite(Number(n)))) return null;
  const toRad = Math.PI / 180;
  const r1 = Number(ra1) * toRad;
  const d1 = Number(dec1) * toRad;
  const r2 = Number(ra2) * toRad;
  const d2 = Number(dec2) * toRad;
  const sin = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(r1 - r2);
  const clamped = Math.max(-1, Math.min(1, sin));
  return Math.acos(clamped) / toRad;
}

function median(nums) {
  const a = (nums || []).filter((n) => n != null && Number.isFinite(Number(n))).map(Number).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * Group lights by Light/<folder>, score vs optional reference coords.
 * band: auto | confirm | other | no_coords
 */
function buildTargetFolders(lights, refCoords = null) {
  const byFolder = new Map();
  for (const L of lights || []) {
    const folder = L.targetFolder || L.target || 'Unknown';
    let row = byFolder.get(folder);
    if (!row) {
      row = { folder, name: L.target || folder, lights: [], ras: [], decs: [], rots: [] };
      byFolder.set(folder, row);
    }
    row.lights.push(L);
    if (L.ra != null && Number.isFinite(Number(L.ra))) row.ras.push(Number(L.ra));
    if (L.dec != null && Number.isFinite(Number(L.dec))) row.decs.push(Number(L.dec));
    if (L.rotatorDeg != null && Number.isFinite(Number(L.rotatorDeg))) row.rots.push(Number(L.rotatorDeg));
    if (L.target && (!row.name || row.name === folder)) row.name = L.target;
  }

  const refRa = refCoords && refCoords.ra;
  const refDec = refCoords && refCoords.dec;
  const hasRef = refRa != null && refDec != null
    && Number.isFinite(Number(refRa)) && Number.isFinite(Number(refDec));

  return [...byFolder.values()].map((row) => {
    const medianRa = median(row.ras);
    const medianDec = median(row.decs);
    const medianRotatorDeg = median(row.rots);
    let separationDeg = null;
    let band = 'no_coords';
    if (medianRa != null && medianDec != null && hasRef) {
      separationDeg = angularSeparationDeg(medianRa, medianDec, refRa, refDec);
      if (separationDeg == null) band = 'no_coords';
      else if (separationDeg <= TARGET_MATCH_AUTO_DEG) band = 'auto';
      else if (separationDeg <= TARGET_MATCH_CONFIRM_DEG) band = 'confirm';
      else band = 'other';
    } else if (!hasRef) {
      band = 'no_coords';
    }
    return {
      folder: row.folder,
      name: row.name,
      lightCount: row.lights.length,
      medianRa,
      medianDec,
      medianRotatorDeg,
      separationDeg,
      band,
    };
  }).sort((a, b) => (a.separationDeg ?? 999) - (b.separationDeg ?? 999));
}

/** Classify whether pre-ingest confirm is required for these target folders. */
function targetMatchNeedsConfirm(targets, opts = {}) {
  const list = targets || [];
  if (!list.length) return { needsConfirm: false, reason: 'no_light_folders' };
  const hasRef = !!(opts.refCoords && opts.refCoords.ra != null && opts.refCoords.dec != null);
  const autos = list.filter((t) => t.band === 'auto');

  if (!hasRef && list.length > 1) {
    return { needsConfirm: true, reason: 'no_saved_target_multi_folder' };
  }

  // One confident auto match → use it; uncertain/far/no-coords siblings stay excluded
  // without a popup (same policy as silent `other` exclusion).
  if (autos.length === 1) {
    return { needsConfirm: false, reason: 'confident' };
  }
  if (autos.length > 1) {
    return { needsConfirm: true, reason: 'multiple_auto' };
  }

  // No auto match — user must pick among uncertain / far / no-coords folders.
  if (list.some((t) => t.band === 'confirm')) {
    return { needsConfirm: true, reason: 'uncertain_band' };
  }
  if (list.some((t) => t.band === 'no_coords') && list.length > 1) {
    return { needsConfirm: true, reason: 'no_coords_multi' };
  }
  if (list.some((t) => t.band === 'other')) {
    return { needsConfirm: true, reason: 'only_other_targets' };
  }
  // Single Light folder with no coords / no savedTarget → assume and warn in UI.
  if (list.length === 1 && (!hasRef || list[0].band === 'no_coords')) {
    return { needsConfirm: false, reason: 'assumed_single' };
  }
  return { needsConfirm: false, reason: 'confident' };
}

/** Loose target match: substring, or shared NGC/IC/M catalog id.
 *  If the hint has no catalog id and no substring hit, keep the frame
 *  (don't drop lights just because project says "Veil" and folder says "NGC 6960"). */
function targetMatchesHint(frameTarget, hint) {
  if (!hint) return true;
  if (!frameTarget) return true;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const ft = norm(frameTarget);
  const ht = norm(hint);
  if (ft && ht && (ft.includes(ht) || ht.includes(ft))) return true;
  const hintIds = extractCatalogIds(hint);
  const frameIds = extractCatalogIds(frameTarget);
  if (hintIds.length && frameIds.some((id) => hintIds.includes(id))) return true;
  if (hintIds.length && hintIds.some((id) => ft.includes(id))) return true;
  // Strict only when hint names a catalog object
  if (hintIds.length) return false;
  return true;
}

async function walkFitFiles(rootDir) {
  const results = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name.toLowerCase())) continue;
        await walk(full);
      } else if (ent.isFile() && FIT_EXT.test(ent.name)) {
        results.push(full);
      }
    }
  }
  const stat = await fsp.stat(rootDir);
  if (stat.isFile()) {
    if (FIT_EXT.test(rootDir)) results.push(rootDir);
  } else {
    await walk(rootDir);
  }
  return results;
}

async function parseFitFile(filePath, folderHintType) {
  let parsed = {
    ...parseAsiairFilename(path.basename(filePath)),
    filePath,
    header: null,
    night: null,
  };
  if (folderHintType && !parsed.type) {
    parsed.type = folderHintType === 'bias' ? 'darkflat' : folderHintType;
  }
  if (folderHintType === 'bias') parsed.type = 'darkflat';
  try {
    const header = await readFitsHeaderKeywords(filePath);
    parsed = mergeHeaderIntoParsed(parsed, header);
  } catch {
    parsed.night = astronomicalNightForFrame(parsed.date, parsed.time);
    parsed.matched = !!(parsed.type && (parsed.exposureSec != null || parsed.date || parsed.filter));
  }
  if (!parsed.night) parsed.night = astronomicalNightForFrame(parsed.date, parsed.time);
  return parsed;
}

async function findFrameDirs(sessionPath) {
  const out = { light: null, flat: null, bias: null, dark: null };
  let entries;
  try {
    entries = await fsp.readdir(sessionPath, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const key = FRAME_DIR_MAP[ent.name.toLowerCase()];
    if (key && !out[key]) out[key] = path.join(sessionPath, ent.name);
  }
  return out;
}

/**
 * Push a session entry if it has Light/Flat/Bias frame dirs.
 */
async function pushSessionIfValid(sessions, sessionPath, name, extra = {}) {
  const frameDirs = await findFrameDirs(sessionPath);
  if (!frameDirs.light && !frameDirs.flat && !frameDirs.bias) return;
  const already = sessions.some((s) => path.resolve(s.path) === path.resolve(sessionPath));
  if (already) return;
  sessions.push({
    name,
    path: sessionPath,
    kind: String(name).toLowerCase(),
    hasLight: !!frameDirs.light,
    hasFlat: !!frameDirs.flat,
    hasBias: !!frameDirs.bias,
    hasDark: !!frameDirs.dark,
    ...extra,
  });
}

/** YYMMDD + YYYYMMDD folder name candidates for a night label. */
function asiairNightFolderCandidates(nightYmd) {
  const n = normalizeNight(nightYmd);
  if (!n) return [];
  const out = [n.slice(2), n];
  return [...new Set(out)];
}

/**
 * Discover Autorun/Plan under projectDir (compat) and asiair/<night>/Autorun|Plan.
 */
async function discoverSessions(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) {
    return { ok: false, error: 'Project directory not found', sessions: [] };
  }
  const sessions = [];
  const dirs = await fsp.readdir(projectDir, { withFileTypes: true });
  for (const ent of dirs) {
    if (!ent.isDirectory()) continue;
    if (!SESSION_DIR_NAMES.has(ent.name.toLowerCase())) continue;
    await pushSessionIfValid(sessions, path.join(projectDir, ent.name), ent.name, {
      dumpNight: null,
      dumpPath: null,
    });
  }

  // asiair/<any>/Autorun|Plan — one dump per night
  const asiairRoot = path.join(projectDir, 'asiair');
  if (fs.existsSync(asiairRoot)) {
    let nightFolders = [];
    try {
      nightFolders = await fsp.readdir(asiairRoot, { withFileTypes: true });
    } catch {
      nightFolders = [];
    }
    for (const nightEnt of nightFolders) {
      if (!nightEnt.isDirectory()) continue;
      const dumpPath = path.join(asiairRoot, nightEnt.name);
      const dumpNight = normalizeNight(nightEnt.name);
      let sessionEnts = [];
      try {
        sessionEnts = await fsp.readdir(dumpPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of sessionEnts) {
        if (!ent.isDirectory()) continue;
        if (!SESSION_DIR_NAMES.has(ent.name.toLowerCase())) continue;
        await pushSessionIfValid(sessions, path.join(dumpPath, ent.name), ent.name, {
          dumpNight: dumpNight || nightEnt.name,
          dumpPath,
          dumpFolder: nightEnt.name,
        });
      }
      // Dump itself may be a session (Light/Flat/Bias as direct children)
      await pushSessionIfValid(sessions, dumpPath, nightEnt.name, {
        kind: 'session',
        dumpNight: dumpNight || nightEnt.name,
        dumpPath,
        dumpFolder: nightEnt.name,
      });
    }
  }

  // Project dir itself may be a session (has Light/Flat/Bias)
  const selfDirs = await findFrameDirs(projectDir);
  if (selfDirs.light || selfDirs.flat || selfDirs.bias) {
    const already = sessions.some((s) => path.resolve(s.path) === path.resolve(projectDir));
    if (!already) {
      sessions.unshift({
        name: path.basename(projectDir),
        path: projectDir,
        kind: 'session',
        hasLight: !!selfDirs.light,
        hasFlat: !!selfDirs.flat,
        hasBias: !!selfDirs.bias,
        hasDark: !!selfDirs.dark,
        dumpNight: null,
        dumpPath: null,
      });
    }
  }

  return { ok: true, projectDir, sessions };
}

function summarizeFrames(frames) {
  const byType = {};
  const filters = new Set();
  const nights = new Set();
  const targets = new Set();
  let exposureSec = null;
  let gain = null;
  let tempC = null;
  let bin = null;

  for (const f of frames) {
    const t = f.type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
    if (f.filter) filters.add(f.filter);
    if (f.night) nights.add(f.night);
    else if (f.date) nights.add(f.date);
    if (f.target) targets.add(f.target);
    if (f.type === 'light') {
      if (exposureSec == null && f.exposureSec != null) exposureSec = f.exposureSec;
      if (gain == null && f.gain != null) gain = f.gain;
      if (tempC == null && f.tempC != null) tempC = f.tempC;
      if (bin == null && f.bin != null) bin = f.bin;
    }
  }

  return {
    byType,
    filters: [...filters],
    nights: [...nights].sort(),
    targets: [...targets],
    lightCount: byType.light || 0,
    exposureSec,
    gain,
    tempC,
    bin,
  };
}

function frameInNightWindow(frame, nightYmd) {
  const window = new Set(nightWindowYmds(nightYmd));
  if (!window.size) return true;
  const n = frame.night || astronomicalNightForFrame(frame.date, frame.time);
  if (!n) return false;
  return window.has(n) || window.has(normalizeNight(frame.date));
}

function shootingTypeLabel(session) {
  const k = String((session && (session.kind || session.name)) || '').toLowerCase();
  if (k === 'autorun') return 'Autorun';
  if (k === 'plan') return 'Plan';
  return (session && session.name) || 'Session';
}

/**
 * Scan one session folder; tags each frame with shootingType + sessionPath.
 */
async function scanSingleSession(session, opts = {}) {
  const sessionPath = session.path;
  const nightDate = normalizeNight(opts.nightDate);
  const targetHint = opts.skipTargetHint ? null : (opts.targetHint ? String(opts.targetHint).trim().toLowerCase() : null);
  const shootingType = shootingTypeLabel(session);
  const includeSet = opts.includeTargets && opts.includeTargets.length
    ? new Set(opts.includeTargets.map(String))
    : null;

  const frameDirs = await findFrameDirs(sessionPath);
  const lights = [];
  const flats = [];
  const biases = [];
  const darks = [];

  const tag = (parsed) => {
    parsed.shootingType = shootingType;
    parsed.sessionPath = sessionPath;
    return parsed;
  };

  if (frameDirs.light) {
    const files = await walkFitFiles(frameDirs.light);
    for (const fp of files) {
      const parsed = await parseFitFile(fp, 'light');
      // Light/<Target>/… → targetFolder
      const rel = path.relative(frameDirs.light, path.dirname(fp));
      if (rel && rel !== '.' && !rel.startsWith('..')) {
        const top = rel.split(path.sep)[0];
        if (top) {
          parsed.targetFolder = top;
          if (!parsed.target) parsed.target = top;
        }
      }
      if (!parsed.targetFolder) parsed.targetFolder = parsed.target || 'Unknown';
      if (includeSet && !includeSet.has(parsed.targetFolder) && !includeSet.has(parsed.target)) continue;
      if (nightDate && !frameInNightWindow(parsed, nightDate)) continue;
      if (targetHint && !targetMatchesHint(parsed.target, targetHint)) continue;
      lights.push(tag(parsed));
    }
  }

  if (frameDirs.flat) {
    for (const fp of await walkFitFiles(frameDirs.flat)) {
      const parsed = await parseFitFile(fp, 'flat');
      if (nightDate && !frameInNightWindow(parsed, nightDate)) continue;
      flats.push(tag(parsed));
    }
  }

  if (frameDirs.bias) {
    for (const fp of await walkFitFiles(frameDirs.bias)) {
      const parsed = await parseFitFile(fp, 'bias');
      parsed.type = 'darkflat';
      // Dark flats / biases are reusable calibration — do not gate on shoot night
      biases.push(tag(parsed));
    }
  }

  if (frameDirs.dark) {
    for (const fp of await walkFitFiles(frameDirs.dark)) {
      const parsed = await parseFitFile(fp, 'dark');
      // Session darks are reusable calibration — do not gate on shoot night.
      darks.push(tag(parsed));
    }
  }

  return { lights, flats, biases, darks, shootingType, sessionPath };
}

/**
 * Scan ASIAIR dump(s) for a given astronomical night.
 * Prefers projectDir (merges Autorun + Plan into one source).
 * sessionPath / sessionPaths still supported for single-folder use.
 */
async function scanSession(opts = {}) {
  const nightDate = normalizeNight(opts.nightDate);
  const targetHint = opts.targetHint || null;
  const shootFilter = opts.shootFilter ? normalizeFilter(opts.shootFilter) : null;
  const skipTargetHint = opts.skipTargetHint === true || !!opts.targetCoords || !!(opts.includeTargets && opts.includeTargets.length);
  const includeTargets = opts.includeTargets && opts.includeTargets.length
    ? opts.includeTargets.map(String)
    : null;
  const targetCoords = opts.targetCoords || null;

  let sessions = [];
  let projectDir = opts.projectDir || null;

  if (projectDir) {
    const disc = await discoverSessions(projectDir);
    if (!disc.ok) return disc;
    sessions = disc.sessions || [];

    // Prefer asiair/<shoot.date>/ dump when present (isolate nights + calib).
    if (nightDate && sessions.length) {
      const candidates = asiairNightFolderCandidates(nightDate);
      const preferred = sessions.filter((s) => {
        if (!s.dumpPath && !s.dumpFolder) return false;
        const folder = s.dumpFolder || path.basename(s.dumpPath || '');
        const dumpN = normalizeNight(s.dumpNight || folder);
        return candidates.includes(folder)
          || (dumpN && candidates.includes(dumpN))
          || (dumpN && candidates.includes(dumpN.slice(2)));
      });
      if (preferred.length) {
        sessions = preferred;
      }
    }

    if (!sessions.length) {
      return { ok: false, error: 'No Autorun/Plan folders found under project directory', sessions: [], projectDir };
    }
  } else if (opts.sessionPaths && opts.sessionPaths.length) {
    sessions = opts.sessionPaths.map((p) => ({
      path: p,
      name: path.basename(p),
      kind: path.basename(p).toLowerCase(),
    }));
  } else if (opts.sessionPath) {
    sessions = [{
      path: opts.sessionPath,
      name: path.basename(opts.sessionPath),
      kind: path.basename(opts.sessionPath).toLowerCase(),
    }];
  } else {
    return { ok: false, error: 'projectDir or sessionPath is required' };
  }

  const lights = [];
  const flats = [];
  const biases = [];
  const darks = [];
  const sessionSummaries = [];

  for (const session of sessions) {
    const part = await scanSingleSession(session, {
      nightDate,
      targetHint,
      skipTargetHint,
      includeTargets,
    });
    lights.push(...part.lights);
    flats.push(...part.flats);
    biases.push(...part.biases);
    darks.push(...part.darks);
    sessionSummaries.push({
      name: session.name,
      path: session.path,
      kind: session.kind,
      shootingType: part.shootingType,
      lights: part.lights.length,
      flats: part.flats.length,
      biases: part.biases.length,
      darks: part.darks.length,
    });
  }

  // Target folders scored on full night lights (before shootFilter / auto trim).
  const allTargets = buildTargetFolders(lights, targetCoords);
  const matchGate = targetMatchNeedsConfirm(allTargets, { refCoords: targetCoords });

  // includeTargets already applied in scanSingleSession when provided.
  // When coords are confident, record the auto folder as the default include set
  // but do NOT drop sibling lights from the scan payload — Review source / reject
  // actions / QA still need them. Staging applies includeTargets explicitly.
  let filteredLights = lights;
  let effectiveIncludes = includeTargets;
  if (!includeTargets && targetCoords && !matchGate.needsConfirm) {
    const autos = allTargets.filter((t) => t.band === 'auto').map((t) => t.folder);
    if (autos.length === 1) {
      effectiveIncludes = autos;
    }
  }

  if (shootFilter) {
    filteredLights = filteredLights.filter(
      (L) => (normalizeFilter(L.filter) || 'Unknown') === shootFilter
    );
  }

  const byFilter = {};
  for (const L of filteredLights) {
    const f = normalizeFilter(L.filter) || 'Unknown';
    if (!byFilter[f]) {
      byFilter[f] = {
        filter: f,
        lights: 0,
        flats: 0,
        exposureSec: null,
        gain: null,
        tempC: null,
        bin: null,
        shootingTypes: new Set(),
      };
    }
    byFilter[f].lights += 1;
    if (L.shootingType) byFilter[f].shootingTypes.add(L.shootingType);
    if (byFilter[f].exposureSec == null && L.exposureSec != null) byFilter[f].exposureSec = L.exposureSec;
    if (byFilter[f].gain == null && L.gain != null) byFilter[f].gain = L.gain;
    if (byFilter[f].tempC == null && L.tempC != null) byFilter[f].tempC = L.tempC;
    if (byFilter[f].bin == null && L.bin != null) byFilter[f].bin = L.bin;
  }
  for (const F of flats) {
    const f = normalizeFilter(F.filter) || 'Unknown';
    if (!byFilter[f]) {
      byFilter[f] = {
        filter: f,
        lights: 0,
        flats: 0,
        exposureSec: null,
        gain: null,
        tempC: null,
        bin: null,
        shootingTypes: new Set(),
      };
    }
    byFilter[f].flats = (byFilter[f].flats || 0) + 1;
    if (F.shootingType && !byFilter[f].lights) byFilter[f].shootingTypes.add(F.shootingType);
  }

  const filterRows = Object.values(byFilter).map((row) => {
    const types = [...(row.shootingTypes || [])].sort();
    return {
      filter: row.filter,
      lights: row.lights,
      flats: row.flats || 0,
      exposureSec: row.exposureSec,
      gain: row.gain,
      tempC: row.tempC,
      bin: row.bin,
      shootingTypes: types,
      shootingType: types.length ? types.join(' · ') : '—',
      matchesShoot: shootFilter ? normalizeFilter(row.filter) === shootFilter : null,
    };
  });

  const shootingTypes = [...new Set(sessionSummaries.map((s) => s.shootingType))];
  const targetNames = [...new Set(filteredLights.map((l) => l.target).filter(Boolean))];

  return {
    ok: true,
    projectDir: projectDir || null,
    sessionPath: sessions.length === 1 ? sessions[0].path : (projectDir || sessions[0].path),
    sessionPaths: sessions.map((s) => s.path),
    sessions: sessionSummaries,
    shootingTypes,
    nightDate,
    status: {
      light: filteredLights.length,
      flat: flats.length,
      bias: biases.length,
      dark: darks.length,
      hasLight: filteredLights.length > 0,
      hasFlat: flats.length > 0,
      hasBias: biases.length > 0,
      hasDark: darks.length > 0,
    },
    filters: filterRows,
    targets: allTargets,
    targetNames,
    targetMatch: matchGate,
    includeTargets: effectiveIncludes,
    lights: filteredLights,
    flats,
    biases,
    darks,
    summary: summarizeFrames([...filteredLights, ...flats, ...biases, ...darks]),
  };
}

/**
 * Index a master dark library folder (header-first metadata).
 */
async function indexDarkLibrary(libraryPath) {
  if (!libraryPath || !fs.existsSync(libraryPath)) {
    return { ok: false, error: 'Dark library path not found', frames: [], index: [] };
  }
  const files = await walkFitFiles(libraryPath);
  const index = [];
  for (const fp of files) {
    const parsed = await parseFitFile(fp, 'dark');
    parsed.type = 'dark';
    const acquiredAt = parsed.date
      ? `${parsed.date.slice(0, 4)}-${parsed.date.slice(4, 6)}-${parsed.date.slice(6, 8)}`
      : null;
    const acquiredMs = acquiredAt ? Date.parse(acquiredAt + 'T12:00:00Z') : null;
    const ageMs = acquiredMs != null ? Date.now() - acquiredMs : null;
    index.push({
      filePath: fp,
      fileName: parsed.fileName,
      exposureSec: parsed.exposureSec,
      gain: parsed.gain,
      tempC: parsed.tempC,
      bin: parsed.bin,
      date: parsed.date,
      acquiredAt,
      ageDays: ageMs != null ? Math.round(ageMs / 86400000) : null,
      expired: ageMs != null ? ageMs > SIX_MONTHS_MS : false,
    });
  }
  return { ok: true, libraryPath, count: index.length, index };
}

function nearlyEqual(a, b, eps = 1e-3) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= eps;
}

/**
 * Match master darks by exposure + gain + temp only.
 * Filter is intentionally ignored — darks apply to every filter channel.
 */
function matchMasterDarks(opts = {}) {
  const index = opts.index || [];
  const exposureSec = opts.exposureSec;
  const gain = opts.gain;
  const tempC = opts.tempC;
  const asOf = opts.asOf ? Date.parse(opts.asOf) : Date.now();

  const matches = [];
  const rejected = [];
  for (const d of index) {
    const acquiredMs = d.acquiredAt
      ? Date.parse(d.acquiredAt + 'T12:00:00Z')
      : (d.date && String(d.date).length >= 8
        ? Date.parse(`${String(d.date).slice(0, 4)}-${String(d.date).slice(4, 6)}-${String(d.date).slice(6, 8)}T12:00:00Z`)
        : null);
    const ageMs = acquiredMs != null ? asOf - acquiredMs : null;
    const expired = ageMs != null ? ageMs > SIX_MONTHS_MS : !!d.expired;
    if (exposureSec != null && !nearlyEqual(d.exposureSec, exposureSec, 0.05)) {
      rejected.push({ ...d, reason: 'exposure mismatch' });
      continue;
    }
    if (gain != null && !nearlyEqual(d.gain, gain, 0.5)) {
      rejected.push({ ...d, reason: 'gain mismatch' });
      continue;
    }
    if (tempC != null && d.tempC != null && Math.abs(Number(d.tempC) - Number(tempC)) > TEMP_TOLERANCE_C) {
      rejected.push({ ...d, reason: 'temp out of ±3°C' });
      continue;
    }
    // Age is flagged for UI (yellow/red) but never excludes a match.
    matches.push({
      ...d,
      expired,
      ageDays: ageMs != null ? Math.round(ageMs / 86400000) : (d.ageDays != null ? d.ageDays : null),
    });
  }
  return { ok: true, matches, rejected, rejectedCount: rejected.length };
}

/** Prefer the dark *set* folder (e.g. Darks_180s_…), not filter letter children (H/O/S). */
function masterDarkSourceSetDir(filePath) {
  if (!filePath) return null;
  let dir = path.dirname(path.resolve(filePath));
  const leaf = path.basename(dir);
  if (/^(H|Ha|O|OIII|S|SII|Hb|Hbeta|L|R|G|B)$/i.test(leaf)) {
    dir = path.dirname(dir);
  }
  return dir;
}

async function ensureCopied(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) return { dest, action: 'skipped' };
  await fsp.copyFile(src, dest);
  return { dest, action: 'copied' };
}

/** Prefer file symlink; fall back to hardlink, then copy. Uses absolute targets across drives. */
async function ensureLink(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) return { dest, action: 'skipped' };

  const absSrc = path.resolve(src);
  const absDest = path.resolve(dest);
  const sameRoot = path.parse(absSrc).root.toLowerCase() === path.parse(absDest).root.toLowerCase();

  if (sameRoot) {
    try {
      const rel = path.relative(path.dirname(absDest), absSrc);
      await fsp.symlink(rel || absSrc, dest, 'file');
      return { dest, action: 'symlink' };
    } catch {
      // fall through to absolute
    }
  }
  try {
    await fsp.symlink(absSrc, dest, 'file');
    return { dest, action: 'symlink' };
  } catch {
    // fall through
  }
  try {
    await fsp.link(absSrc, dest);
    return { dest, action: 'hardlink' };
  } catch {
    await fsp.copyFile(absSrc, dest);
    return { dest, action: 'copy' };
  }
}

/**
 * Require Light, Flat, Bias, and Dark before staging.
 * Dark = matching master-library darks when useMasterDarks, else session Dark folder.
 */
function evaluateIngestFrameReadiness(opts = {}) {
  const lights = opts.lights || [];
  const flats = opts.flats || [];
  const biases = opts.biases || [];
  const sessionDarks = opts.sessionDarks || opts.darks || [];
  const useMasterDarks = !!opts.useMasterDarks;
  const darkMatchesByFilter = opts.darkMatchesByFilter || {};

  const filterList = [];
  if (opts.filters && opts.filters.length) {
    for (const f of opts.filters) {
      const n = normalizeFilter(f) || String(f);
      if (n && !filterList.includes(n)) filterList.push(n);
    }
  } else {
    for (const L of lights) {
      const n = normalizeFilter(L.filter) || 'Unknown';
      if (!filterList.includes(n)) filterList.push(n);
    }
  }

  const missing = [];
  if (!lights.length) missing.push('Light');

  if (filterList.length) {
    for (const f of filterList) {
      const flatN = flats.filter((x) => (normalizeFilter(x.filter) || 'Unknown') === f).length;
      if (!flatN) missing.push(`Flat (${f})`);
    }
  } else if (!flats.length) {
    missing.push('Flat');
  }

  if (!biases.length) missing.push('Bias');

  let masterCount = opts.masterDarkCount;
  if (masterCount == null || !Number.isFinite(Number(masterCount))) {
    masterCount = 0;
    const keys = filterList.length ? filterList : Object.keys(darkMatchesByFilter);
    for (const f of keys) {
      const m = darkMatchesByFilter[f] || [];
      if (m.length > masterCount) masterCount = m.length;
    }
    const star = darkMatchesByFilter['*'] || [];
    if (star.length > masterCount) masterCount = star.length;
  }
  masterCount = Number(masterCount) || 0;
  const hasSessionDarks = sessionDarks.length > 0;
  const hasMasterDarks = masterCount > 0;
  // Never stage for Siril without some dark source (session and/or matching masters).
  if (!hasSessionDarks && !hasMasterDarks) {
    missing.push('Dark (session or master library)');
  } else if (useMasterDarks) {
    if (!hasMasterDarks) missing.push('Dark (master library)');
  } else if (!hasSessionDarks) {
    missing.push('Dark (session)');
  }

  return {
    ok: missing.length === 0,
    missing,
    code: missing.length ? 'MISSING_FRAMES' : null,
    error: missing.length
      ? `Missing required frames: ${missing.join(', ')}. Need Light, Flat, Bias, and Dark before staging.`
      : null,
  };
}

/**
 * Stage Siril tree from a scanned session.
 *
 * Source ASIAIR folders are never modified.
 * Lights/flats: direct copy into the Siril tree.
 * Biases/darks: copy into _calibration/..., then symlink into each channel folder.
 */
async function stageSirilTree(opts = {}) {
  const projectDir = opts.projectDir;
  const sourceDir = opts.sourceDir || opts.asiairSourcePath || projectDir;
  const nightDate = normalizeNight(opts.nightDate);
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  if (!nightDate) return { ok: false, error: 'nightDate is required' };

  const shootFolder = sanitizeFolderName(opts.shootFolder || opts.shootName || nightDate);
  const shootFilter = opts.shootFilter ? normalizeFilter(opts.shootFilter) : null;
  const force = opts.force === true;

  const useMasterDarks = opts.useMasterDarks === true;
  const darkMatchesByFilter = opts.darkMatchesByFilter || {};
  const targetHint = opts.targetHint || null;
  const filtersFilter = opts.filters && opts.filters.length
    ? new Set(opts.filters.map(normalizeFilter))
    : null;

  // Scan from ASIAIR source (unit/USB); stage into projectDir (Siril root).
  const scan = await scanSession({
    projectDir: sourceDir,
    sessionPath: opts.sessionPath || null,
    nightDate,
    targetHint,
    includeTargets: opts.includeTargets || null,
    targetCoords: opts.targetCoords || null,
    skipTargetHint: opts.skipTargetHint === true,
  });
  if (!scan.ok) return scan;

  if (
    scan.targetMatch
    && scan.targetMatch.needsConfirm
    && !(opts.includeTargets && opts.includeTargets.length)
  ) {
    return {
      ok: false,
      code: 'TARGET_CONFIRM_REQUIRED',
      error: 'Target match needs confirmation before staging',
      targets: scan.targets,
      targetMatch: scan.targetMatch,
    };
  }

  let lights = scan.lights;
  let flats = scan.flats;
  const biases = scan.biases;
  const sessionDarks = scan.darks || [];

  if (filtersFilter) {
    lights = lights.filter((f) => filtersFilter.has(normalizeFilter(f.filter) || 'Unknown'));
    flats = flats.filter((f) => filtersFilter.has(normalizeFilter(f.filter) || 'Unknown'));
  }
  // Prefer staging only the shoot's filter channel (shared calib still reused).
  if (shootFilter) {
    lights = lights.filter((f) => (normalizeFilter(f.filter) || 'Unknown') === shootFilter);
    flats = flats.filter((f) => (normalizeFilter(f.filter) || 'Unknown') === shootFilter);
  }

  const filters = [...new Set([
    ...lights.map((f) => normalizeFilter(f.filter) || 'Unknown'),
    ...flats.map((f) => normalizeFilter(f.filter) || 'Unknown'),
  ])];

  const lightParamsByFilter = {};
  for (const L of lights) {
    const f = normalizeFilter(L.filter) || 'Unknown';
    if (!lightParamsByFilter[f]) {
      lightParamsByFilter[f] = {
        exposureSec: L.exposureSec,
        gain: L.gain,
        tempC: L.tempC,
      };
    }
  }

  const sessionDarkIndex = sessionDarks.map((d) => ({
    filePath: d.filePath,
    fileName: d.fileName,
    exposureSec: d.exposureSec,
    gain: d.gain,
    tempC: d.tempC,
    bin: d.bin,
    date: d.date,
    acquiredAt: d.date
      ? `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`
      : null,
  }));

  // Only exp/gain/temp-matched session darks are usable for readiness + staging.
  const usableSessionDarks = [];
  const seenDark = new Set();
  for (const filter of (shootFilter ? [shootFilter] : Object.keys(lightParamsByFilter))) {
    const params = lightParamsByFilter[filter] || lightParamsByFilter[Object.keys(lightParamsByFilter)[0]] || {};
    const matched = matchMasterDarks({
      index: sessionDarkIndex,
      exposureSec: params.exposureSec,
      gain: params.gain,
      tempC: params.tempC,
    }).matches;
    for (const d of matched) {
      const key = d.filePath || d.fileName;
      if (!key || seenDark.has(key)) continue;
      seenDark.add(key);
      usableSessionDarks.push(d);
    }
  }

  const readinessFilters = shootFilter
    ? [shootFilter]
    : (filtersFilter ? [...filtersFilter] : filters);
  const readiness = evaluateIngestFrameReadiness({
    lights,
    flats,
    biases,
    sessionDarks: usableSessionDarks,
    useMasterDarks,
    darkMatchesByFilter,
    filters: readinessFilters,
  });
  if (!readiness.ok) {
    return {
      ok: false,
      code: readiness.code,
      error: readiness.error,
      missing: readiness.missing,
      scan,
    };
  }

  // Conflict: dest already has data — caller can confirm and force.
  const destRootsPreview = filters.map((f) => path.join(projectDir, sanitizeFolderName(f), shootFolder));
  if (!force) {
    const existing = [];
    for (const root of destRootsPreview) {
      for (const sub of ['lights', 'flats', 'biases', 'darks']) {
        const dir = path.join(root, sub);
        try {
          const names = await fsp.readdir(dir);
          if (names.some((n) => FIT_EXT.test(n))) {
            existing.push(root);
            break;
          }
        } catch { /* missing ok */ }
      }
    }
    if (existing.length) {
      return {
        ok: false,
        code: 'DEST_EXISTS',
        error: 'Staged data already exists for this shoot folder.',
        existingRoots: existing,
        destRoots: destRootsPreview,
        shootFolder,
        nightDate,
      };
    }
  }
  const biasLibDir = path.join(projectDir, '_calibration', 'darkflats', nightDate);
  const darkLibDir = path.join(projectDir, '_calibration', 'darks', nightDate);
  await fsp.mkdir(biasLibDir, { recursive: true });
  if (!useMasterDarks) await fsp.mkdir(darkLibDir, { recursive: true });

  // Reuse any calibration already on disk for this night (other filters / prior stages).
  let preexistingBiasCount = 0;
  let preexistingDarkCount = 0;
  try {
    preexistingBiasCount = (await fsp.readdir(biasLibDir)).filter((n) => FIT_EXT.test(n)).length;
  } catch { /* ignore */ }
  if (!useMasterDarks) {
    try {
      preexistingDarkCount = (await fsp.readdir(darkLibDir)).filter((n) => FIT_EXT.test(n)).length;
    } catch { /* ignore */ }
  }

  const staged = [];
  const errors = [];

  // Biases: source -> copy into calibration (never move source).
  const copiedBiases = [];
  for (const b of biases) {
    const dest = path.join(biasLibDir, b.fileName);
    try {
      const result = await ensureCopied(b.filePath, dest);
      copiedBiases.push({ from: b.filePath, to: dest, action: result.action });
    } catch (err) {
      errors.push({ file: b.filePath, error: String(err.message || err) });
    }
  }

  // Collect unique darks.
  // Master library: symlink straight into each channel's darks/ (no _calibration copy).
  // Session darks: copy into _calibration/darks/<night>/, then symlink into channels.
  const darkByName = new Map();
  if (useMasterDarks) {
    for (const filter of filters) {
      const matches = darkMatchesByFilter[filter] || darkMatchesByFilter['*'] || [];
      for (const d of matches) {
        const name = path.basename(d.filePath || d.fileName || '');
        if (name && d.filePath && !darkByName.has(name)) darkByName.set(name, d);
      }
    }
  } else if (sessionDarkIndex.length) {
    for (const filter of filters) {
      const params = lightParamsByFilter[filter] || {};
      const matched = matchMasterDarks({
        index: sessionDarkIndex,
        exposureSec: params.exposureSec,
        gain: params.gain,
        tempC: params.tempC,
      }).matches;
      // Do not fall back to unmatched session darks — wrong exp/gain/temp is unusable.
      for (const d of matched) {
        const name = path.basename(d.filePath || d.fileName || '');
        if (name && !darkByName.has(name)) darkByName.set(name, d);
      }
    }
  }

  const copiedDarks = [];
  let masterDarkSourceDir = null;
  let calibDarkFiles = [];

  if (useMasterDarks) {
    for (const d of darkByName.values()) {
      if (!masterDarkSourceDir && d.filePath) {
        masterDarkSourceDir = masterDarkSourceSetDir(d.filePath);
      }
      calibDarkFiles.push(d.filePath);
      copiedDarks.push({
        from: d.filePath,
        to: d.filePath,
        action: 'link-source',
        source: 'master',
      });
    }
  } else {
    await fsp.mkdir(darkLibDir, { recursive: true });
    for (const d of darkByName.values()) {
      const dest = path.join(darkLibDir, path.basename(d.filePath || d.fileName));
      try {
        const result = await ensureCopied(d.filePath, dest);
        copiedDarks.push({
          from: d.filePath,
          to: dest,
          action: result.action,
          source: 'session',
        });
      } catch (err) {
        errors.push({ file: d.filePath, error: String(err.message || err) });
      }
    }
    try {
      calibDarkFiles = (await fsp.readdir(darkLibDir))
        .filter((n) => FIT_EXT.test(n))
        .map((n) => path.join(darkLibDir, n));
    } catch {
      calibDarkFiles = [];
    }
  }

  let calibBiasFiles = [];
  try {
    calibBiasFiles = (await fsp.readdir(biasLibDir))
      .filter((n) => FIT_EXT.test(n))
      .map((n) => path.join(biasLibDir, n));
  } catch {
    calibBiasFiles = [];
  }

  for (const filter of filters) {
    const base = path.join(projectDir, sanitizeFolderName(filter), shootFolder);
    const lightsDir = path.join(base, 'lights');
    const flatsDir = path.join(base, 'flats');
    const biasesDir = path.join(base, 'biases');
    const darksDir = path.join(base, 'darks');
    await fsp.mkdir(lightsDir, { recursive: true });
    await fsp.mkdir(flatsDir, { recursive: true });
    await fsp.mkdir(biasesDir, { recursive: true });
    await fsp.mkdir(darksDir, { recursive: true });

    for (const L of lights.filter((f) => (normalizeFilter(f.filter) || 'Unknown') === filter)) {
      const dest = path.join(lightsDir, L.fileName);
      try {
        const result = await ensureCopied(L.filePath, dest);
        staged.push({ type: 'light', filter, from: L.filePath, to: dest, action: result.action });
      } catch (err) {
        errors.push({ file: L.filePath, error: String(err.message || err) });
      }
    }

    for (const F of flats.filter((f) => (normalizeFilter(f.filter) || 'Unknown') === filter)) {
      const dest = path.join(flatsDir, F.fileName);
      try {
        const result = await ensureCopied(F.filePath, dest);
        staged.push({ type: 'flat', filter, from: F.filePath, to: dest, action: result.action });
      } catch (err) {
        errors.push({ file: F.filePath, error: String(err.message || err) });
      }
    }

    for (const src of calibBiasFiles) {
      const dest = path.join(biasesDir, path.basename(src));
      try {
        const result = await ensureLink(src, dest);
        staged.push({ type: 'bias', filter, from: src, to: dest, action: result.action });
      } catch (err) {
        errors.push({ file: src, error: String(err.message || err) });
      }
    }

    for (const src of calibDarkFiles) {
      const dest = path.join(darksDir, path.basename(src));
      try {
        const result = await ensureLink(src, dest);
        staged.push({
          type: 'dark',
          filter,
          from: src,
          to: dest,
          action: result.action,
          source: useMasterDarks ? 'master' : 'session',
        });
      } catch (err) {
        errors.push({ file: src, error: String(err.message || err) });
      }
    }
  }

  return {
    ok: errors.length === 0 || staged.length > 0,
    meta: {
      projectDir,
      sessionPath: scan.sessionPath,
      sessionPaths: scan.sessionPaths || [],
      shootingTypes: scan.shootingTypes || [],
      nightDate,
      shootFolder,
      filters,
      destRoots: filters.map((f) => path.join(projectDir, sanitizeFolderName(f), shootFolder)),
      biasLibrary: biasLibDir,
      darkLibrary: useMasterDarks ? (masterDarkSourceDir || darkLibDir) : darkLibDir,
      darkSource: useMasterDarks ? 'master-symlink' : 'session-calibration',
      calibReuse: {
        nightDate,
        biasesPreexisting: preexistingBiasCount,
        darksPreexisting: preexistingDarkCount,
        biasesAfter: calibBiasFiles.length,
        darksAfter: calibDarkFiles.length,
      },
      filesStaged: staged.filter((s) => s.action !== 'skipped').length,
      filesSkipped: staged.filter((s) => s.action === 'skipped').length,
      biasesCopied: copiedBiases.filter((b) => b.action === 'copied').length,
      darksCopied: copiedDarks.filter((d) => d.action === 'copied').length,
      biasesMoved: copiedBiases.filter((b) => b.action === 'copied').length,
      byType: {
        light: staged.filter((s) => s.type === 'light').length,
        flat: staged.filter((s) => s.type === 'flat').length,
        bias: staged.filter((s) => s.type === 'bias').length,
        dark: staged.filter((s) => s.type === 'dark').length,
      },
      status: scan.status,
      filterRows: scan.filters,
      stagedAt: new Date().toISOString(),
      errors,
    },
    staged,
    copiedBiases,
    copiedDarks,
    movedBiases: copiedBiases,
    scan: {
      status: scan.status,
      filters: scan.filters,
      targets: scan.targets,
      summary: scan.summary,
    },
  };
}

/** Legacy scan used by older IPC — kept for compatibility. */
async function scanAsiairSource(sourcePath, opts = {}) {
  const readHeaders = opts.readHeaders !== false;
  const files = await walkFitFiles(sourcePath);
  const frames = [];
  for (const filePath of files) {
    let parsed = {
      ...parseAsiairFilename(path.basename(filePath)),
      filePath,
      header: null,
      night: null,
    };
    if (readHeaders) {
      try {
        const header = await readFitsHeaderKeywords(filePath);
        parsed = mergeHeaderIntoParsed(parsed, header);
      } catch {
        parsed.night = astronomicalNightForFrame(parsed.date, parsed.time);
      }
    } else {
      parsed.night = astronomicalNightForFrame(parsed.date, parsed.time);
    }
    frames.push(parsed);
  }
  return {
    ok: true,
    sourcePath,
    totalFiles: frames.length,
    matched: frames.filter((f) => f.matched).length,
    unmatched: frames.filter((f) => !f.matched).length,
    frames,
    summary: summarizeFrames(frames),
  };
}

function filterFramesForShoot(frames, ctx = {}) {
  const night = normalizeNight(ctx.night);
  const filter = ctx.filter ? normalizeFilter(ctx.filter) : null;
  return frames.filter((f) => {
    if (!f.matched || !f.type) return false;
    // Darks ignore filter — reusable across all channels.
    if (filter && f.filter && normalizeFilter(f.filter) !== filter) {
      if (f.type === 'light' || f.type === 'flat' || f.type === 'darkflat') return false;
    }
    if (night && !frameInNightWindow(f, night)) {
      if (f.type === 'light') return false;
    }
    return true;
  });
}

function buildDestPath(workRoot, objectName, filter, night, frameType) {
  const folder = TYPE_FOLDERS[frameType] || 'other';
  return path.join(
    workRoot,
    sanitizeFolderName(objectName),
    sanitizeFolderName(filter || 'Unknown'),
    normalizeNight(night) || 'unknown_night',
    folder
  );
}

/** @deprecated Prefer stageSirilTree with projectDir */
async function ingestAsiairDump(opts) {
  const mode = opts.mode || 'hardlink';
  const scan = await scanAsiairSource(opts.sourcePath, { readHeaders: opts.readHeaders !== false });
  const frames = opts.filterToShoot
    ? filterFramesForShoot(scan.frames, { filter: opts.filter, night: opts.night })
    : scan.frames.filter((f) => f.matched && f.type);

  if (!frames.length) {
    return { ok: false, error: 'No matching FITS frames found to ingest.', scan, copied: [] };
  }

  const night = normalizeNight(opts.night)
    || frames.find((f) => f.type === 'light' && f.night)?.night
    || frames.find((f) => f.date)?.date
    || 'unknown_night';
  const filter = normalizeFilter(opts.filter)
    || frames.find((f) => f.type === 'light' && f.filter)?.filter
    || 'Unknown';
  const objectName = opts.objectName || frames.find((f) => f.target)?.target || 'Object';

  const copied = [];
  const errors = [];
  for (const frame of frames) {
    if (!frame.type) continue;
    const destDir = buildDestPath(opts.workRoot, objectName, filter, night, frame.type);
    const dest = path.join(destDir, frame.fileName);
    try {
      await fsp.mkdir(destDir, { recursive: true });
      if (fs.existsSync(dest)) {
        copied.push({ type: frame.type, from: frame.filePath, to: dest, action: 'skipped' });
        continue;
      }
      if (mode === 'hardlink') {
        try {
          await fsp.link(frame.filePath, dest);
          copied.push({ type: frame.type, from: frame.filePath, to: dest, action: 'hardlink' });
          continue;
        } catch { /* copy */ }
      }
      await fsp.copyFile(frame.filePath, dest);
      copied.push({ type: frame.type, from: frame.filePath, to: dest, action: 'copy' });
    } catch (err) {
      errors.push({ file: frame.filePath, error: String(err.message || err) });
    }
  }

  const destRoot = path.join(
    opts.workRoot,
    sanitizeFolderName(objectName),
    sanitizeFolderName(filter),
    normalizeNight(night) || 'unknown_night'
  );
  const lights = copied.filter((c) => c.type === 'light');
  return {
    ok: errors.length === 0 || copied.length > 0,
    meta: {
      objectName,
      filter,
      night: normalizeNight(night),
      destRoot,
      sourcePath: opts.sourcePath,
      mode,
      filesCopied: copied.filter((c) => c.action !== 'skipped').length,
      filesSkipped: copied.filter((c) => c.action === 'skipped').length,
      frameCount: lights.length,
      exposureSec: scan.summary.exposureSec,
      gain: scan.summary.gain,
      tempC: scan.summary.tempC,
      bin: scan.summary.bin,
      byType: summarizeFrames(frames).byType,
      ingestedAt: new Date().toISOString(),
      errors,
    },
    copied,
    scan: {
      totalFiles: scan.totalFiles,
      matched: scan.matched,
      unmatched: scan.unmatched,
      summary: scan.summary,
    },
  };
}

/**
 * Guess YYMMDD dump folder from a path name or newest light DATE-OBS.
 */
async function inferAsiairDumpNight(sourcePath, nightHint) {
  if (nightHint) {
    const n = normalizeNight(nightHint);
    if (n) return n.slice(2);
  }
  const base = path.basename(sourcePath || '');
  const m = String(base).match(/(?:^|[_\-.])(\d{6}|\d{8})(?:$|[_\-.])/);
  if (m) {
    const n = normalizeNight(m[1]);
    if (n) return n.slice(2);
  }
  // Walk for lights and take newest DATE-OBS → astronomical night → YYMMDD
  let newest = null;
  try {
    const files = await walkFitFiles(sourcePath);
    for (const fp of files.slice(0, 400)) {
      const parsed = await parseFitFile(fp, null);
      if (parsed.type && parsed.type !== 'light') continue;
      const night = astronomicalNightForFrame(parsed.date, parsed.time) || normalizeNight(parsed.date);
      if (!night) continue;
      if (!newest || night > newest) newest = night;
    }
  } catch { /* ignore */ }
  if (newest) return newest.slice(2);
  return null;
}

/**
 * Resolve what to copy into asiair/<YYMMDD>/:
 * - source is Autorun/Plan → copy as that session name
 * - source has Autorun/Plan children → copy those children
 * - source is itself a session (Light/Flat/…) → copy contents as Autorun
 */
async function resolveAsiairImportPayload(sourcePath) {
  const base = path.basename(sourcePath);
  if (SESSION_DIR_NAMES.has(base.toLowerCase())) {
    return [{ name: base, from: sourcePath }];
  }
  let ents = [];
  try {
    ents = await fsp.readdir(sourcePath, { withFileTypes: true });
  } catch {
    return { error: 'Cannot read source folder' };
  }
  const sessions = ents.filter((e) => e.isDirectory() && SESSION_DIR_NAMES.has(e.name.toLowerCase()));
  if (sessions.length) {
    return sessions.map((e) => ({ name: e.name, from: path.join(sourcePath, e.name) }));
  }
  const frames = await findFrameDirs(sourcePath);
  if (frames.light || frames.flat || frames.bias) {
    return [{ name: 'Autorun', from: sourcePath, copyContents: true }];
  }
  return { error: 'No Autorun/Plan or Light/Flat/Bias folders found in selection' };
}

/**
 * Copy an ASIAIR dump into projectDir/asiair/<YYMMDD>/ (does not stage).
 */
async function importAsiairDump(opts = {}) {
  const projectDir = opts.projectDir;
  const sourcePath = opts.sourcePath;
  if (!projectDir) return { ok: false, error: 'projectDir is required' };
  if (!sourcePath) return { ok: false, error: 'sourcePath is required' };
  if (!fs.existsSync(projectDir)) return { ok: false, error: 'Project directory not found' };
  if (!fs.existsSync(sourcePath)) return { ok: false, error: 'Source folder not found' };

  const yyMMdd = await inferAsiairDumpNight(sourcePath, opts.nightHint);
  if (!yyMMdd) {
    return { ok: false, error: 'Could not determine dump night (pass nightHint or include dated FITS)' };
  }

  const payload = await resolveAsiairImportPayload(sourcePath);
  if (payload.error) return { ok: false, error: payload.error };

  const destDump = path.join(projectDir, 'asiair', yyMMdd);
  await fsp.mkdir(destDump, { recursive: true });

  const copied = [];
  for (const item of payload) {
    const dest = path.join(destDump, item.name);
    if (fs.existsSync(dest)) {
      return {
        ok: false,
        error: `Destination already exists: ${dest} (remove or choose another night)`,
        destDump,
      };
    }
    if (item.copyContents) {
      await fsp.mkdir(dest, { recursive: true });
      await fsp.cp(item.from, dest, { recursive: true });
    } else {
      await fsp.cp(item.from, dest, { recursive: true });
    }
    copied.push({ name: item.name, from: item.from, to: dest });
  }

  return {
    ok: true,
    projectDir,
    sourcePath,
    nightFolder: yyMMdd,
    destDump,
    copied,
  };
}

module.exports = {
  FRAME_TYPES,
  TYPE_FOLDERS,
  SESSION_DIR_NAMES,
  TEMP_TOLERANCE_C,
  SIX_MONTHS_MS,
  TARGET_MATCH_AUTO_DEG,
  TARGET_MATCH_CONFIRM_DEG,
  parseAsiairFilename,
  parseExposureToSeconds,
  normalizeFilter,
  normalizeNight,
  sanitizeFolderName,
  astronomicalNightForFrame,
  nightWindowYmds,
  readFitsHeaderKeywords,
  parseFitsAngleDegrees,
  angularSeparationDeg,
  buildTargetFolders,
  targetMatchNeedsConfirm,
  scanAsiairSource,
  summarizeFrames,
  filterFramesForShoot,
  buildDestPath,
  ingestAsiairDump,
  discoverSessions,
  scanSession,
  importAsiairDump,
  inferAsiairDumpNight,
  asiairNightFolderCandidates,
  indexDarkLibrary,
  matchMasterDarks,
  evaluateIngestFrameReadiness,
  stageSirilTree,
  masterDarkSourceSetDir,
};
