'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const CULL_MANIFEST = 'culled.txt';

/** Build sequence frame basename from Siril sequence header fields. */
function ppLightBasename(seqName, filenum, fixedLen) {
  const pad = Math.max(1, Number(fixedLen) || 5);
  const base = String(seqName || 'pp_light_');
  return `${base}${String(filenum).padStart(pad, '0')}.fit`;
}

/**
 * Parse Siril .seq text — reads S header and I inclusion lines.
 * @returns {{ ok: true, header: object, frames: Array<{filenum:number,basename:string,included:boolean}> } | { ok: false, error: string }}
 */
function parseSirilSeq(text) {
  const lines = String(text || '').split(/\r?\n/);
  /** @type {{ name: string, startIndex: number, imageCount: number, selectedCount: number, fixedLen: number } | null} */
  let header = null;
  const inclusions = new Map();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('S ')) {
      const m = line.match(/^S\s+'([^']*)'\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
      if (m) {
        header = {
          name: m[1],
          startIndex: parseInt(m[2], 10),
          imageCount: parseInt(m[3], 10),
          selectedCount: parseInt(m[4], 10),
          fixedLen: parseInt(m[5], 10),
        };
      }
      continue;
    }
    if (line.startsWith('I ')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const filenum = parseInt(parts[1], 10);
        const incl = parseInt(parts[2], 10);
        if (!Number.isNaN(filenum)) inclusions.set(filenum, incl !== 0);
      }
    }
  }

  if (!header || !header.imageCount) {
    return { ok: false, error: 'No Siril sequence header (S line) found in .seq file' };
  }

  const frames = [];
  for (let i = 0; i < header.imageCount; i += 1) {
    const filenum = header.startIndex + i;
    const included = inclusions.has(filenum) ? inclusions.get(filenum) : true;
    frames.push({
      filenum,
      basename: ppLightBasename(header.name, filenum, header.fixedLen),
      included: !!included,
    });
  }

  return {
    ok: true,
    header,
    frames,
    selectedCount: header.selectedCount,
  };
}

/** Prefer registered r_pp_light_.seq (post-Register cull), else pp_light_.seq. */
function findSirilSeqFile(aggregateDir) {
  try {
    const names = fs.readdirSync(aggregateDir).filter((n) => /\.seq$/i.test(n));
    if (!names.length) return null;
    names.sort((a, b) => {
      const score = (n) => {
        if (/^r_pp_light/i.test(n)) return 0;
        if (/r_pp_light/i.test(n)) return 1;
        if (/^pp_light/i.test(n)) return 2;
        if (/pp_light/i.test(n)) return 3;
        return 4;
      };
      const ds = score(a) - score(b);
      if (ds !== 0) return ds;
      return a.localeCompare(b, undefined, { numeric: true });
    });
    return path.join(aggregateDir, names[0]);
  } catch {
    return null;
  }
}

function listFrameBasenames(dir, prefixRe) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => prefixRe.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function listPpLightBasenames(dir) {
  return listFrameBasenames(dir, /^pp_light_\d+\.fit[s]?$/i);
}

function listRPpLightBasenames(dir) {
  return listFrameBasenames(dir, /^r_pp_light_\d+\.fit[s]?$/i);
}

function readExcludedFromManifest(aggregateDir) {
  const excluded = new Set();
  for (const name of [CULL_MANIFEST, 'culled.lst', 'rejected.txt']) {
    const p = path.join(aggregateDir, name);
    if (!fs.existsSync(p)) continue;
    try {
      const text = fs.readFileSync(p, 'utf8');
      text.split(/\r?\n/).forEach((line) => {
        const s = String(line || '').trim();
        if (!s || s.startsWith('#')) return;
        excluded.add(path.basename(s).toLowerCase());
      });
    } catch {
      /* ignore */
    }
  }
  return excluded;
}

