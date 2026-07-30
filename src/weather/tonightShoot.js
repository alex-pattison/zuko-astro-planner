'use strict';

const fs = require('fs');
const path = require('path');

const ASTROSPHERIC_URL =
  'https://v2-api-public.astrospheric.com/api/GetForecastData';

/** v2 monthly allowance (resets 1st of month, midnight UTC). */
const MONTHLY_CREDITS = 29900;

/** Variables for shoot decisions (temp comes free from Open-Meteo). */
const FORECAST_VARIABLES = ['Cloud', 'Transparency', 'Seeing'];
/** Documented per-variable costs (sum = expected cost if API bills by table). */
const VARIABLE_COSTS = {
  Cloud: 15,
  Transparency: 30,
  Seeing: 20,
  Temperature: 15,
};
const EXPECTED_COST = FORECAST_VARIABLES.reduce(
  (s, name) => s + (VARIABLE_COSTS[name] || 0),
  0
);
/** ~3.5 days covers next 3 imaging nights. */
const FORECAST_LENGTH_HOURS = 84;

/** Soft-refresh Astrospheric if cached forecast is older than this. */
const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

/** In-memory cache — Astrospheric costs credits; prefer cache unless forceRefresh. */
const forecastCache = new Map();
let diskCacheDir = null;

function setForecastCacheDir(dir) {
  diskCacheDir = dir ? path.resolve(dir) : null;
}

function loadDotEnv(rootDir) {
  const envPath = path.join(rootDir, '.env');
  try {
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === '') {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn('Could not load .env:', err && err.message ? err.message : err);
  }
}

function getApiKey() {
  return String(process.env.ASTROSPHERIC_API_KEY || '').trim();
}

function maskApiKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  if (k.length <= 8) return '••••••••';
  return '••••' + k.slice(-6);
}

function getApiKeyStatus() {
  const key = getApiKey();
  return {
    configured: !!key,
    masked: key ? maskApiKey(key) : '',
    length: key ? key.length : 0,
  };
}

function clearForecastCache() {
  forecastCache.clear();
}

function nextMonthlyResetUtc(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0));
}

function daysUntilMonthlyReset(now = new Date()) {
  const ms = nextMonthlyResetUtc(now).getTime() - (now instanceof Date ? now : new Date(now)).getTime();
  return Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)));
}

function creditSnapshotPath() {
  if (!diskCacheDir) return null;
  return path.join(diskCacheDir, 'astrospheric-credits.json');
}

