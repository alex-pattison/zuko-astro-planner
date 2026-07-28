/**
 * ASIAIR Ingest Tool
 *
 * Parse ZWO ASIAIR dumps, extract metadata from filenames (and optional FITS
 * headers), and reorganize into a Siril-friendly project tree:
 *
 *   <workRoot>/<Object>/<Filter>/<Night>/{lights,darks,flats,darkflats,biases}/
 *
 * ASIAIR naming (typical):
 *   Light_<Target>_<exp>s_Bin1_<FILTER>_gain100_20240320-203324_-10.0C_0001.fit
 *   Flat_1.0ms_Bin1_Ha_gain100_20240320-233122_-10.5C_0001.fit
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
  darkflat: 'darkflats',
};
const SKIP_DIR_NAMES = new Set(['live', 'preview', 'video', 'log', 'thumbnail', 'thumbnails']);
const FIT_EXT = /\.(fit|fits|fts)$/i;

/** @typedef {'light'|'flat'|'dark'|'bias'|'darkflat'} FrameType */

/**
 * @typedef {object} ParsedFrame
 * @property {string} filePath
 * @property {string} fileName
 * @property {FrameType|null} type
 * @property {string|null} target
 * @property {number|null} exposureSec
 * @property {number|null} bin
 * @property {string|null} filter
 * @property {number|null} gain
 * @property {string|null} date  YYYYMMDD
 * @property {string|null} time  HHMMSS
 * @property {number|null} tempC
 * @property {number|null} sequence
 * @property {boolean} matched
 * @property {object|null} header  optional FITS keywords
 */

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

