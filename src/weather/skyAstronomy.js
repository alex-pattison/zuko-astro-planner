'use strict';

/**
 * Sky astronomy for Moon/Sun cards — landscape as of 2026:
 *
 * - Astrospheric POST /api/Moon (10 credits): illumination, alt/az, next phases.
 *   Cached ~24 hours — phase/illumination don't need sub-daily refreshes.
 * - Open-Meteo daily: sunrise/sunset/moonrise/moonset/moon_phase (free, 16 days).
 * - Local SunCalc-style math lives in the renderer for offline times/timeline.
 * - Visual: NASA SVS frames bundled under vendor/moon-cycle (renderer).
 */

const fs = require('fs');
const path = require('path');

const ASTROSPHERIC_MOON_URL = 'https://v2-api-public.astrospheric.com/api/Moon';
const MOON_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // phase/% lit change ~daily; 24h is enough
const OM_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MOON_API_COST = 10;

let diskCacheDir = null;
const moonMem = new Map();
const omMem = new Map();

function setAstronomyCacheDir(dir) {
  diskCacheDir = dir ? path.resolve(dir) : null;
}

function getApiKey() {
  return String(process.env.ASTROSPHERIC_API_KEY || '').trim();
}

function locKey(lat, lon) {
  return Number(lat).toFixed(3) + ',' + Number(lon).toFixed(3);
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

function isFresh(fetchedAt, maxAgeMs, now = Date.now()) {
  if (!fetchedAt) return false;
  const t = new Date(fetchedAt).getTime();
  return Number.isFinite(t) && now - t < maxAgeMs;
}

function moonCachePath(key) {
  if (!diskCacheDir) return null;
  const safe = key.replace(/[^0-9.,-]/g, '_');
  return path.join(diskCacheDir, `astrospheric-moon-${safe}.json`);
}

function omCachePath(key) {
  if (!diskCacheDir) return null;
  const safe = key.replace(/[^0-9.,-]/g, '_');
  return path.join(diskCacheDir, `open-meteo-astro-${safe}.json`);
}

function readJsonCache(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonCache(file, payload) {
  if (!file || !payload) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.warn('astronomy cache write failed:', err && err.message ? err.message : err);
  }
}

function touchCreditSnapshot(body) {
  if (!diskCacheDir || !body) return;
  const rem =
    body.APICreditsRemaining != null
      ? body.APICreditsRemaining
      : body.APICreditsRemainingToday;
  if (rem == null) return;
  const file = path.join(diskCacheDir, 'astrospheric-credits.json');
  try {
    let prev = {};
    if (fs.existsSync(file)) {
      try {
        prev = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
      } catch {
        prev = {};
      }
    }
    const moonCost =
      body.APICreditCostOfCall != null ? Number(body.APICreditCostOfCall) : MOON_API_COST;
    // Same monthly pool as GetForecastData — update remaining only.
    // Do NOT overwrite costPerPull: the UI "requests remaining" divider is forecast
    // pull size (~65). Moon is a separate 10-credit call on that pool.
    const forecastPullCost =
      prev.costPerPull != null && Number(prev.costPerPull) > 0
        ? Number(prev.costPerPull)
        : prev.costOfCall != null && Number(prev.costOfCall) >= 50
          ? Number(prev.costOfCall)
          : null;
    const remNum = Number(rem);
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          ...prev,
          creditsRemaining: remNum,
          ...(forecastPullCost != null ? { costPerPull: forecastPullCost } : {}),
          lastMoonCost: moonCost,
          lastMoonAt: new Date().toISOString(),
          pullsRemaining:
            Number.isFinite(remNum) && forecastPullCost > 0
              ? Math.floor(remNum / forecastPullCost)
              : prev.pullsRemaining,
          savedAt: new Date().toISOString(),
          lastSource: 'moon',
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (_) {
    /* ignore */
  }
}

function normalizeMoonPayload(body, fetchedAt, cached) {
  if (!body || typeof body !== 'object') return null;
  const nextPhases = Array.isArray(body.NextPhases)
    ? body.NextPhases.map((p) => ({
        phase: p.Phase || p.phase || null,
        timeUtc: p.TimeUTC || p.timeUtc || null,
      })).filter((p) => p.phase && p.timeUtc)
    : [];
  return {
    ok: true,
    source: 'astrospheric-moon',
    cached: !!cached,
    fetchedAt: fetchedAt || new Date().toISOString(),
    illuminationPercent:
      body.IlluminationPercent != null ? Number(body.IlluminationPercent) : null,
    phaseAngle: body.PhaseAngle != null ? Number(body.PhaseAngle) : null,
    magnitude: body.Magnitude != null ? Number(body.Magnitude) : null,
    distanceKm: body.DistanceKm != null ? Number(body.DistanceKm) : null,
    azimuth: body.Azimuth != null ? Number(body.Azimuth) : null,
    altitude: body.Altitude != null ? Number(body.Altitude) : null,
    isAboveHorizon: body.IsAboveHorizon == null ? null : !!body.IsAboveHorizon,
    timeUtc: body.TimeUTC || null,
    nextPhases,
    creditCost:
      body.APICreditCostOfCall != null ? Number(body.APICreditCostOfCall) : MOON_API_COST,
  };
}

async function fetchAstrosphericMoon(lat, lon, opts = {}) {
  const forceRefresh = !!(opts && opts.forceRefresh);
  const cacheOnly = !!(opts && opts.cacheOnly);
  const key = locKey(lat, lon);

  const tryCached = () => {
    const mem = moonMem.get(key);
    if (mem && mem.payload && isFresh(mem.fetchedAt, MOON_CACHE_MAX_AGE_MS)) {
      return { ...mem.payload, cached: true };
    }
    const disk = readJsonCache(moonCachePath(key));
    if (disk && disk.payload && isFresh(disk.fetchedAt, MOON_CACHE_MAX_AGE_MS)) {
      moonMem.set(key, { fetchedAt: disk.fetchedAt, payload: disk.payload });
      return { ...disk.payload, cached: true };
    }
    // Stale is still useful offline
    if (mem && mem.payload) return { ...mem.payload, cached: true, stale: true };
    if (disk && disk.payload) {
      return { ...disk.payload, cached: true, stale: true };
    }
    return null;
  };

  if (cacheOnly) {
    const hit = tryCached();
    if (hit) return { ...hit, offline: true };
    return { ok: false, error: 'No cached moon data', offline: true };
  }

  if (!forceRefresh) {
    const hit = tryCached();
    if (hit && !hit.stale) return hit;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    const hit = tryCached();
    if (hit) return { ...hit, primaryError: 'Astrospheric API key not configured' };
    return { ok: false, error: 'Astrospheric API key not configured' };
  }

  let longitude = Number(lon);
  if (longitude > 180) longitude -= 360;

  try {
    const res = await fetch(ASTROSPHERIC_MOON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        APIKey: apiKey,
        Latitude: Number(lat),
        Longitude: longitude,
      }),
    });
    const text = await res.text();
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
      const hit = tryCached();
      if (hit) return { ...hit, refreshError: String(msg) };
      return { ok: false, error: String(msg), status: res.status };
    }
    const fetchedAt = new Date().toISOString();
    const payload = normalizeMoonPayload(body, fetchedAt, false);
    if (!payload) {
      const hit = tryCached();
      if (hit) return { ...hit, refreshError: 'Unexpected Moon response' };
      return { ok: false, error: 'Unexpected Moon response' };
    }
    moonMem.set(key, { fetchedAt, payload });
    writeJsonCache(moonCachePath(key), { fetchedAt, payload });
    touchCreditSnapshot(body);
    return payload;
  } catch (err) {
    const hit = tryCached();
    if (hit) {
      return {
        ...hit,
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
}

async function fetchOpenMeteoAstronomy(lat, lon, opts = {}) {
  const forceRefresh = !!(opts && opts.forceRefresh);
  const cacheOnly = !!(opts && opts.cacheOnly);
  const key = locKey(lat, lon);

  const tryCached = () => {
    const mem = omMem.get(key);
    if (mem && mem.daily && isFresh(mem.fetchedAt, OM_CACHE_MAX_AGE_MS)) {
      return { ok: true, daily: mem.daily, timezone: mem.timezone, fetchedAt: mem.fetchedAt, cached: true, source: 'open-meteo' };
    }
    const disk = readJsonCache(omCachePath(key));
    if (disk && disk.daily && isFresh(disk.fetchedAt, OM_CACHE_MAX_AGE_MS)) {
      omMem.set(key, disk);
      return { ok: true, daily: disk.daily, timezone: disk.timezone, fetchedAt: disk.fetchedAt, cached: true, source: 'open-meteo' };
    }
    if (mem && mem.daily) {
      return { ok: true, daily: mem.daily, timezone: mem.timezone, fetchedAt: mem.fetchedAt, cached: true, stale: true, source: 'open-meteo' };
    }
    if (disk && disk.daily) {
      return { ok: true, daily: disk.daily, timezone: disk.timezone, fetchedAt: disk.fetchedAt, cached: true, stale: true, source: 'open-meteo' };
    }
    return null;
  };

  if (cacheOnly) {
    const hit = tryCached();
    if (hit) return { ...hit, offline: true };
    return { ok: false, error: 'No cached Open-Meteo astronomy', offline: true, source: 'open-meteo' };
  }

  if (!forceRefresh) {
    const hit = tryCached();
    if (hit && !hit.stale) return hit;
  }

  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=' +
    encodeURIComponent(lat) +
    '&longitude=' +
    encodeURIComponent(lon) +
    '&daily=sunrise,sunset,moonrise,moonset,moon_phase' +
    '&timezone=auto&forecast_days=16';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
    const json = await res.json();
    const daily = json && json.daily;
    if (!daily || !Array.isArray(daily.time)) {
      throw new Error('Open-Meteo astronomy missing daily series');
    }
    const fetchedAt = new Date().toISOString();
    const pack = {
      fetchedAt,
      timezone: json.timezone || null,
      daily: {
        time: daily.time,
        sunrise: daily.sunrise || [],
        sunset: daily.sunset || [],
        moonrise: daily.moonrise || [],
        moonset: daily.moonset || [],
        moon_phase: daily.moon_phase || [],
      },
    };
    omMem.set(key, pack);
    writeJsonCache(omCachePath(key), pack);
    return {
      ok: true,
      daily: pack.daily,
      timezone: pack.timezone,
      fetchedAt,
      cached: false,
      source: 'open-meteo',
    };
  } catch (err) {
    const hit = tryCached();
    if (hit) {
      return {
        ...hit,
        refreshError: String(err && err.message ? err.message : err),
        offline: isNetworkError(err),
      };
    }
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      offline: isNetworkError(err),
      source: 'open-meteo',
    };
  }
}