function readCreditSnapshot() {
  const file = creditSnapshotPath();
  if (!file || !fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.creditsRemaining == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCreditSnapshot(info) {
  const file = creditSnapshotPath();
  if (!file || !info) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          ...info,
          savedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (err) {
    console.warn('Astrospheric credit snapshot write failed:', err && err.message ? err.message : err);
  }
}

/**
 * Monthly allowance is 29900 (docs). Cost = sum of requested variable costs.
 * Live billing confirmed: Cloud+Transparency+Seeing+Temperature = 80 / pull.
 */
function creditInfo({ remaining, costOfCall, fromCache } = {}) {
  const rem =
    remaining != null && Number.isFinite(Number(remaining))
      ? Math.max(0, Number(remaining))
      : null;
  const cost =
    costOfCall != null && Number.isFinite(Number(costOfCall)) && Number(costOfCall) > 0
      ? Number(costOfCall)
      : EXPECTED_COST;
  const pullsRemaining = rem != null ? Math.floor(rem / cost) : null;
  const pullsPerMonth = Math.floor(MONTHLY_CREDITS / cost);
  const resetAt = nextMonthlyResetUtc();
  const daysUntilReset = daysUntilMonthlyReset();
  const pullsUsed =
    pullsRemaining != null ? Math.max(0, pullsPerMonth - pullsRemaining) : null;
  const info = {
    creditsRemaining: rem,
    creditsMonthlyCap: MONTHLY_CREDITS,
    costPerPull: cost,
    pullsRemaining,
    pullsPerMonth,
    pullsUsed,
    resetAtIso: resetAt.toISOString(),
    daysUntilReset,
    creditStale: !!fromCache,
    expectedVariables: FORECAST_VARIABLES.slice(),
    variableCosts: { ...VARIABLE_COSTS },
  };
  return info;
}

function getStoredCreditInfo() {
  const snap = readCreditSnapshot();
  if (!snap) {
    return creditInfo({});
  }
  return creditInfo({
    remaining: snap.creditsRemaining,
    costOfCall: snap.costPerPull || snap.costOfCall,
    fromCache: true,
  });
}

function cacheKeyFor(lat, lon) {
  let longitude = Number(lon);
  if (longitude > 180) longitude -= 360;
  return `${Number(lat).toFixed(3)},${longitude.toFixed(3)}`;
}

function isCacheFresh(fetchedAt, now = Date.now()) {
  if (!fetchedAt) return false;
  const t = new Date(fetchedAt).getTime();
  return Number.isFinite(t) && now - t < CACHE_MAX_AGE_MS;
}

function diskCachePath(cacheKey) {
  if (!diskCacheDir) return null;
  const safe = cacheKey.replace(/[^0-9.,-]/g, '_');
  return path.join(diskCacheDir, `astrospheric-v2-cache-${safe}.json`);
}

function readDiskCache(cacheKey) {
  const file = diskCachePath(cacheKey);
  if (!file || !fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || !parsed.forecast || !parsed.fetchedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDiskCache(cacheKey, forecast, fetchedAt) {
  const file = diskCachePath(cacheKey);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          fetchedAt: fetchedAt || new Date().toISOString(),
          forecast,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (err) {
    console.warn('Astrospheric disk cache write failed:', err && err.message ? err.message : err);
  }
}

/** Upsert ASTROSPHERIC_API_KEY in .env and process.env. Pass empty string to clear. */
function setApiKey(rootDir, newKey) {
  const key = String(newKey == null ? '' : newKey).trim();
  const envPath = path.join(rootDir, '.env');
  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  }
  let found = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return line;
    const name = trimmed.slice(0, eq).trim();
    if (name !== 'ASTROSPHERIC_API_KEY') return line;
    found = true;
    return key ? `ASTROSPHERIC_API_KEY=${key}` : 'ASTROSPHERIC_API_KEY=';
  });
  if (!found) {
    if (next.length && next[next.length - 1] !== '') next.push('');
    next.push(key ? `ASTROSPHERIC_API_KEY=${key}` : 'ASTROSPHERIC_API_KEY=');
  }
  fs.writeFileSync(envPath, next.join('\n').replace(/\n*$/, '\n'), 'utf8');
  process.env.ASTROSPHERIC_API_KEY = key;
  clearForecastCache();
  return getApiKeyStatus();
}

function hourValue(arr, i) {
  if (!arr || !arr[i]) return null;
  const cell = arr[i];
  if (cell && cell.Value && cell.Value.ActualValue != null) {
    return Number(cell.Value.ActualValue);
  }
  if (cell && cell.ActualValue != null) return Number(cell.ActualValue);
  if (typeof cell === 'number') return cell;
  return null;
}

function nestedMetricValue(obj) {
  if (obj == null) return null;
  if (typeof obj === 'number') return obj;
  if (obj.ActualValue != null) return Number(obj.ActualValue);
  if (obj.Value && obj.Value.ActualValue != null) return Number(obj.Value.ActualValue);
  return null;
}

function nestedMetricColor(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return obj.ValueColor || (obj.Value && obj.Value.ValueColor) || null;
}

function parseUtcStart(utcStartTime) {
  if (!utcStartTime) return null;
  // Astrospheric often returns "YYYY-MM-DD HH:MM:SS" (UTC)
  const normalized = String(utcStartTime).trim().replace(' ', 'T');
  const withZ = /Z|[+-]\d{2}:?\d{2}$/.test(normalized)
    ? normalized
    : normalized + 'Z';
  const d = new Date(withZ);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mean(nums) {
  const vals = nums.filter((n) => n != null && Number.isFinite(n));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function isNetworkError(err) {
  const msg = String(err && err.message ? err.message : err || '').toLowerCase();
  const code = String(
    (err && (err.code || (err.cause && err.cause.code))) || ''
  ).toLowerCase();
  return /fetch failed|enotfound|econnrefused|econnreset|etimedout|enetunreach|eai_again|network|getaddrinfo|socket hang up|offline/.test(
    msg + ' ' + code
  );
}

/**
 * Deep-sky shoot scoring (broadband / narrowband DSO).
 *
 * BACKLOG (not scored yet):
 * - Moon illumination penalty
 * - Angular separation between moon and imaging target
 *
 * Approach (aligned with Clear Skys–style AP profiles):
 * - Cloud is the dominant factor + hard gate when mostly overcast
 * - Transparency outweighs seeing (DSO cares about sky clarity more than steadiness)
 * - Continuous 0–100 score → RAG bands (not worst-of hard flags)
 */
function cloudSoftScore(cloud) {
  if (cloud == null || !Number.isFinite(cloud)) return 55;
  if (cloud <= 10) return 100;
  if (cloud <= 20) return 90;
  if (cloud <= 30) return 78;
  if (cloud <= 45) return 55;
  if (cloud <= 60) return 30;
  if (cloud <= 80) return 10;
  return 0;
}

function transparencySoftScore(t) {
  // Astrospheric / CDS-style: lower is better (0 excellent … 27+ opaque)
  if (t == null || !Number.isFinite(t)) return 60;
  if (t <= 5) return 100;
  if (t <= 9) return 90;
  if (t <= 13) return 75;
  if (t <= 18) return 50;
  if (t <= 23) return 28;
  if (t <= 27) return 12;
  return 0;
}

function seeingSoftScore(s) {
  // Higher is better (0–5). Down-weighted for DSO vs planetary.
  if (s == null || !Number.isFinite(s)) return 60;
  if (s >= 4.5) return 100;
  if (s >= 3.5) return 88;
  if (s >= 3) return 75;
  if (s >= 2) return 55;
  if (s >= 1) return 30;
  return 12;
}

function scoreToRag(score) {
  if (score >= 70) return 'green';
  if (score >= 45) return 'amber';
  return 'red';
}

/**
 * Score one forecast hour for deep-sky imaging.
 * Returns { rag, score } where score is 0–100.
 */
function scoreHour({ cloud, transparency, seeing }) {
  // Hard gate: mostly cloudy nights are not DSO nights.
  if (cloud != null && Number.isFinite(cloud) && cloud >= 65) {
    return { rag: 'red', score: Math.min(25, cloudSoftScore(cloud)) };
  }

  const c = cloudSoftScore(cloud);
  const t = transparencySoftScore(transparency);
  const s = seeingSoftScore(seeing);
  // DSO weights: cloud 55%, transparency 35%, seeing 10%
  let score = c * 0.55 + t * 0.35 + s * 0.1;

  // Soft cap: significant cloud keeps the hour out of "Shoot"
  if (cloud != null && Number.isFinite(cloud) && cloud >= 40) {
    score = Math.min(score, 68);
  }

  score = Math.round(Math.max(0, Math.min(100, score)));
  return { rag: scoreToRag(score), score };
}

function worstRag(a, b) {
  const rank = { green: 0, amber: 1, red: 2 };
  return rank[b] > rank[a] ? b : a;
}

function aggregateRags(rags) {
  if (!rags.length) return 'amber';
  const reds = rags.filter((r) => r === 'red').length;
  const greens = rags.filter((r) => r === 'green').length;
  const n = rags.length;
  if (reds / n >= 0.45) return 'red';
  if (greens / n >= 0.55 && reds === 0) return 'green';
  if (greens / n >= 0.7) return 'green';
  return 'amber';
}

function localHour24(date, timeZone = 'America/New_York') {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 12;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'America/New_York',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(d);
    const h = parts.find((p) => p.type === 'hour');
    return h != null ? Number(h.value) : d.getHours();
  } catch {
    return d.getHours();
  }
}

/**
 * Evening session (local noon→midnight) weighs more than post-midnight.
 * Matches imaging before packing up — overnight hours matter less.
 */
function imagingHourWeight(at, timeZone) {
  const h = localHour24(at, timeZone);
  return h >= 12 ? 2.25 : 0.5;
}

function aggregateHourRags(hours, timeZone) {
  if (!hours || !hours.length) return 'amber';
  let scoreSum = 0;
  let weightSum = 0;
  let redW = 0;
  for (const h of hours) {
    const at = h.at || (h.iso ? new Date(h.iso) : null);
    const w = imagingHourWeight(at || new Date(), timeZone);
    weightSum += w;
    const sc = h.score != null && Number.isFinite(h.score)
      ? h.score
      : (h.rag === 'green' ? 80 : h.rag === 'red' ? 25 : 55);
    scoreSum += sc * w;
    if (h.rag === 'red') redW += w;
  }
  if (weightSum <= 0) return 'amber';
  // Enough solidly-bad hours → Skip regardless of average
  if (redW / weightSum >= 0.45) return 'red';
  return scoreToRag(scoreSum / weightSum);
}

function ragLabel(rag) {
  if (rag === 'green') return 'Shoot';
  if (rag === 'red') return 'Skip';
  return 'Marginal';
}

function transparencyLabel(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v <= 5) return 'Excellent';
  if (v <= 9) return 'Above avg';
  if (v <= 13) return 'Average';
  if (v <= 23) return 'Below avg';
  if (v <= 27) return 'Poor';
  return 'Cloudy';
}

function seeingLabel(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const n = Math.round(v);
  if (n <= 0) return 'Cloudy';
  if (n === 1) return 'Poor';
  if (n === 2) return 'Below avg';
  if (n === 3) return 'Average';
  if (n === 4) return 'Above avg';
  return 'Excellent';
}

function kToC(k) {
  if (k == null || !Number.isFinite(k)) return null;
  return k - 273.15;
}

function cToF(c) {
  if (c == null || !Number.isFinite(c)) return null;
  return (c * 9) / 5 + 32;
}

function msToMph(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  return ms * 2.236936;
}

function windDirLabel(deg) {
  if (deg == null || !Number.isFinite(deg)) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[i];
}

function hourColor(arr, i) {
  if (!arr || !arr[i] || !arr[i].Value) return null;
  return arr[i].Value.ValueColor || null;
}

function parseForecastHourTime(entry, fallbackStart, index) {
  if (entry && entry.UTCForecastHour) {
    const d = new Date(entry.UTCForecastHour);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (fallbackStart) {
    return new Date(fallbackStart.getTime() + index * 3600 * 1000);
  }
  return null;
}

function toTempF(raw) {
  if (raw == null || !Number.isFinite(raw)) return null;
  // v2 may return Kelvin (>150) or Celsius
  const c = raw > 150 ? raw - 273.15 : raw;
  return Math.round(cToF(c));
}

function extractSeries(forecast) {
  // v2 public API: HourlyForecast[{ Cloud, Transparency, Seeing, Temperature, UTCForecastHour }]
  // Older / docs shape: separate Cloud / Transparency / … arrays
  // v1 legacy cache: RDPS_* arrays
  if (Array.isArray(forecast.HourlyForecast) && forecast.HourlyForecast.length) {
    const hours = [];
    for (let i = 0; i < forecast.HourlyForecast.length; i++) {
      const row = forecast.HourlyForecast[i];
      if (!row) continue;
      const t = parseForecastHourTime(row, null, i);
      if (!t) continue;
      const cloud = nestedMetricValue(row.Cloud);
      const transparency = nestedMetricValue(row.Transparency);
      const seeing = nestedMetricValue(row.Seeing);
      const tempRaw = nestedMetricValue(row.Temperature);
      const scored = scoreHour({ cloud, transparency, seeing });
      hours.push({
        at: t,
        iso: t.toISOString(),
        hourOffset: row.HourOffset != null ? Number(row.HourOffset) : i,
        cloud,
        cloudColor: nestedMetricColor(row.Cloud),
        transparency,
        transparencyColor: nestedMetricColor(row.Transparency),
        transparencyLabel: transparencyLabel(transparency),
        seeing,
        seeingColor: nestedMetricColor(row.Seeing),
        seeingLabel: seeingLabel(seeing),
        tempF: toTempF(tempRaw),
        tempColor: nestedMetricColor(row.Temperature),
        rag: scored.rag,
        score: scored.score,
      });
    }
    return hours;
  }

  const cloudArr = forecast.Cloud || forecast.RDPS_CloudCover;
  const transArr = forecast.Transparency || forecast.Astrospheric_Transparency;
  const seeArr = forecast.Seeing || forecast.Astrospheric_Seeing;
  const tempArr = forecast.Temperature || forecast.RDPS_Temperature;
  const n = (cloudArr && cloudArr.length) || 0;
  const hours = [];
  if (!n) return hours;

  const start = parseUtcStart(forecast.UTCStartTime) ||
    (cloudArr[0] && cloudArr[0].UTCForecastHour
      ? new Date(cloudArr[0].UTCForecastHour)
      : null);

  for (let i = 0; i < n; i++) {
    const t = parseForecastHourTime(cloudArr[i], start, i);
    if (!t) continue;
    const cloud = hourValue(cloudArr, i);
    const transparency = hourValue(transArr, i);
    const seeing = hourValue(seeArr, i);
    const tempRaw = hourValue(tempArr, i);
    const scored = scoreHour({ cloud, transparency, seeing });

    hours.push({
      at: t,
      iso: t.toISOString(),
      hourOffset: cloudArr[i] && cloudArr[i].HourOffset != null
        ? Number(cloudArr[i].HourOffset)
        : i,
      cloud,
      cloudColor: hourColor(cloudArr, i),
      transparency,
      transparencyColor: hourColor(transArr, i),
      transparencyLabel: transparencyLabel(transparency),
      seeing,
      seeingColor: hourColor(seeArr, i),
      seeingLabel: seeingLabel(seeing),
      tempF: toTempF(tempRaw),
      tempColor: hourColor(tempArr, i),
      rag: scored.rag,
      score: scored.score,
    });
  }
  return hours;
}

function findBestWindows(hours) {
  const windows = [];
  let start = null;
  let prev = null;
  let count = 0;
  for (const h of hours) {
    if (h.rag === 'green') {
      if (!start) {
        start = h;
        count = 0;
      }
      prev = h;
      count += 1;
    } else if (start) {
      windows.push({
        startIso: start.iso,
        endIso: new Date(
          (prev.at || new Date(prev.iso)).getTime() + 3600 * 1000
        ).toISOString(),
        hours: count,
      });
      start = null;
      prev = null;
      count = 0;
    }
  }
  if (start && prev) {
    windows.push({
      startIso: start.iso,
      endIso: new Date(
        (prev.at || new Date(prev.iso)).getTime() + 3600 * 1000
      ).toISOString(),
      hours: count,
    });
  }
  return windows.sort((a, b) => b.hours - a.hours);
}

function scoreAstrosphericWindow(forecast, windowStart, windowEnd) {
  return scoreAstrosphericWindows(forecast, [
    { start: windowStart, end: windowEnd },
  ]);
}

function serializeHour(h) {
  return {
    iso: h.iso,
    hourOffset: h.hourOffset,
    cloud: h.cloud != null ? Math.round(h.cloud) : null,
    cloudColor: h.cloudColor,
    transparency:
      h.transparency != null ? Math.round(h.transparency * 10) / 10 : null,
    transparencyColor: h.transparencyColor,
    transparencyLabel: h.transparencyLabel,
    seeing: h.seeing != null ? Math.round(h.seeing * 10) / 10 : null,
    seeingColor: h.seeingColor,
    seeingLabel: h.seeingLabel,
    tempF: h.tempF,
    tempColor: h.tempColor,
    precipChance: h.precipChance != null ? Math.round(h.precipChance) : null,
    rag: h.rag,
    score: h.score != null ? Math.round(h.score) : null,
  };
}

function nightAverages(hours) {
  const avgCloud = mean(hours.map((h) => h.cloud));
  const avgTrans = mean(hours.map((h) => h.transparency));
  const avgSeeing = mean(hours.map((h) => h.seeing));
  const avgTempF = mean(hours.map((h) => h.tempF));
  const avgPrecip = mean(hours.map((h) => h.precipChance));
  return {
    cloud: avgCloud != null ? Math.round(avgCloud) : null,
    transparency: avgTrans != null ? Math.round(avgTrans * 10) / 10 : null,
    transparencyLabel: transparencyLabel(avgTrans),
    seeing: avgSeeing != null ? Math.round(avgSeeing * 10) / 10 : null,
    seeingLabel: seeingLabel(avgSeeing),
    tempF: avgTempF != null ? Math.round(avgTempF) : null,
    precipChance: avgPrecip != null ? Math.round(avgPrecip) : null,
  };
}

function scoreAstrosphericWindows(forecast, windows) {
  const ranges = (windows || [])
    .map((w) => ({
      start: w.start instanceof Date ? w.start : new Date(w.startIso || w.start),
      end: w.end instanceof Date ? w.end : new Date(w.endIso || w.end),
      label: w.label || null,
    }))
    .filter((w) => !Number.isNaN(w.start.getTime()) && !Number.isNaN(w.end.getTime()));

  if (!ranges.length) {
    return { ok: false, error: 'No valid imaging windows' };
  }

  const timeZone = forecast.TimeZone || 'America/New_York';
  const inRange = (t) => ranges.some((w) => t >= w.start && t < w.end);
  const hours = extractSeries(forecast).filter((h) => inRange(h.at));
  if (!hours.length) {
    return {
      ok: false,
      error: 'No Astrospheric hours in the requested imaging windows',
    };
  }

  const rag = aggregateHourRags(hours, timeZone);
  const avgCloud = mean(hours.map((h) => h.cloud));
  const avgTrans = mean(hours.map((h) => h.transparency));
  const avgSeeing = mean(hours.map((h) => h.seeing));
  const avgTempF = mean(hours.map((h) => h.tempF));
  const greenHours = hours.filter((h) => h.rag === 'green').length;
  const redHours = hours.filter((h) => h.rag === 'red').length;

  const nightSummaries = ranges.map((w, idx) => {
    const nh = hours.filter((h) => h.at >= w.start && h.at < w.end);
    const nRag = nh.length ? aggregateHourRags(nh, timeZone) : 'amber';
    return {
      label: w.label || 'Night ' + (idx + 1),
      startIso: w.start.toISOString(),
      endIso: w.end.toISOString(),
      hoursScored: nh.length,
      rag: nRag,
      labelGo: ragLabel(nRag),
      greenHours: nh.filter((h) => h.rag === 'green').length,
      redHours: nh.filter((h) => h.rag === 'red').length,
      bestWindows: findBestWindows(nh),
      averages: nightAverages(nh),
      hours: nh.map(serializeHour),
    };
  });

  // Primary recommendation = first night (tonight / next upcoming)
  const primary = nightSummaries[0] || null;
  const remaining =
    forecast.APICreditsRemaining != null
      ? Number(forecast.APICreditsRemaining)
      : forecast.APICreditsRemainingToday != null
        ? Number(forecast.APICreditsRemainingToday)
        : null;
  const costOfCall =
    forecast.APICreditCostOfCall != null
      ? Number(forecast.APICreditCostOfCall)
      : null;

  return {
    ok: true,
    rag: primary ? primary.rag : rag,
    label: primary ? primary.labelGo : ragLabel(rag),
    source: 'astrospheric',
    fallback: false,
    hoursScored: hours.length,
    greenHours,
    redHours,
    bestWindows: findBestWindows(hours),
    nights: nightSummaries,
    averages: {
      cloud: avgCloud != null ? Math.round(avgCloud) : null,
      transparency: avgTrans != null ? Math.round(avgTrans * 10) / 10 : null,
      transparencyLabel: transparencyLabel(avgTrans),
      seeing: avgSeeing != null ? Math.round(avgSeeing * 10) / 10 : null,
      seeingLabel: seeingLabel(avgSeeing),
      tempF: avgTempF != null ? Math.round(avgTempF) : null,
      precipChance: null,
    },
    creditsRemaining: remaining,
    costOfCall,
    hours: hours.map(serializeHour),
  };
}

async function fetchAstrospheric(lat, lon, apiKey, opts = {}) {
  const forceRefresh = !!(opts && opts.forceRefresh);
  const cacheOnly = !!(opts && opts.cacheOnly);
  let longitude = Number(lon);
  if (longitude > 180) longitude -= 360;

  const cacheKey = cacheKeyFor(lat, longitude);

  const tryCached = () => {
    const mem = forecastCache.get(cacheKey);
    if (
      mem &&
      mem.forecast &&
      (Array.isArray(mem.forecast.HourlyForecast) || Array.isArray(mem.forecast.Cloud))
    ) {
      return {
        ok: true,
        forecast: mem.forecast,
        cached: true,
        fetchedAt: mem.fetchedAt || null,
      };
    }
    const disk = readDiskCache(cacheKey);
    if (
      disk &&
      disk.forecast &&
      (Array.isArray(disk.forecast.HourlyForecast) || Array.isArray(disk.forecast.Cloud))
    ) {
      forecastCache.set(cacheKey, {
        at: Date.now(),
        fetchedAt: disk.fetchedAt,
        forecast: disk.forecast,
      });
      return {
        ok: true,
        forecast: disk.forecast,
        cached: true,
        fetchedAt: disk.fetchedAt,
      };
    }
    return null;
  };

  if (cacheOnly) {
    const hit = tryCached();
    if (hit) return { ...hit, offline: true };
    return { ok: false, error: 'No cached forecast', offline: true };
  }

  if (!forceRefresh) {
    const hit = tryCached();
    if (hit && isCacheFresh(hit.fetchedAt)) return hit;
  }

  let res;
  let text;
  try {
    res = await fetch(ASTROSPHERIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Latitude: Number(lat),
        Longitude: longitude,
        APIKey: apiKey,
        Variables: FORECAST_VARIABLES,
        ForecastLength: FORECAST_LENGTH_HOURS,
      }),
    });
    text = await res.text();
  } catch (err) {
    const stale = tryCached();
    if (stale) {
      return {
        ...stale,
        refreshError: String(err && err.message ? err.message : err),
        offline: isNetworkError(err),
      };
    }
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      offline: isNetworkError(err),
    };
  }

  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const msg =
      (body && (body.ErrorInfo || body.ErrorMessage || body.Message || body.error)) ||
      `HTTP ${res.status}`;
    const stale = tryCached();
    if (stale) {
      return {
        ...stale,
        refreshError: String(msg),
      };
    }
    return { ok: false, error: String(msg), status: res.status };
  }

  const hasHourly =
    body && Array.isArray(body.HourlyForecast) && body.HourlyForecast.length;
  const hasV2Arrays = body && Array.isArray(body.Cloud) && body.Cloud.length;
  const hasV1 = body && Array.isArray(body.RDPS_CloudCover) && body.RDPS_CloudCover.length;
  if (!hasHourly && !hasV2Arrays && !hasV1) {
    const stale = tryCached();
    if (stale) {
      return {
        ...stale,
        refreshError: 'Unexpected Astrospheric response shape',
      };
    }
    return {
      ok: false,
      error:
        (body && (body.ErrorInfo || body.ErrorMessage)) ||
        'Unexpected Astrospheric response shape',
      status: res.status,
    };
  }

  const fetchedAt = new Date().toISOString();
  forecastCache.set(cacheKey, { at: Date.now(), fetchedAt, forecast: body });
  writeDiskCache(cacheKey, body, fetchedAt);
  return { ok: true, forecast: body, cached: false, fetchedAt };
}