function excludedFromSeqParse(aggregateDir) {
  const seqPath = findSirilSeqFile(aggregateDir);
  if (!seqPath) return { excluded: new Set(), seqPath: null };
  try {
    const parsed = parseSirilSeq(fs.readFileSync(seqPath, 'utf8'));
    if (!parsed.ok) return { excluded: new Set(), seqPath, error: parsed.error };
    const excluded = new Set(
      parsed.frames.filter((f) => !f.included).map((f) => f.basename.toLowerCase()),
    );
    return { excluded, seqPath, parsed };
  } catch (e) {
    return { excluded: new Set(), seqPath, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Scan Aggregate/ for Siril cull state — prefers r_pp_light_.seq after Register.
 */
async function scanAggregateCull(aggregateDir) {
  const dir = path.resolve(String(aggregateDir || ''));
  if (!dir || !fs.existsSync(dir)) {
    return { ok: false, code: 'MISSING_DIR', error: 'Aggregate folder not found', aggregateDir: dir };
  }

  const rOnDisk = listRPpLightBasenames(dir);
  const ppOnDisk = listPpLightBasenames(dir);
  const useRegistered = rOnDisk.length > 0;
  const onDiskNames = useRegistered ? rOnDisk : ppOnDisk;
  const onDisk = new Set(onDiskNames.map((n) => n.toLowerCase()));
  const seqPath = findSirilSeqFile(dir);

  if (!seqPath) {
    const manifestExcluded = readExcludedFromManifest(dir);
    const frames = onDiskNames.map((basename, idx) => ({
      index: idx + 1,
      basename,
      filenum: null,
      included: !manifestExcluded.has(basename.toLowerCase()),
      exists: true,
    }));
    return {
      ok: true,
      code: 'NO_SEQ',
      aggregateDir: dir,
      seqPath: null,
      seqModifiedAt: null,
      sequenceKind: useRegistered ? 'r_pp_light' : 'pp_light',
      warning: useRegistered
        ? 'No .seq file yet — open Aggregate/ in Siril, load r_pp_light, exclude frames, then scan.'
        : onDiskNames.length
          ? 'No registered sequence yet — run Register first (aggregate + register), then cull r_pp_light in Siril.'
          : 'No frames in Aggregate/. Run Register first.',
      frames,
      totalCount: frames.length,
      includedCount: frames.filter((f) => f.included).length,
      excludedCount: frames.filter((f) => !f.included).length,
      manifestPath: fs.existsSync(path.join(dir, CULL_MANIFEST)) ? path.join(dir, CULL_MANIFEST) : null,
    };
  }

  let stat;
  try {
    stat = await fsp.stat(seqPath);
  } catch {
    stat = null;
  }

  const parsed = parseSirilSeq(await fsp.readFile(seqPath, 'utf8'));
  if (!parsed.ok) {
    return { ok: false, code: 'BAD_SEQ', error: parsed.error, aggregateDir: dir, seqPath };
  }

  const frames = parsed.frames.map((f, idx) => ({
    index: idx + 1,
    basename: f.basename,
    filenum: f.filenum,
    included: f.included,
    exists: onDisk.has(f.basename.toLowerCase()) || onDisk.has(f.basename.toLowerCase().replace(/^r_/, '')),
  }));

  // If seq is r_pp_light but exists check only looked at r_ — also accept if file on disk
  for (const f of frames) {
    if (!f.exists) {
      const p = path.join(dir, f.basename);
      f.exists = fs.existsSync(p);
    }
  }

  return {
    ok: true,
    code: 'OK',
    aggregateDir: dir,
    seqPath,
    seqModifiedAt: stat ? stat.mtime.toISOString() : null,
    seqName: parsed.header.name,
    sequenceKind: /^r_/i.test(parsed.header.name || '') ? 'r_pp_light' : 'pp_light',
    headerSelectedCount: parsed.header.selectedCount,
    frames,
    totalCount: frames.length,
    includedCount: frames.filter((f) => f.included).length,
    excludedCount: frames.filter((f) => !f.included).length,
    manifestPath: fs.existsSync(path.join(dir, CULL_MANIFEST)) ? path.join(dir, CULL_MANIFEST) : null,
  };
}

/** Write excluded basenames to Aggregate/culled.txt (Stack reads this). */
async function writeAggregateCullManifest(aggregateDir, excludedBasenames) {
  const dir = path.resolve(String(aggregateDir || ''));
  const excluded = (Array.isArray(excludedBasenames) ? excludedBasenames : [])
    .map((n) => path.basename(String(n || '')).trim())
    .filter(Boolean);
  const unique = [...new Set(excluded.map((n) => n.toLowerCase()))];
  const lines = [
    '# Zuko cull manifest — excluded from stacking (from Siril .seq scan)',
    ...unique.map((low) => {
      const orig = excluded.find((n) => n.toLowerCase() === low);
      return orig || low;
    }),
  ];
  const manifestPath = path.join(dir, CULL_MANIFEST);
  if (!unique.length) {
    try {
      if (fs.existsSync(manifestPath)) await fsp.unlink(manifestPath);
    } catch {
      /* ignore */
    }
    return { ok: true, manifestPath: null, excludedCount: 0 };
  }
  await fsp.writeFile(manifestPath, lines.join('\n') + '\n', 'utf8');
  return { ok: true, manifestPath, excludedCount: unique.length };
}

/** Resolve excluded frame basenames: culled.txt first, else live .seq parse. */
function resolveExcludedPpLights(aggregateDir) {
  const manifest = readExcludedFromManifest(aggregateDir);
  if (manifest.size) return manifest;
  return excludedFromSeqParse(aggregateDir).excluded;
}

module.exports = {
  CULL_MANIFEST,
  ppLightBasename,
  parseSirilSeq,
  findSirilSeqFile,
  listPpLightBasenames,
  listRPpLightBasenames,
  scanAggregateCull,
  writeAggregateCullManifest,
  resolveExcludedPpLights,
  readExcludedFromManifest,
};
