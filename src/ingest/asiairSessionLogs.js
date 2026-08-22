/**
 * ASIAIR session logs (Autorun / Plan + PHD2 guide logs).
 *
 * Lives beside the dump as `<source>/log/` (also Log/). Never walked as FITS.
 * Used to harden Import / pipeline with plate-solve angle, planned frame counts,
 * filter-change failures, autofocus positions, and guide-quality summaries.
 *
 * Plan-mode logs use the same Autorun-style lines when present; filenames may be
 * Plan_Log_* or Autorun_Log_* — both are accepted.
 */

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/** Single-letter (and aliases) as written in Autorun "Filter change, L change to H". */
const AUTORUN_FILTER_LETTER = {
  h: 'Ha',
  ha: 'Ha',
  o: 'OIII',
  o3: 'OIII',
  oiii: 'OIII',
  s: 'SII',
  s2: 'SII',
  sii: 'SII',
  hb: 'Hb',
  l: 'L',
  r: 'R',
  g: 'G',
  b: 'B',
};

const LINE_TS = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})\s+(.*)$/;

function normalizeFilterLetter(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const key = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return AUTORUN_FILTER_LETTER[key] || s;
}

function filtersMatch(a, b) {
  if (a == null || b == null) return false;
  const na = normalizeFilterLetter(a);
  const nb = normalizeFilterLetter(b);
  if (!na || !nb) return false;
  return String(na).toLowerCase() === String(nb).toLowerCase();
}

function ymdFromParts(y, m, d) {
  return `${y}${m}${d}`;
}