function scoreOpenMeteoWindows(hourly, windows) {
  if (!hourly || !hourly.time || !hourly.time.length) {
    return { ok: false, error: 'Open-Meteo returned no hourly data' };
  }
  const ranges = (windows || [])
    .map((w) => ({
      start: w.start instanceof Date ? w.start : new Date(w.startIso || w.start),
      end: w.end instanceof Date ? w.end : new Date(w.endIso || w.end),
      label: w.label || null,
    }))
    .filter((w) => !Number.isNaN(w.start.getTime()) && !Number.isNaN(w.end.getTime()));
  if (!ranges.length) return { ok: false, error: 'No valid imaging windows' };

  const inRange = (t) => ranges.some((w) => t >= w.start && t < w.end);
  const allRows = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]);
    if (Number.isNaN(t.getTime())) continue;
    const cloud =
      hourly.cloud_cover && hourly.cloud_cover[i] != null
        ? Number(hourly.cloud_cover[i])
        : null;
    const precip =
      hourly.precipitation_probability &&
      hourly.precipitation_probability[i] != null
        ? Number(hourly.precipitation_probability[i])
        : null;
    const tempF =
      hourly.temperature_2m && hourly.temperature_2m[i] != null
        ? Math.round(Number(hourly.temperature_2m[i]))
        : null;
    let rag = 'green';
    if (cloud != null && cloud >= 60) rag = 'red';
    else if (cloud != null && cloud >= 30) rag = 'amber';
    if (precip != null && precip >= 50) rag = worstRag(rag, 'red');
    else if (precip != null && precip >= 25) rag = worstRag(rag, 'amber');
    allRows.push({
      at: t,
      iso: t.toISOString(),
      hourOffset: i,
      cloud: cloud != null ? Math.round(cloud) : null,
      precipChance: precip != null ? Math.round(precip) : null,
      tempF,
      rag,
      transparency: null,
      seeing: null,
    });
  }

  const hours = allRows.filter((h) => inRange(h.at));
  if (!hours.length) {
    return { ok: false, error: 'No Open-Meteo hours in the requested imaging windows' };
  }

  const nightSummaries = ranges.map((w, idx) => {
    const nh = hours.filter((h) => h.at >= w.start && h.at < w.end);
    // Fallback is observational only — never issue Shoot/Skip advice
    return {
      label: w.label || 'Night ' + (idx + 1),
      startIso: w.start.toISOString(),
      endIso: w.end.toISOString(),
      hoursScored: nh.length,
      rag: null,
      labelGo: '—',
      greenHours: null,
      redHours: null,
      bestWindows: [],
      averages: nightAverages(nh),
      hours: nh.map((h) => {
        const row = serializeHour(h);
        row.rag = null;
        return row;
      }),
    };
  });
  const primary = nightSummaries[0];
  const avgCloud = mean(hours.map((h) => h.cloud));
  const avgPrecip = mean(hours.map((h) => h.precipChance));
  const avgTempF = mean(hours.map((h) => h.tempF));

  return {
    ok: true,
    rag: null,
    label: '—',
    noRag: true,
    source: 'open-meteo',
    sourceLabel: 'Open-Meteo (fallback)',
    fallback: true,
    hoursScored: hours.length,
    greenHours: null,
    redHours: null,
    bestWindows: [],
    nights: nightSummaries,
    averages: {
      cloud: avgCloud != null ? Math.round(avgCloud) : null,
      precipChance: avgPrecip != null ? Math.round(avgPrecip) : null,
      tempF: avgTempF != null ? Math.round(avgTempF) : null,
      transparency: null,
      seeing: null,
    },
    hours: hours.map((h) => {
      const row = serializeHour(h);
      row.rag = null;
      return row;
    }),
    allHours: hours.map((h) => {
      const row = serializeHour(h);
      row.rag = null;
      return row;
    }),
  };
}