/**
 * Combined astronomy payload for Sky Forecast moon/sun cards.
 * Moon: Astrospheric monthly (10 credits) preferred.
 * Calendar times: Open-Meteo free daily series.
 */
async function getSkyAstronomy(payload = {}) {
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  if (!(Number.isFinite(lat) && Number.isFinite(lon))) {
    return { ok: false, error: 'Invalid coordinates' };
  }
  const forceRefresh = !!payload.forceRefresh;
  const simulateOffline = !!payload.simulateOffline;
  const preferSkipAstro = !!payload.preferFallback;

  const opts = {
    forceRefresh,
    cacheOnly: simulateOffline,
  };

  const [moon, openMeteo] = await Promise.all([
    preferSkipAstro
      ? Promise.resolve({ ok: false, error: 'Astrospheric moon skipped (dev fallback)', skipped: true })
      : fetchAstrosphericMoon(lat, lon, opts),
    fetchOpenMeteoAstronomy(lat, lon, opts),
  ]);

  const ok = !!(moon && moon.ok) || !!(openMeteo && openMeteo.ok);
  return {
    ok,
    lat,
    lon,
    moon: moon || null,
    openMeteo: openMeteo || null,
    offline: !!(simulateOffline || (moon && moon.offline) || (openMeteo && openMeteo.offline)),
    sources: {
      moon: moon && moon.ok ? (moon.source || 'astrospheric-moon') : null,
      calendar: openMeteo && openMeteo.ok ? 'open-meteo' : null,
      visual: 'nasa-svs-via-moon-cycle',
    },
  };
}

module.exports = {
  setAstronomyCacheDir,
  getSkyAstronomy,
  fetchAstrosphericMoon,
  fetchOpenMeteoAstronomy,
  MOON_CACHE_MAX_AGE_MS,
  MOON_API_COST,
};