/**
 * Parse an ASIAIR-style FITS filename (basename with or without extension).
 * @param {string} fileName
 * @returns {Omit<ParsedFrame, 'filePath'|'header'>}
 */
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

  // Type_Target_exps_BinN_FILTER_gainG_DATE-TIME_TEMPc_SEQ
  // Type_exps_BinN_FILTER_gainG_DATE-TIME_TEMPc_SEQ  (flats/darks often omit target)
  const re = /^(Light|Flat|Dark|Bias|DarkFlat|Dark-Flat|darkflat)_(.+)$/i;
  const typeMatch = bare.match(re);
  if (!typeMatch) return empty;

  let typeRaw = typeMatch[1].toLowerCase().replace(/-/g, '');
  if (typeRaw === 'darkflat') typeRaw = 'darkflat';
  /** @type {FrameType|null} */
  let type = FRAME_TYPES.has(typeRaw) ? /** @type {FrameType} */ (typeRaw) : null;

  const rest = typeMatch[2];
  const parts = rest.split('_');

  let target = null;
  let idx = 0;

  // Exposure is the first token that looks like 10.0s / 1.0ms
  const isExp = (p) => /^[\d.]+(ms|s)$/i.test(p);
  if (parts.length && !isExp(parts[0])) {
    // May be target; consume until exposure token
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

/**
 * Read a subset of FITS header keywords from the start of a file.
 * @param {string} filePath
 * @returns {Promise<Record<string, string|number|null>>}
 */
async function readFitsHeaderKeywords(filePath, keys = ['OBJECT', 'FILTER', 'EXPTIME', 'EXPOSURE', 'GAIN', 'CCD-TEMP', 'SET-TEMP', 'XBINNING', 'DATE-OBS', 'IMAGETYP']) {
  const want = new Set(keys.map((k) => k.toUpperCase()));
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(2880 * 4); // up to 4 FITS blocks
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf.slice(0, bytesRead).toString('binary');
    /** @type {Record<string, string|number|null>} */
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

function mergeHeaderIntoParsed(parsed, header) {
  if (!header) return parsed;
  const next = { ...parsed, header };
  if (!next.filter && (header.FILTER != null)) next.filter = normalizeFilter(String(header.FILTER));
  if (!next.target && header.OBJECT) next.target = String(header.OBJECT);
  if (next.exposureSec == null && (header.EXPTIME != null || header.EXPOSURE != null)) {
    next.exposureSec = Number(header.EXPTIME != null ? header.EXPTIME : header.EXPOSURE);
  }
  if (next.gain == null && header.GAIN != null) next.gain = Number(header.GAIN);
  if (next.tempC == null && (header['CCD-TEMP'] != null || header['SET-TEMP'] != null)) {
    next.tempC = Number(header['CCD-TEMP'] != null ? header['CCD-TEMP'] : header['SET-TEMP']);
  }
  if (next.bin == null && header.XBINNING != null) next.bin = Number(header.XBINNING);
  if (!next.date && header['DATE-OBS']) {
    const m = String(header['DATE-OBS']).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) next.date = `${m[1]}${m[2]}${m[3]}`;
  }
  if (!next.type && header.IMAGETYP) {
    const t = String(header.IMAGETYP).toLowerCase();
    if (t.includes('light')) next.type = 'light';
    else if (t.includes('dark flat') || t.includes('darkflat') || t.includes('flat dark')) next.type = 'darkflat';
    else if (t.includes('flat')) next.type = 'flat';
    else if (t.includes('dark')) next.type = 'dark';
    else if (t.includes('bias') || t.includes('offset')) next.type = 'bias';
  }
  next.matched = !!(next.type && (next.exposureSec != null || next.date || next.filter));
  return next;
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

/**
 * Scan an ASIAIR dump (or any folder of FITS) and return parsed frames.
 * @param {string} sourcePath
 * @param {{ readHeaders?: boolean }} [opts]
 */
async function scanAsiairSource(sourcePath, opts = {}) {
  const readHeaders = !!opts.readHeaders;
  const files = await walkFitFiles(sourcePath);
  /** @type {ParsedFrame[]} */
  const frames = [];

  for (const filePath of files) {
    let parsed = {
      ...parseAsiairFilename(path.basename(filePath)),
      filePath,
      header: null,
    };
    if (readHeaders) {
      try {
        const header = await readFitsHeaderKeywords(filePath);
        parsed = mergeHeaderIntoParsed(parsed, header);
      } catch {
        // filename-only is fine
      }
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

function summarizeFrames(frames) {
  const byType = {};
  const filters = new Set();
  const dates = new Set();
  const targets = new Set();
  let exposureSec = null;
  let gain = null;
  let tempC = null;
  let bin = null;

  for (const f of frames) {
    const t = f.type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
    if (f.filter) filters.add(f.filter);
    if (f.date) dates.add(f.date);
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
    dates: [...dates].sort(),
    targets: [...targets],
    lightCount: byType.light || 0,
    exposureSec,
    gain,
    tempC,
    bin,
  };
}

/**
 * Filter scanned frames for a shoot context (optional filter / night).
 * @param {ParsedFrame[]} frames
 * @param {{ filter?: string|null, night?: string|null, types?: FrameType[] }} [ctx]
 */
function filterFramesForShoot(frames, ctx = {}) {
  const night = normalizeNight(ctx.night);
  const filter = ctx.filter ? normalizeFilter(ctx.filter) : null;
  const types = ctx.types && ctx.types.length ? new Set(ctx.types) : null;

  return frames.filter((f) => {
    if (!f.matched || !f.type) return false;
    if (types && !types.has(f.type)) return false;
    if (filter && f.filter && normalizeFilter(f.filter) !== filter) {
      // Keep darks/biases without filter tags; drop mismatched lights/flats/darkflats
      if (f.type === 'light' || f.type === 'flat' || f.type === 'darkflat') return false;
    }
    if (night && f.date && normalizeNight(f.date) !== night) {
      // Darks/biases from a bank may be other dates — keep them unless they're lights
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

async function copyOrLink(src, dest, mode) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    return { dest, action: 'skipped' };
  }
  if (mode === 'hardlink') {
    try {
      await fsp.link(src, dest);
      return { dest, action: 'hardlink' };
    } catch {
      // fall through to copy (cross-volume)
    }
  }
  await fsp.copyFile(src, dest);
  return { dest, action: 'copy' };
}

/**
 * Ingest frames into the Siril-friendly project tree.
 *
 * @param {object} opts
 * @param {string} opts.sourcePath
 * @param {string} opts.workRoot
 * @param {string} opts.objectName
 * @param {string|null} [opts.filter]
 * @param {string|null} [opts.night]
 * @param {'copy'|'hardlink'} [opts.mode]
 * @param {boolean} [opts.readHeaders]
 * @param {boolean} [opts.filterToShoot]  when true, prefer matching filter/night for lights
 */
async function ingestAsiairDump(opts) {
  const mode = opts.mode || 'hardlink';
  const scan = await scanAsiairSource(opts.sourcePath, { readHeaders: !!opts.readHeaders });
  const frames = opts.filterToShoot
    ? filterFramesForShoot(scan.frames, {
        filter: opts.filter,
        night: opts.night,
      })
    : scan.frames.filter((f) => f.matched && f.type);

  if (!frames.length) {
    return {
      ok: false,
      error: 'No matching FITS frames found to ingest.',
      scan,
      copied: [],
    };
  }

  const night = normalizeNight(opts.night)
    || frames.find((f) => f.type === 'light' && f.date)?.date
    || frames.find((f) => f.date)?.date
    || 'unknown_night';

  const filter = normalizeFilter(opts.filter)
    || frames.find((f) => f.type === 'light' && f.filter)?.filter
    || frames.find((f) => f.filter)?.filter
    || 'Unknown';

  const objectName = opts.objectName
    || frames.find((f) => f.target)?.target
    || 'Object';

  const copied = [];
  const errors = [];

  for (const frame of frames) {
    if (!frame.type) continue;
    const destDir = buildDestPath(opts.workRoot, objectName, filter, night, frame.type);
    const dest = path.join(destDir, frame.fileName);
    try {
      const result = await copyOrLink(frame.filePath, dest, mode);
      copied.push({
        type: frame.type,
        from: frame.filePath,
        to: result.dest,
        action: result.action,
        exposureSec: frame.exposureSec,
        gain: frame.gain,
        tempC: frame.tempC,
        bin: frame.bin,
        filter: frame.filter,
        date: frame.date,
      });
    } catch (err) {
      errors.push({ file: frame.filePath, error: String(err && err.message ? err.message : err) });
    }
  }

  const destRoot = path.join(
    opts.workRoot,
    sanitizeFolderName(objectName),
    sanitizeFolderName(filter),
    normalizeNight(night) || 'unknown_night'
  );

  const lights = copied.filter((c) => c.type === 'light');
  const meta = {
    objectName,
    filter,
    night: normalizeNight(night),
    destRoot,
    sourcePath: opts.sourcePath,
    mode,
    filesCopied: copied.filter((c) => c.action !== 'skipped').length,
    filesSkipped: copied.filter((c) => c.action === 'skipped').length,
    frameCount: lights.length,
    exposureSec: lights.find((l) => l.exposureSec != null)?.exposureSec
      ?? scan.summary.exposureSec,
    gain: lights.find((l) => l.gain != null)?.gain ?? scan.summary.gain,
    tempC: lights.find((l) => l.tempC != null)?.tempC ?? scan.summary.tempC,
    bin: lights.find((l) => l.bin != null)?.bin ?? scan.summary.bin,
    byType: summarizeFrames(frames).byType,
    ingestedAt: new Date().toISOString(),
    errors,
  };

  return {
    ok: errors.length === 0 || copied.length > 0,
    meta,
    copied,
    scan: {
      totalFiles: scan.totalFiles,
      matched: scan.matched,
      unmatched: scan.unmatched,
      summary: scan.summary,
    },
  };
}

module.exports = {
  FRAME_TYPES,
  TYPE_FOLDERS,
  parseAsiairFilename,
  parseExposureToSeconds,
  normalizeFilter,
  normalizeNight,
  sanitizeFolderName,
  readFitsHeaderKeywords,
  scanAsiairSource,
  summarizeFrames,
  filterFramesForShoot,
  buildDestPath,
  ingestAsiairDump,
};