function scoreOpenMeteoWindow(hourly, windowStart, windowEnd) {
  return scoreOpenMeteoWindows(hourly, [
    { start: windowStart, end: windowEnd, label: 'Tonight' },
  ]);
}

async function fetchOpenMeteo(lat, lon) {
  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=' +
    encodeURIComponent(lat) +
    '&longitude=' +
    encodeURIComponent(lon) +
    '&hourly=cloud_cover,precipitation_probability,temperature_2m' +
    '&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=4';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
  return res.json();
}

/** Attach free Open-Meteo temp + precip onto scored hours (by UTC hour). */
async function enrichHoursWithOpenMeteo(scored, lat, lon) {
  if (!scored || !scored.ok) return scored;
  try {
    const om = await fetchOpenMeteo(lat, lon);
    const hourly = om && om.hourly;
    if (!hourly || !hourly.time) return scored;
    const byHour = new Map();
    for (let i = 0; i < hourly.time.length; i++) {
      const t = new Date(hourly.time[i]);
      if (Number.isNaN(t.getTime())) continue;
      const key = t.toISOString().slice(0, 13);
      byHour.set(key, {
        temp:
          hourly.temperature_2m && hourly.temperature_2m[i] != null
            ? Math.round(Number(hourly.temperature_2m[i]))
            : null,
        precip:
          hourly.precipitation_probability &&
          hourly.precipitation_probability[i] != null
            ? Math.round(Number(hourly.precipitation_probability[i]))
            : null,
      });
    }
    const apply = (rows) => {
      if (!Array.isArray(rows)) return;
      for (const h of rows) {
        if (!h || !h.iso) continue;
        const hit = byHour.get(String(h.iso).slice(0, 13));
        if (!hit) continue;
        if (h.tempF == null && hit.temp != null) h.tempF = hit.temp;
        if (h.precipChance == null && hit.precip != null) h.precipChance = hit.precip;
      }
    };
    apply(scored.hours);
    apply(scored.allHours);
    if (Array.isArray(scored.nights)) {
      for (const n of scored.nights) {
        apply(n.hours);
        if (n.averages) {
          const avgT = mean((n.hours || []).map((h) => h.tempF));
          const avgP = mean((n.hours || []).map((h) => h.precipChance));
          if (avgT != null) n.averages.tempF = Math.round(avgT);
          if (avgP != null) n.averages.precipChance = Math.round(avgP);
        }
      }
    }
    if (scored.averages) {
      const avgT = mean((scored.hours || []).map((h) => h.tempF));
      const avgP = mean((scored.hours || []).map((h) => h.precipChance));
      if (avgT != null) scored.averages.tempF = Math.round(avgT);
      if (avgP != null) scored.averages.precipChance = Math.round(avgP);
    }
  } catch (err) {
    console.warn('Open-Meteo enrich failed:', err && err.message ? err.message : err);
  }
  return scored;
}