function addDaysYmd(ymd, days) {
  const n = String(ymd || '').replace(/[^0-9]/g, '');
  if (n.length !== 8) return null;
  const dt = new Date(Date.UTC(
    parseInt(n.slice(0, 4), 10),
    parseInt(n.slice(4, 6), 10) - 1,
    parseInt(n.slice(6, 8), 10) + days
  ));
  if (isNaN(dt.getTime())) return null;
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/** Evening night label: hours 00–11 → previous calendar day. */
function astronomicalNight(ymd, hour) {
  const d = String(ymd || '').replace(/[^0-9]/g, '');
  if (d.length !== 8) return null;
  if (hour != null && Number(hour) < 12) return addDaysYmd(d, -1) || d;
  return d;
}

function nightWindow(nightYmd) {
  const n = String(nightYmd || '').replace(/[^0-9]/g, '');
  if (n.length !== 8) return [];
  const next = addDaysYmd(n, 1);
  return next ? [n, next] : [n];
}

function parseLineTs(line) {
  const m = String(line || '').match(LINE_TS);
  if (!m) return null;
  return {
    ymd: ymdFromParts(m[1], m[2], m[3]),
    hms: `${m[4]}${m[5]}${m[6]}`,
    hour: parseInt(m[4], 10),
    at: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`,
    rest: m[7],
  };
}

function caaAngleDiffDeg(a, b) {
  if (a == null || b == null || !Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) {
    return null;
  }
  let d = Math.abs(Number(a) - Number(b)) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** Same rule as Import CAA gate: within tol, or within tol of 180° flip. */
function caaMatchesFramer(frameDeg, framerDeg, tol = 10) {
  if (frameDeg == null || framerDeg == null) return null;
  const direct = caaAngleDiffDeg(frameDeg, framerDeg);
  if (direct == null) return null;
  if (direct <= tol) return true;
  const flipped = caaAngleDiffDeg(frameDeg, (Number(framerDeg) + 180) % 360);
  return flipped != null && flipped <= tol;
}

/**
 * Find log directories under an ASIAIR source root.
 * Typical: G:\log, G:\ASIAIR\log, dump with Autorun/ + log/ siblings.
 */
async function findLogDirs(sourceRoot) {
  if (!sourceRoot) return [];
  const root = path.resolve(String(sourceRoot));
  const out = [];
  const seen = new Set();
  const push = async (p) => {
    if (!p || seen.has(p)) return;
    try {
      const st = await fsp.stat(p);
      if (st.isDirectory()) {
        seen.add(p);
        out.push(p);
      }
    } catch (_) { /* missing */ }
  };

  await push(path.join(root, 'log'));
  await push(path.join(root, 'Log'));
  await push(path.join(root, 'ASIAIR', 'log'));
  await push(path.join(root, 'ASIAIR', 'Log'));

  // Sibling of Autorun/Plan when sourceRoot points at Autorun itself
  const parent = path.dirname(root);
  const base = path.basename(root).toLowerCase();
  if (base === 'autorun' || base === 'plan') {
    await push(path.join(parent, 'log'));
    await push(path.join(parent, 'Log'));
  }

  // One level down: asiair/<night>/ may sit under root — also check root children named log
  try {
    const kids = await fsp.readdir(root, { withFileTypes: true });
    for (const ent of kids) {
      if (!ent.isDirectory()) continue;
      const name = ent.name.toLowerCase();
      if (name === 'autorun' || name === 'plan' || name === 'asiair') {
        await push(path.join(root, ent.name, 'log'));
        await push(path.join(root, ent.name, 'Log'));
      }
    }
  } catch (_) { /* */ }

  return out;
}

async function listSessionLogFiles(logDir) {
  const autorun = [];
  const phd2 = [];
  let entries = [];
  try {
    entries = await fsp.readdir(logDir);
  } catch (_) {
    return { autorun, phd2 };
  }
  for (const name of entries) {
    if (!/\.txt$/i.test(name)) continue;
    if (/_CHN\.txt$/i.test(name)) continue; // Chinese duplicate
    const full = path.join(logDir, name);
    if (/^(Autorun_Log_|Plan_Log_)/i.test(name)) {
      autorun.push(full);
    } else if (/^PHD2_GuideLog_/i.test(name)) {
      phd2.push(full);
    }
  }
  autorun.sort();
  phd2.sort();
  return { autorun, phd2 };
}

/**
 * Parse one Autorun or Plan English log into a structured session.
 */
function parseAutorunLog(text, filePath) {
  const lines = String(text || '').split(/\r?\n/);
  const session = {
    path: filePath || null,
    fileName: filePath ? path.basename(filePath) : null,
    kind: filePath && /Plan_Log_/i.test(filePath) ? 'plan' : 'autorun',
    startedAt: null,
    endedAt: null,
    nightYmd: null,
    calendarYmd: null,
    plans: [],
    targets: [],
    targetCoords: [],
    plateSolves: [],
    filterChanges: [],
    autofocus: [],
    shootingBlocks: [],
    exposuresLogged: 0,
    pauses: [],
    ditherCount: 0,
    flags: {
      aborted: false,
      paused: false,
      filterFail: false,
      afFail: false,
      finishedClean: false,
      shutdown: false,
    },
    timeline: [],
  };

  let currentFilter = null;
  let pendingBlock = null;

  const pushTimeline = (at, kind, detail) => {
    if (session.timeline.length < 80) {
      session.timeline.push({ at, kind, detail });
    }
  };

  const commitPendingFilter = (toFilter) => {
    if (pendingBlock && !pendingBlock.filter && toFilter) {
      pendingBlock.filter = toFilter;
    }
  };

  for (const raw of lines) {
    const ts = parseLineTs(raw);
    const body = ts ? ts.rest : String(raw || '').trim();
    if (!body) continue;
    if (ts) {
      if (!session.startedAt) {
        session.startedAt = ts.at;
        session.calendarYmd = ts.ymd;
        session.nightYmd = astronomicalNight(ts.ymd, ts.hour);
      }
      session.endedAt = ts.at;
    }
    const at = ts ? ts.at : null;

    let m;
    if ((m = body.match(/^Plan (.+) Start$/i))) {
      session.plans.push(m[1].trim());
      pushTimeline(at, 'plan', m[1].trim());
    } else if ((m = body.match(/^Plan (.+) Finish$/i))) {
      pushTimeline(at, 'plan-end', m[1].trim());
    } else if ((m = body.match(/^\[Autorun\|Begin\] (.+) Start$/i))) {
      session.targets.push(m[1].trim());
      pushTimeline(at, 'target', m[1].trim());
    } else if ((m = body.match(/^Target RA:(.+) DEC:(.+)$/i))) {
      session.targetCoords.push({ ra: m[1].trim(), dec: m[2].trim(), at });
    } else if ((m = body.match(/^Shooting (\d+) (\w+) frames, exposure ([\d.]+)s(?:\s+Bin(\d+))?/i))) {
      pendingBlock = {
        count: parseInt(m[1], 10),
        type: String(m[2]).toLowerCase(),
        exposureSec: parseFloat(m[3]),
        bin: m[4] != null ? parseInt(m[4], 10) : null,
        filter: currentFilter,
        at,
        exposuresSeen: 0,
      };
      session.shootingBlocks.push(pendingBlock);
      pushTimeline(at, 'shoot', `${pendingBlock.count}×${pendingBlock.type} ${pendingBlock.exposureSec}s`);
    } else if ((m = body.match(/^Filter change,\s*(.*?)\s*change to\s*([^,]+?)(?:,\s*(failed))?\s*$/i))) {
      const from = normalizeFilterLetter(m[1]);
      const to = normalizeFilterLetter(m[2]);
      const failed = !!m[3] || /failed/i.test(body);
      session.filterChanges.push({ from, to, failed, at });
      if (failed) session.flags.filterFail = true;
      if (to) {
        currentFilter = to;
        commitPendingFilter(to);
      }
      pushTimeline(at, failed ? 'filter-fail' : 'filter', `${from || '?'}→${to || '?'}`);
    } else if (/Auto focus succeeded/i.test(body)) {
      const pos = (body.match(/position is (\d+)/i) || [])[1];
      const entry = { ok: true, eafPos: pos != null ? parseInt(pos, 10) : null, filter: currentFilter, at };
      session.autofocus.push(entry);
      pushTimeline(at, 'af-ok', entry.eafPos != null ? String(entry.eafPos) : 'ok');
    } else if (/Auto focus failed|AF failed/i.test(body)) {
      session.autofocus.push({ ok: false, eafPos: null, filter: currentFilter, at });
      session.flags.afFail = true;
      pushTimeline(at, 'af-fail', 'failed');
    } else if ((m = body.match(/Solve succeeded:.*Angle\s*=\s*([\d.]+)/i))) {
      const angle = parseFloat(m[1]);
      const stars = (body.match(/Star number\s*=\s*(\d+)/i) || [])[1];
      session.plateSolves.push({
        ok: true,
        angle: Number.isFinite(angle) ? angle : null,
        stars: stars != null ? parseInt(stars, 10) : null,
        at,
      });
      pushTimeline(at, 'solve', angle != null ? `${angle}°` : 'ok');
    } else if (/Solve failed|Plate solve failed/i.test(body)) {
      session.plateSolves.push({ ok: false, angle: null, stars: null, at });
      pushTimeline(at, 'solve-fail', 'failed');
    } else if (/^Exposure .+ image \d+#/i.test(body)) {
      session.exposuresLogged += 1;
      if (pendingBlock) pendingBlock.exposuresSeen += 1;
    } else if (/\[Guide\] Dither\b/i.test(body)) {
      session.ditherCount += 1;
    } else if (/Stop Autorun Manually|Pause Autorun|Pause Plan/i.test(body)) {
      session.flags.paused = true;
      session.pauses.push(body);
      pushTimeline(at, 'pause', body.slice(0, 60));
    } else if (/\[Autorun\|End\] Finish Autorun/i.test(body)) {
      session.flags.finishedClean = true;
      pushTimeline(at, 'end', 'finish');
    } else if (/Shutdown ASIAIR/i.test(body)) {
      session.flags.shutdown = true;
    } else if (/Meridian/i.test(body)) {
      pushTimeline(at, 'meridian', body.slice(0, 80));
    }
  }

  // Filename fallback for night: Autorun_Log_2026-08-03_220222.txt
  if (!session.nightYmd && session.fileName) {
    const fm = session.fileName.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})/);
    if (fm) {
      const ymd = `${fm[1]}${fm[2]}${fm[3]}`;
      const hour = parseInt(fm[4], 10);
      session.calendarYmd = session.calendarYmd || ymd;
      session.nightYmd = astronomicalNight(ymd, hour);
    }
  }

  return session;
}

/**
 * Parse PHD2 guide log (v2.5 CSV sections). Distances treated as pixels → arcsec via Pixel scale.
 */
function parsePhd2GuideLog(text, filePath) {
  const lines = String(text || '').split(/\r?\n/);
  const summary = {
    path: filePath || null,
    fileName: filePath ? path.basename(filePath) : null,
    startedAt: null,
    nightYmd: null,
    calendarYmd: null,
    pixelScale: null,
    guideSessions: 0,
    frameCount: 0,
    settleFail: 0,
    settleOk: 0,
    starLost: 0,
    noStar: 0,
    errCodes: {},
    rmsRaPx: null,
    rmsDecPx: null,
    rmsTotalPx: null,
    rmsRaArcsec: null,
    rmsDecArcsec: null,
    rmsTotalArcsec: null,
    quality: 'unknown',
  };

  let inGuide = false;
  let settling = false;
  let raSq = 0;
  let decSq = 0;
  let nRms = 0;

  const enable = text.match(/Log enabled at (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (enable) {
    summary.startedAt = `${enable[1]}T${enable[2]}:${enable[3]}:${enable[4]}`;
    const ymd = enable[1].replace(/-/g, '');
    summary.calendarYmd = ymd;
    summary.nightYmd = astronomicalNight(ymd, parseInt(enable[2], 10));
  } else if (summary.fileName) {
    const fm = summary.fileName.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})/);
    if (fm) {
      summary.calendarYmd = `${fm[1]}${fm[2]}${fm[3]}`;
      summary.nightYmd = astronomicalNight(summary.calendarYmd, parseInt(fm[4], 10));
    }
  }

  for (const line of lines) {
    let m;
    if ((m = line.match(/Pixel scale\s*=\s*([\d.]+)\s*arc-sec\/px/i))) {
      summary.pixelScale = parseFloat(m[1]);
    }
    if (/Guiding Begins at/i.test(line)) {
      summary.guideSessions += 1;
      inGuide = true;
      settling = false;
      continue;
    }
    if (/Guiding Ends at/i.test(line)) {
      inGuide = false;
      settling = false;
      continue;
    }
    if (/Settling started/i.test(line)) {
      settling = true;
      continue;
    }
    if (/Settling complete/i.test(line)) {
      summary.settleOk += 1;
      settling = false;
      continue;
    }
    if (/Settling failed/i.test(line)) {
      summary.settleFail += 1;
      settling = false;
      continue;
    }
    if (/Star lost/i.test(line)) summary.starLost += 1;
    if (/No star found/i.test(line)) summary.noStar += 1;

    if (!inGuide || settling || !/^\d+,/.test(line)) continue;
    // CSV may quote fields; split carefully enough for numeric columns
    const parts = line.split(',');
    if (parts.length < 18) continue;
    summary.frameCount += 1;
    const errRaw = parts[parts.length - 1].replace(/^"|"$/g, '').trim();
    summary.errCodes[errRaw] = (summary.errCodes[errRaw] || 0) + 1;
    const errNum = parseInt(errRaw, 10);
    if (!Number.isNaN(errNum) && errNum !== 0) continue;
    if (errRaw && errRaw !== '0' && /star|lost|no star/i.test(errRaw)) continue;

    const ra = parseFloat(parts[5]);
    const dec = parseFloat(parts[6]);
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
    // Ignore pathological outliers (pixels) during brief glitches
    if (Math.abs(ra) > 8 || Math.abs(dec) > 8) continue;
    raSq += ra * ra;
    decSq += dec * dec;
    nRms += 1;
  }

  if (nRms > 10) {
    summary.rmsRaPx = Math.sqrt(raSq / nRms);
    summary.rmsDecPx = Math.sqrt(decSq / nRms);
    summary.rmsTotalPx = Math.sqrt(summary.rmsRaPx ** 2 + summary.rmsDecPx ** 2);
    if (summary.pixelScale) {
      summary.rmsRaArcsec = summary.rmsRaPx * summary.pixelScale;
      summary.rmsDecArcsec = summary.rmsDecPx * summary.pixelScale;
      summary.rmsTotalArcsec = summary.rmsTotalPx * summary.pixelScale;
    }
  }

  summary.quality = classifyGuideQuality(summary);
  return summary;
}

function classifyGuideQuality(g) {
  if (!g || g.frameCount < 30) return 'unknown';
  const lostRate = g.frameCount ? (g.starLost + g.noStar) / g.frameCount : 0;
  const settleFailRate = g.guideSessions
    ? g.settleFail / Math.max(1, g.guideSessions)
    : 0;
  const rms = g.rmsTotalArcsec;
  if (lostRate > 0.05 || settleFailRate > 0.5 || (rms != null && rms > 2.0)) return 'poor';
  if (lostRate > 0.015 || settleFailRate > 0.25 || (rms != null && rms > 1.2)) return 'fair';
  if (rms != null || g.frameCount > 100) return 'good';
  return 'unknown';
}

function sessionMatchesNight(sessionNight, shootNight, calendarYmd) {
  if (!shootNight) return false;
  const shoot = String(shootNight).replace(/[^0-9]/g, '');
  if (sessionNight && nightWindow(shoot).includes(String(sessionNight))) return true;
  // Morning calib / bias runs often share the shoot's calendar date label.
  if (calendarYmd && String(calendarYmd) === shoot) return true;
  return false;
}

function lightBlocksForFilter(session, shootFilter) {
  const blocks = (session.shootingBlocks || []).filter((b) => b.type === 'light');
  if (!shootFilter) return blocks;
  return blocks.filter((b) => !b.filter || filtersMatch(b.filter, shootFilter));
}

function plannedLightsForFilter(session, shootFilter) {
  return lightBlocksForFilter(session, shootFilter).reduce((sum, b) => sum + (b.count || 0), 0);
}

function exposuresSeenForFilter(session, shootFilter) {
  return lightBlocksForFilter(session, shootFilter).reduce((sum, b) => sum + (b.exposuresSeen || 0), 0);
}

function bestPlateAngle(session) {
  const ok = (session.plateSolves || []).filter((s) => s.ok && s.angle != null);
  if (!ok.length) return null;
  return ok[ok.length - 1].angle;
}

/**
 * Build insight for one Import night / filter from dump logs.
 */
async function buildSessionLogInsight(opts = {}) {
  const sourceRoot = opts.sourceRoot || opts.projectDir || null;
  const nightDate = String(opts.nightDate || '').replace(/[^0-9]/g, '');
  const shootFilter = opts.shootFilter ? normalizeFilterLetter(opts.shootFilter) : null;
  const refCaaDeg = opts.refCaaDeg != null && Number.isFinite(Number(opts.refCaaDeg))
    ? Number(opts.refCaaDeg)
    : null;
  const lightCount = opts.lightCount != null ? Number(opts.lightCount) : null;
  const targetNames = Array.isArray(opts.targetNames) ? opts.targetNames : [];

  const empty = {
    ok: false,
    sourceRoot,
    nightDate: nightDate || null,
    shootFilter,
    logDirs: [],
    autorunSessions: [],
    phd2: [],
    digest: null,
    softWarnings: [],
    insights: [],
  };

  if (!sourceRoot || nightDate.length !== 8) return empty;

  const logDirs = await findLogDirs(sourceRoot);
  empty.logDirs = logDirs;
  if (!logDirs.length) {
    empty.insights.push('No ASIAIR log/ folder beside source (Autorun still works without it).');
    return empty;
  }

  const autorunSessions = [];
  const phd2List = [];
  for (const dir of logDirs) {
    const listed = await listSessionLogFiles(dir);
    for (const fp of listed.autorun) {
      try {
        const text = await fsp.readFile(fp, 'utf8');
        const parsed = parseAutorunLog(text, fp);
        if (sessionMatchesNight(parsed.nightYmd, nightDate, parsed.calendarYmd)) {
          autorunSessions.push(parsed);
        }
      } catch (_) { /* skip unreadable */ }
    }
    for (const fp of listed.phd2) {
      try {
        const text = await fsp.readFile(fp, 'utf8');
        const parsed = parsePhd2GuideLog(text, fp);
        if (sessionMatchesNight(parsed.nightYmd, nightDate, parsed.calendarYmd)) {
          phd2List.push(parsed);
        }
      } catch (_) { /* */ }
    }
  }

  empty.autorunSessions = autorunSessions;
  empty.phd2 = phd2List;
  if (!autorunSessions.length && !phd2List.length) {
    empty.insights.push(`No Autorun/PHD2 logs matched night ${nightDate}.`);
    return empty;
  }

  const softWarnings = [];
  const insights = [];

  // Prefer sessions that mention the shoot filter or any light block
  let primary = autorunSessions.find((s) => plannedLightsForFilter(s, shootFilter) > 0)
    || autorunSessions.find((s) => (s.shootingBlocks || []).some((b) => b.type === 'light'))
    || autorunSessions[0]
    || null;

  // Target name soft match
  if (primary && targetNames.length) {
    const hay = `${(primary.targets || []).join(' ')} ${(primary.plans || []).join(' ')}`.toLowerCase();
    const hit = targetNames.some((t) => {
      const tok = String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (tok.length < 3) return false;
      return hay.replace(/[^a-z0-9]/g, '').includes(tok.slice(0, Math.min(8, tok.length)));
    });
    if (hit) insights.push('Autorun target/plan matches project target naming.');
  }

  const plateAngle = primary ? bestPlateAngle(primary) : null;
  let plateAngleOk = null;
  let plateAngleDiff = null;
  if (plateAngle != null && refCaaDeg != null) {
    plateAngleDiff = caaAngleDiffDeg(plateAngle, refCaaDeg);
    plateAngleOk = caaMatchesFramer(plateAngle, refCaaDeg, 10);
    if (plateAngleOk === false) {
      softWarnings.push(
        `Session log plate-solve angle ${plateAngle.toFixed(1)}° ≠ Target Framer CAA ${refCaaDeg}° `
        + `(Δ ${plateAngleDiff != null ? plateAngleDiff.toFixed(1) : '?'}°; allow ±10° or 180°±10°)`
      );
    } else if (plateAngleOk === true) {
      insights.push(`Plate-solve angle ${plateAngle.toFixed(1)}° matches Target Framer CAA ${refCaaDeg}°.`);
    }
  }

  const plannedLights = primary ? plannedLightsForFilter(primary, shootFilter) : 0;
  const loggedExposures = primary ? exposuresSeenForFilter(primary, shootFilter) : 0;
  if (plannedLights > 0 && lightCount != null && Number.isFinite(lightCount)) {
    if (lightCount < plannedLights) {
      softWarnings.push(
        `Autorun planned ${plannedLights} ${shootFilter || ''} light(s); dump has ${lightCount} for this filter`
          + (loggedExposures ? ` (log counted ${loggedExposures} exposures)` : '')
      );
    } else if (lightCount > plannedLights + 2) {
      insights.push(
        `Dump has ${lightCount} lights vs Autorun plan ${plannedLights} — extra frames or multi-session merge.`
      );
    } else {
      insights.push(`Light count matches Autorun plan (${plannedLights}).`);
    }
  }

  const filterFails = [];
  for (const s of autorunSessions) {
    for (const fc of s.filterChanges || []) {
      if (fc.failed) filterFails.push(fc);
    }
  }
  if (filterFails.length) {
    softWarnings.push(
      `Autorun filter change failed (${filterFails.length}×) — check wheel / missing flats for that filter`
    );
  }

  const afFails = autorunSessions.some((s) => s.flags.afFail);
  if (afFails) softWarnings.push('Autorun autofocus reported a failure this night.');

  const paused = autorunSessions.some((s) => s.flags.paused && !s.flags.finishedClean);
  if (paused) {
    insights.push('Autorun was paused or stopped manually — session may be incomplete.');
  }

  // Merge PHD2 (prefer largest frame count for the night)
  const guide = phd2List.slice().sort((a, b) => (b.frameCount || 0) - (a.frameCount || 0))[0] || null;
  if (guide) {
    if (guide.quality === 'poor') {
      softWarnings.push(
        `Guide quality poor`
        + (guide.rmsTotalArcsec != null ? ` (RMS ~${guide.rmsTotalArcsec.toFixed(2)}″)` : '')
        + (guide.starLost ? `, ${guide.starLost} star-lost` : '')
        + (guide.settleFail ? `, ${guide.settleFail} settle fail` : '')
        + ' — expect more culls'
      );
    } else if (guide.quality === 'fair') {
      insights.push(
        `Guide quality fair`
        + (guide.rmsTotalArcsec != null ? ` (RMS ~${guide.rmsTotalArcsec.toFixed(2)}″)` : '')
      );
    } else if (guide.quality === 'good') {
      insights.push(
        `Guide quality good`
        + (guide.rmsTotalArcsec != null ? ` (RMS ~${guide.rmsTotalArcsec.toFixed(2)}″)` : '')
      );
    }
  }

  const autofocus = [];
  for (const s of autorunSessions) {
    for (const af of s.autofocus || []) {
      if (shootFilter && af.filter && !filtersMatch(af.filter, shootFilter)) continue;
      autofocus.push(af);
    }
  }

  const digest = {
    nightDate,
    shootFilter,
    planName: primary && primary.plans && primary.plans[0] ? primary.plans[0] : null,
    targets: primary ? [...new Set(primary.targets || [])] : [],
    plateAngleDeg: plateAngle,
    plateAngleOk,
    plateAngleDiffDeg: plateAngleDiff,
    plannedLights: plannedLights || null,
    loggedExposures: loggedExposures || null,
    ditherCount: primary ? primary.ditherCount : null,
    autofocus: autofocus.map((a) => ({
      ok: a.ok,
      eafPos: a.eafPos,
      filter: a.filter,
      at: a.at,
    })),
    filterFails: filterFails.map((f) => ({ from: f.from, to: f.to, at: f.at })),
    flags: primary ? { ...primary.flags } : {},
    guide: guide ? {
      quality: guide.quality,
      rmsTotalArcsec: guide.rmsTotalArcsec != null
        ? Math.round(guide.rmsTotalArcsec * 100) / 100
        : null,
      rmsRaArcsec: guide.rmsRaArcsec != null ? Math.round(guide.rmsRaArcsec * 100) / 100 : null,
      rmsDecArcsec: guide.rmsDecArcsec != null ? Math.round(guide.rmsDecArcsec * 100) / 100 : null,
      frameCount: guide.frameCount,
      settleFail: guide.settleFail,
      settleOk: guide.settleOk,
      starLost: guide.starLost,
      fileName: guide.fileName,
    } : null,
    autorunFiles: [...new Set(autorunSessions.map((s) => s.fileName).filter(Boolean))],
    phd2Files: [...new Set(phd2List.map((s) => s.fileName).filter(Boolean))],
    timeline: primary ? primary.timeline.slice(0, 24) : [],
    parsedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    sourceRoot,
    nightDate,
    shootFilter,
    logDirs,
    autorunSessions,
    phd2: phd2List,
    digest,
    softWarnings,
    insights,
    primary,
    guide,
  };
}

/**
 * Copy matched log text files into each shoot folder under session-logs/.
 * Keeps originals on the ASIAIR dump untouched.
 */
async function copySessionLogsToShootDirs(shootDirs, insight) {
  const copied = [];
  if (!insight || !Array.isArray(shootDirs) || !shootDirs.length) return copied;

  const sources = [];
  for (const s of insight.autorunSessions || []) {
    if (s.path) sources.push({ path: s.path, kind: s.kind || 'autorun' });
  }
  for (const g of insight.phd2 || []) {
    if (g.path) sources.push({ path: g.path, kind: 'phd2' });
  }
  if (!sources.length) return copied;

  for (const shootDir of shootDirs) {
    const destRoot = path.join(shootDir, 'session-logs');
    await fsp.mkdir(destRoot, { recursive: true });
    // Compact digest JSON for the night
    if (insight.digest) {
      const digestPath = path.join(destRoot, 'session-digest.json');
      await fsp.writeFile(digestPath, JSON.stringify(insight.digest, null, 2), 'utf8');
      copied.push({ from: null, to: digestPath, kind: 'digest' });
    }
    for (const src of sources) {
      const base = path.basename(src.path);
      const dest = path.join(destRoot, base);
      try {
        await fsp.copyFile(src.path, dest);
        copied.push({ from: src.path, to: dest, kind: src.kind });
      } catch (err) {
        copied.push({ from: src.path, to: dest, kind: src.kind, error: String(err.message || err) });
      }
    }
  }
  return copied;
}

/** Resolve session-logs folder under a staged shoot directory. */
function resolveShootSessionLogsDir(shootDir) {
  if (!shootDir) return null;
  return path.join(String(shootDir), 'session-logs');
}

/**
 * List text/json logs archived beside a shoot.
 * @returns {{ ok, dir, files: [{ name, path, kind, size }] }}
 */
async function listShootSessionLogs(shootDir) {
  const dir = resolveShootSessionLogsDir(shootDir);
  if (!dir) return { ok: false, error: 'shootDir required', dir: null, files: [] };
  try {
    const st = await fsp.stat(dir);
    if (!st.isDirectory()) return { ok: false, error: 'session-logs is not a folder', dir, files: [] };
  } catch (_) {
    return { ok: true, dir, files: [], missing: true };
  }
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch (err) {
    return { ok: false, error: String(err.message || err), dir, files: [] };
  }
  const files = [];
  for (const name of names) {
    if (!/\.(txt|json)$/i.test(name)) continue;
    const full = path.join(dir, name);
    let size = 0;
    try {
      size = (await fsp.stat(full)).size;
    } catch (_) { /* */ }
    let kind = 'other';
    if (/session-digest\.json/i.test(name)) kind = 'digest';
    else if (/^PHD2_GuideLog_/i.test(name)) kind = 'phd2';
    else if (/^(Autorun_Log_|Plan_Log_)/i.test(name)) kind = /Plan_Log_/i.test(name) ? 'plan' : 'autorun';
    files.push({ name, path: full, kind, size });
  }
  files.sort((a, b) => {
    const order = { digest: 0, autorun: 1, plan: 1, phd2: 2, other: 3 };
    return (order[a.kind] - order[b.kind]) || a.name.localeCompare(b.name);
  });
  return { ok: true, dir, files, missing: files.length === 0 };
}

const SESSION_LOG_READ_MAX = 400 * 1024; // ~400KB in viewer

/**
 * Read one archived session log (truncated for huge PHD2 files).
 */
async function readShootSessionLog(filePath, opts = {}) {
  const maxBytes = opts.maxBytes != null ? Number(opts.maxBytes) : SESSION_LOG_READ_MAX;
  if (!filePath) return { ok: false, error: 'path required' };
  const target = path.resolve(String(filePath));
  // Only allow reading under a …/session-logs/… folder (or basename digest/autorun/phd2)
  const base = path.basename(target);
  const parent = path.basename(path.dirname(target));
  if (!/^session-logs$/i.test(parent)) {
    return { ok: false, error: 'Refusing to read outside session-logs/' };
  }
  try {
    const st = await fsp.stat(target);
    if (!st.isFile()) return { ok: false, error: 'Not a file' };
    const fh = await fsp.open(target, 'r');
    try {
      const toRead = Math.min(st.size, Math.max(1024, maxBytes));
      const buf = Buffer.alloc(toRead);
      const { bytesRead } = await fh.read(buf, 0, toRead, 0);
      const text = buf.slice(0, bytesRead).toString('utf8');
      return {
        ok: true,
        path: target,
        name: base,
        size: st.size,
        truncated: st.size > bytesRead,
        text,
      };
    } finally {
      await fh.close();
    }
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** Compact HTML-friendly lines for UI (no tags). */
function formatSessionLogSummaryLines(digest) {
  if (!digest) return [];
  const lines = [];
  if (digest.planName) lines.push(`Plan: ${digest.planName}`);
  if (digest.targets && digest.targets.length) lines.push(`Target: ${digest.targets.join(', ')}`);
  if (digest.plateAngleDeg != null) {
    const caa = digest.plateAngleOk === true
      ? 'matches CAA'
      : (digest.plateAngleOk === false ? '≠ CAA' : 'CAA n/a');
    lines.push(`Plate angle: ${Number(digest.plateAngleDeg).toFixed(1)}° (${caa})`);
  }
  if (digest.plannedLights != null) lines.push(`Autorun lights: ${digest.plannedLights}`);
  if (digest.autofocus && digest.autofocus.length) {
    const last = digest.autofocus[digest.autofocus.length - 1];
    if (last.eafPos != null) lines.push(`AF EAF: ${last.eafPos}${last.ok ? '' : ' (fail)'}`);
  }
  if (digest.guide) {
    const g = digest.guide;
    lines.push(
      `Guide: ${g.quality}`
      + (g.rmsTotalArcsec != null ? ` · RMS ${g.rmsTotalArcsec}″` : '')
      + (g.starLost ? ` · ${g.starLost} lost` : '')
    );
  }
  if (digest.filterFails && digest.filterFails.length) {
    lines.push(`Filter fails: ${digest.filterFails.length}`);
  }
  if (digest.flags && digest.flags.paused && !digest.flags.finishedClean) {
    lines.push('Autorun paused / incomplete');
  }
  return lines;
}

module.exports = {
  AUTORUN_FILTER_LETTER,
  normalizeFilterLetter,
  filtersMatch,
  astronomicalNight,
  nightWindow,
  caaAngleDiffDeg,
  caaMatchesFramer,
  findLogDirs,
  listSessionLogFiles,
  parseAutorunLog,
  parsePhd2GuideLog,
  classifyGuideQuality,
  sessionMatchesNight,
  plannedLightsForFilter,
  buildSessionLogInsight,
  copySessionLogsToShootDirs,
  resolveShootSessionLogsDir,
  listShootSessionLogs,
  readShootSessionLog,
  SESSION_LOG_READ_MAX,
  formatSessionLogSummaryLines,
};
