#!/usr/bin/env node
/**
 * QA: a failed Astrospheric pull on top of an old cache.
 * If the cache has run out before a later night, getSkyForecast must switch to
 * Open-Meteo (with the Astrospheric error) instead of leaving nights blank.
 * fetch is stubbed: no network, no credits.
 * Usage: node scripts/qa-sky-stale-cache.js
 * (Claude Code, 18 Nov 2026)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'src', 'weather', 'tonightShoot.js'));

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok ', name);
  else {
    failed += 1;
    console.error('  FAIL', name, detail == null ? '' : detail);
  }
}

const LAT = 40.716;
const LON = -73.986;
const HOUR = 3600 * 1000;
const NOW = Date.UTC(2026, 10, 18, 18, 0, 0); // Wed 18 Nov 2026, 1pm EST

const windows = [0, 1, 2].map((d) => ({
  startIso: new Date(Date.UTC(2026, 10, 18 + d, 23, 0, 0)).toISOString(),
  endIso: new Date(Date.UTC(2026, 10, 19 + d, 11, 0, 0)).toISOString(),
  label: ['Tonight', 'Thu', 'Fri'][d],
}));

function astroFixture(startMs, hours) {
  const cell = (v) => ({ Value: { ActualValue: v, ValueColor: '#000' } });
  return {
    TimeZone: 'America/New_York',
    APICreditsRemaining: 90000,
    APICreditCostOfCall: 65,
    HourlyForecast: Array.from({ length: hours }, (_, i) => ({
      UTCForecastHour: new Date(startMs + i * HOUR).toISOString(),
      HourOffset: i,
      Cloud: cell(5),
      Transparency: cell(4),
      Seeing: cell(4),
    })),
  };
}

function openMeteoFixture() {
  const start = Date.UTC(2026, 10, 18, 5, 0, 0);
  const n = 96;
  return {
    hourly: {
      time: Array.from({ length: n }, (_, i) => new Date(start + i * HOUR).toISOString()),
      cloud_cover: Array(n).fill(20),
      precipitation_probability: Array(n).fill(5),
      temperature_2m: Array(n).fill(40),
    },
  };
}

function seedCache(dir, forecast, fetchedAtMs) {
  fs.writeFileSync(
    path.join(dir, `astrospheric-v2-cache-${LAT.toFixed(3)},${LON.toFixed(3)}.json`),
    JSON.stringify({ fetchedAt: new Date(fetchedAtMs).toISOString(), forecast })
  );
}

function stubFetch(astroMode) {
  let astroCalls = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (/astrospheric/i.test(u)) {
      astroCalls += 1;
      if (astroMode === 'network') {
        const err = new Error('fetch failed');
        err.cause = { code: 'ENOTFOUND' };
        throw err;
      }
      return new Response(
        JSON.stringify({ ErrorInfo: 'API Key incorrect or not entitled to programatic access' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (/open-meteo/i.test(u)) {
      if (astroMode === 'network') {
        const err = new Error('fetch failed');
        err.cause = { code: 'ENOTFOUND' };
        throw err;
      }
      return new Response(JSON.stringify(openMeteoFixture()), { status: 200 });
    }
    throw new Error('unexpected fetch ' + u);
  };
  return () => astroCalls;
}

async function run(label, { cacheHours, astroMode }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-qa-stale-'));
  ts.clearForecastCache();
  ts.setForecastCacheDir(dir);
  process.env.ASTROSPHERIC_API_KEY = 'qa-fake-key';
  // Cache pulled 3 days ago, as Beta's was (15 Nov → 18 Nov).
  const pulledAt = NOW - 75 * HOUR;
  seedCache(dir, astroFixture(pulledAt, cacheHours), pulledAt);
  const calls = stubFetch(astroMode);
  const res = await ts.getSkyForecast({ lat: LAT, lon: LON, windows, includeHours: true });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n=== ${label} ===`);
  return { res, astroCalls: calls() };
}

(async () => {
  {
    // 82 h from 15 Nov ends 00:00 UTC 19 Nov: only an hour of tonight, nothing Thu/Fri.
    const { res, astroCalls } = await run('403 + cache that has run out → Open-Meteo', {
      cacheHours: 82,
      astroMode: '403',
    });
    check('one Astrospheric call', astroCalls === 1, astroCalls);
    check('ok', res.ok === true, res.error);
    check('source is Open-Meteo', res.source === 'open-meteo', res.source);
    check('primaryError names 403', /403/.test(res.primaryError || ''), res.primaryError);
    check('primaryError says key rejected', /rejected the API key/.test(res.primaryError || ''), res.primaryError);
    check('three nights', (res.nights || []).length === 3, (res.nights || []).length);
    check(
      'every night has hours',
      (res.nights || []).every((n) => n.hoursScored >= 12),
      (res.nights || []).map((n) => n.hoursScored).join(',')
    );
  }

  {
    // Cache long enough to reach Sat 06:00 EST: keep Astrospheric, flag the failed pull.
    const { res } = await run('403 + cache still covering all nights → keep Astrospheric', {
      cacheHours: 140,
      astroMode: '403',
    });
    check('ok', res.ok === true, res.error);
    check('source is Astrospheric', res.source === 'astrospheric', res.source);
    check('served from cache', res.cached === true);
    check('refreshError kept', /403/.test(res.refreshError || ''), res.refreshError);
    check(
      'every night has 12 hours',
      (res.nights || []).every((n) => n.hoursScored === 12),
      (res.nights || []).map((n) => n.hoursScored).join(',')
    );
  }

  {
    // No network at all: old cache is still better than nothing.
    const { res } = await run('offline + cache that has run out → keep cached Astrospheric', {
      cacheHours: 82,
      astroMode: 'network',
    });
    check('ok', res.ok === true, res.error);
    check('source is Astrospheric', res.source === 'astrospheric', res.source);
    check('marked offline', res.offline === true);
  }

  {
    // Panel windows start at astro dusk, not on the hour (e.g. 17:47 → 05:12).
    const offHour = [0, 1, 2].map((d) => ({
      startIso: new Date(Date.UTC(2026, 10, 18 + d, 22, 47, 0)).toISOString(),
      endIso: new Date(Date.UTC(2026, 10, 19 + d, 10, 12, 0)).toISOString(),
      label: 'Night ' + (d + 1),
    }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-qa-stale-'));
    ts.clearForecastCache();
    ts.setForecastCacheDir(dir);
    const pulledAt = NOW - 8 * HOUR;
    seedCache(dir, astroFixture(pulledAt, 140), pulledAt);
    stubFetch('403');
    const res = await ts.getSkyForecast({ lat: LAT, lon: LON, windows: offHour, includeHours: true });
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('\n=== 403 + covering cache, windows off the hour → keep Astrospheric ===');
    check('source is Astrospheric', res.source === 'astrospheric', res.source + ' ' + (res.primaryError || ''));
    check('refreshError kept', /403/.test(res.refreshError || ''), res.refreshError);
  }

  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll stale-cache checks passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