/** Deterministic fake Astrospheric v2 payload for UI/dev (no credits). */
function buildSyntheticForecast(lat, lon) {
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  const hours = [];
  for (let i = 0; i < FORECAST_LENGTH_HOURS; i++) {
    const t = new Date(start.getTime() + i * 3600 * 1000);
    const localH = (t.getUTCHours() - 4 + 24) % 24; // rough ET
    const evening = localH >= 18 || localH < 5;
    const wave = Math.sin((i / 12) * Math.PI);
    const cloud = evening
      ? Math.max(5, Math.min(85, 25 + wave * 35 + (i % 7) * 2))
      : Math.max(10, Math.min(95, 45 + wave * 40));
    const transparency = cloud > 60 ? 24 : cloud > 35 ? 16 : 8 + (i % 5);
    const seeing = cloud > 60 ? 1 : cloud > 35 ? 2.5 : 3.5 + (i % 3) * 0.3;
    hours.push({
      UTCForecastHour: t.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      HourOffset: i,
      Cloud: {
        ValueColor: cloud < 30 ? '#2ecc71' : cloud < 60 ? '#f1c40f' : '#e74c3c',
        ActualValue: cloud,
      },
      Transparency: { ValueColor: '#94a3b8', ActualValue: transparency },
      Seeing: { ValueColor: '#94a3b8', ActualValue: seeing },
    });
  }
  return {
    TimeZone: 'America/New_York',
    UTCMinuteOffset: -240,
    ModelTime: 'SYNTHETIC',
    HourForecastTime: start.toISOString(),
    Latitude: Number(lat),
    Longitude: Number(lon),
    IsNBMAvailable: false,
    APICreditCostOfCall: EXPECTED_COST,
    APICreditsRemaining: null,
    HourlyForecast: hours,
    _synthetic: true,
  };
}

/**
 * Recommend tonight’s shoot (astro-dark window).
 * Primary: Astrospheric. Fallback: Open-Meteo with explicit fallback flag.
 */
async function recommendTonightShoot(payload = {}) {
  const full = await getSkyForecast({
    ...payload,
    includeHours: false,
  });
  if (!full.ok && !full.rag) return full;
  const {
    hours,
    allHours,
    nights,
    meta,
    ...rest
  } = full;
  return rest;
}

function normalizeWindows(payload) {
  if (Array.isArray(payload.windows) && payload.windows.length) {
    return payload.windows.map((w, i) => ({
      start: new Date(w.startIso || w.start),
      end: new Date(w.endIso || w.end),
      label: w.label || 'Night ' + (i + 1),
    }));
  }
  return [
    {
      start: new Date(payload.windowStartIso),
      end: new Date(payload.windowEndIso),
      label: 'Tonight',
    },
  ];
}

/**
 * Full sky forecast for the Location panel + tonight recommendation.
 * Does not burn credits unless forceRefresh or no cache exists.
 */
async function getSkyForecast(payload = {}) {
  const {
    lat,
    lon,
    includeHours = true,
    forceRefresh = false,
    preferFallback = false,
    preferSynthetic = false,
    simulateOffline = false,
  } = payload;

  const windows = normalizeWindows(payload);
  if (
    !windows.length ||
    windows.some((w) => Number.isNaN(w.start.getTime()) || Number.isNaN(w.end.getTime()))
  ) {
    return { ok: false, error: 'Invalid imaging windows' };
  }
  if (!(Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)))) {
    return { ok: false, error: 'Invalid coordinates' };
  }

  const storedCredits = getStoredCreditInfo();
  const apiKey = getApiKey();
  let primaryError = null;

  // Dev: pretend the machine has no network (cache-only; no live API calls).
  if (simulateOffline) {
    if (apiKey) {
      try {
        const primary = await fetchAstrospheric(lat, lon, apiKey, {
          forceRefresh: false,
          cacheOnly: true,
        });
        if (primary && primary.ok) {
          const scored = scoreAstrosphericWindows(primary.forecast, windows);
          if (scored.ok) {
            const { hours, creditsRemaining, costOfCall, ...summary } = scored;
            let credits = getStoredCreditInfo();
            return {
              ...summary,
              ok: true,
              cached: true,
              offline: true,
              fetchedAt: primary.fetchedAt || null,
              primaryError: 'No internet connection (simulated)',
              refreshError: 'No internet connection (simulated)',
              sourceLabel: 'Astrospheric (cached · offline simulated)',
              ...credits,
              costPerPull: EXPECTED_COST,
              hours: includeHours ? hours : undefined,
              allHours: includeHours ? hours : undefined,
            };
          }
        }
      } catch (_) { /* fall through */ }
    }
    return {
      ok: false,
      error: 'No internet connection',
      primaryError: 'No internet connection (simulated)',
      offline: true,
      fallback: true,
      noRag: true,
      source: 'offline',
      sourceLabel: 'Offline (simulated)',
      clearOutsideSuggested: true,
      ...storedCredits,
    };
  }

  // Dev: synthetic Astrospheric-shaped data (no credits, full RAG UI path)
  if (preferSynthetic && !preferFallback) {
    const forecast = buildSyntheticForecast(lat, lon);
    const scored = scoreAstrosphericWindows(forecast, windows);
    if (scored.ok) {
      await enrichHoursWithOpenMeteo(scored, lat, lon);
      const { hours, creditsRemaining, costOfCall, ...summary } = scored;
      return {
        ...summary,
        ok: true,
        cached: false,
        synthetic: true,
        fetchedAt: new Date().toISOString(),
        primaryError: null,
        sourceLabel: 'Synthetic Astrospheric (dev)',
        ...storedCredits,
        costPerPull: EXPECTED_COST,
        meta: {
          timeZone: 'America/New_York',
          modelTime: 'SYNTHETIC',
          modelNote: 'Synthetic forecast for UI testing — not real Astrospheric data',
        },
        hours: includeHours ? hours : undefined,
        allHours: includeHours ? hours : undefined,
      };
    }
    primaryError = scored.error || 'Synthetic scoring failed';
  } else if (preferFallback) {
    primaryError = 'Forced Open-Meteo fallback (dev setting)';
  } else if (!apiKey) {
    primaryError = 'Astrospheric API key not configured (.env)';
  } else {
    try {
      const primary = await fetchAstrospheric(lat, lon, apiKey, { forceRefresh });
      if (primary.ok) {
        const scored = scoreAstrosphericWindows(primary.forecast, windows);
        if (scored.ok) {
          await enrichHoursWithOpenMeteo(scored, lat, lon);
          let credits = creditInfo({
            remaining: scored.creditsRemaining,
            costOfCall: scored.costOfCall,
            fromCache: !!primary.cached,
          });
          if (!primary.cached) {
            writeCreditSnapshot(credits);
          } else if (credits.creditsRemaining == null) {
            credits = getStoredCreditInfo();
          }
          const { hours, creditsRemaining, costOfCall, ...summary } = scored;
          return {
            ...summary,
            ok: true,
            cached: !!primary.cached,
            offline: !!primary.offline,
            synthetic: false,
            fetchedAt: primary.fetchedAt || null,
            refreshError: primary.refreshError || null,
            primaryError: null,
            sourceLabel: primary.offline
              ? 'Astrospheric (cached · offline)'
              : primary.cached
                ? 'Astrospheric (cached)'
                : 'Astrospheric (live)',
            ...credits,
            meta: {
              timeZone: primary.forecast.TimeZone || null,
              utcMinuteOffset:
                primary.forecast.UTCMinuteOffset != null
                  ? Number(primary.forecast.UTCMinuteOffset)
                  : null,
              modelTime: primary.forecast.ModelTime || null,
              modelNote:
                'Weather model run id (Astrospheric updates forecasts about every 6 hours)',
              localStartTime: primary.forecast.LocalStartTime || null,
              utcStartTime: primary.forecast.UTCStartTime || null,
              latitude: primary.forecast.Latitude,
              longitude: primary.forecast.Longitude,
              scales: {
                transparency: '0–27+ (lower is better; 0–5 excellent, >27 cloudy)',
                seeing: '0–5 (higher is better; 5 excellent, 0 cloudy)',
              },
            },
            hours: includeHours ? hours : undefined,
            allHours: includeHours ? hours : undefined,
          };
        }
        primaryError = scored.error || 'Astrospheric scoring failed';
      } else {
        primaryError = primary.error || 'Astrospheric request failed';
        if (primary.offline) primaryError = 'No internet connection';
      }
    } catch (err) {
      primaryError = isNetworkError(err)
        ? 'No internet connection'
        : String(err && err.message ? err.message : err);
    }
  }

  // Open-Meteo fallback path (also used by preferFallback)
  try {
    const om = await fetchOpenMeteo(lat, lon);
    const scored = scoreOpenMeteoWindows(om.hourly, windows);
    if (!scored.ok) {
      return {
        ok: false,
        error: scored.error,
        primaryError,
        fallback: true,
        noRag: true,
        source: 'open-meteo',
        sourceLabel: 'Open-Meteo (fallback)',
        clearOutsideSuggested: true,
        ...storedCredits,
      };
    }
    return {
      ...scored,
      ok: true,
      primaryError,
      note: preferFallback
        ? 'Using Open-Meteo · forced by Dev setting'
        : 'Using fallback · Astrospheric unavailable',
      fallback: true,
      noRag: true,
      clearOutsideSuggested: true,
      fetchedAt: new Date().toISOString(),
      cached: false,
      sourceLabel: preferFallback
        ? 'Open-Meteo (forced fallback)'
        : 'Open-Meteo (fallback)',
      ...storedCredits,
      meta: {
        timeZone: 'America/New_York',
        modelNote: 'Open-Meteo fallback (free · up to 4 forecast days · no transparency/seeing)',
      },
      hours: includeHours ? scored.hours : undefined,
      allHours: includeHours ? scored.allHours : undefined,
    };
  } catch (err) {
    const offline = isNetworkError(err) || /offline/i.test(String(primaryError || ''));
    return {
      ok: false,
      error: offline
        ? 'No internet connection'
        : String(err && err.message ? err.message : err),
      primaryError: primaryError || (offline ? 'No internet connection' : null),
      offline,
      fallback: true,
      noRag: true,
      source: 'open-meteo',
      sourceLabel: 'Open-Meteo (fallback)',
      clearOutsideSuggested: true,
      ...storedCredits,
    };
  }
}

module.exports = {
  loadDotEnv,
  recommendTonightShoot,
  getSkyForecast,
  getApiKey,
  getApiKeyStatus,
  setApiKey,
  clearForecastCache,
  setForecastCacheDir,
  creditInfo,
  getStoredCreditInfo,
  maskApiKey,
  // exported for unit-style checks
  scoreHour,
  aggregateRags,
  aggregateHourRags,
  imagingHourWeight,
  scoreAstrosphericWindow,
  scoreAstrosphericWindows,
};
