#!/usr/bin/env node
/**
 * QA: Sun twilight + Moon modules across seasons and lunar phases.
 * Extracts renderer astronomy from index.html and cross-checks Open-Meteo.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const LAT = 42.6526; // Albany, NY (dashboard home)
const LON = -73.7562;
const TZ = 'America/New_York';

let failed = 0;
function ok(label, cond, detail = '') {
  if (cond) {
    console.log('  PASS', label, detail ? '— ' + detail : '');
  } else {
    failed += 1;
    console.error('  FAIL', label, detail ? '— ' + detail : '');
  }
}

function loadRendererAstro() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('const _ASTRO = (() => {');
  const end = html.indexOf('})();', start) + 5;
  if (start < 0 || end < 5) throw new Error('Could not find _ASTRO in index.html');

  // Pull helper functions used by sun/moon cards
  const helpers = [];
  const names = [
    'moonPhaseInfo',
    'fmtSkyTime',
    'twilightPctInWindow',
    'twilightSeg',
    'fmtHourMark',
    'nightWindowFor',
    'fmtPhaseRange',
    'duskStep',
    'twilightCutsFromPcts',
    'nextNewMoon',
    'nasaMoonImageUrlFromFraction',
    'nasaMoonImageUrl',
    'phaseNameFromFraction',
    'phaseFractionFromAstrospheric',
    'parseOmLocal',
  ];
  for (const name of names) {
    const re = new RegExp(
      'function ' + name + '\\([\\s\\S]*?\\n\\}\\n(?=\\n(?:function |const |async |//))'
    );
    const m = html.slice(html.indexOf('function ' + name + '(')).match(
      new RegExp('^function ' + name + '\\([\\s\\S]*?\\n\\}')
    );
    if (!m) throw new Error('Missing helper: ' + name);
    helpers.push(m[0]);
  }

  const sandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    isNaN,
    parseInt,
    parseFloat,
    JSON,
    Intl,
  };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(start, end) + ';\nthis._ASTRO = _ASTRO;', sandbox);
  for (const h of helpers) vm.runInContext(h, sandbox);
  return sandbox;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'zuko-astro-planner-qa' } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error('HTTP ' + res.statusCode + ' ' + url));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function minutesBetween(a, b) {
  return Math.abs(+a - +b) / 60000;
}

function fmtEt(d) {
  return d.toLocaleString('en-US', {
    timeZone: TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildCuts(A, lat, lon, when) {
  const w = A.nightWindowFor(lat, lon, when);
  const p = (d) => A.twilightPctInWindow(d, w.winStart, w.winEnd);
  const cuts = A.twilightCutsFromPcts({
    ge0: p(w.goldenEveningStart),
    ge1: p(w.goldenEveningEnd),
    be1: p(w.blueEveningEnd),
    nd: p(w.nauticalDusk),
    ad: p(w.astroDusk),
    an: p(w.astroDawn),
    nDawn: p(w.nauticalDawn),
    bMorn0: p(w.blueMorningStart),
    gMorn0: p(w.goldenMorningStart),
    gMorn1: p(w.goldenMorningEnd),
  });
  return { w, cuts, p };
}

function widths(cuts) {
  const out = {};
  for (let i = 0; i < cuts.length - 1; i++) {
    const cls = cuts[i].cls;
    if (!cls) continue;
    out[cls] = (out[cls] || 0) + (cuts[i + 1].at - cuts[i].at);
  }
  return out;
}

async function main() {
  console.log('\n=== Sun/Moon astronomy QA (Albany NY) ===\n');
  const A = loadRendererAstro();

  // --- Moon phase naming & illumination sanity ---
  console.log('Moon phases across 2026');
  const phaseHits = {
    'New moon': 0,
    'Waxing crescent': 0,
    'First quarter': 0,
    'Full moon': 0,
    'Last quarter': 0,
    'Waning crescent': 0,
  };
  const start = Date.UTC(2026, 0, 1);
  for (let day = 0; day < 366; day++) {
    const d = new Date(start + day * 86400000);
    const info = A.moonPhaseInfo(d);
    if (Object.prototype.hasOwnProperty.call(phaseHits, info.name)) phaseHits[info.name] += 1;
    if (info.illum < 0 || info.illum > 100) {
      ok('illum range day ' + day, false, String(info.illum));
    }
    if (info.name === 'New moon' && info.illum > 8) {
      ok('new moon low illum', false, info.illum + '% on ' + d.toISOString().slice(0, 10));
    }
    if (info.name === 'Full moon' && info.illum < 92) {
      ok('full moon high illum', false, info.illum + '% on ' + d.toISOString().slice(0, 10));
    }
  }
  for (const [name, n] of Object.entries(phaseHits)) {
    ok('sees ' + name, n > 0, n + ' days');
  }

  // Known new moons 2026 (approx UTC from astronomical almanac-style lists)
  // Tolerance: local approx age model vs true new moon can be ~0.5–1 day.
  const knownNewMoons = [
    '2026-01-18T19:52:00Z',
    '2026-02-17T12:01:00Z',
    '2026-03-19T01:23:00Z',
    '2026-04-17T11:52:00Z',
    '2026-05-16T20:01:00Z',
    '2026-06-15T04:54:00Z',
    '2026-07-14T14:44:00Z',
    '2026-08-12T21:37:00Z',
    '2026-09-11T05:27:00Z',
    '2026-10-10T15:50:00Z',
    '2026-11-09T07:02:00Z',
    '2026-12-08T22:52:00Z',
  ];
  console.log('\nnextNewMoon vs known 2026 new moons');
  for (const iso of knownNewMoons) {
    const trueNew = new Date(iso);
    // Query from 5 days before true new
    const probe = new Date(+trueNew - 5 * 86400000);
    const pred = A.nextNewMoon(probe, null);
    const errDays = Math.abs(+pred.when - +trueNew) / 86400000;
    ok(
      'new moon near ' + iso.slice(0, 10),
      errDays <= 1.25,
      'err ' + errDays.toFixed(2) + 'd · pred ' + pred.when.toISOString().slice(0, 16) + 'Z · days=' + pred.days
    );
  }

  // Illumination at known full / new
  console.log('\nIllumination at known extremes');
  const fullish = A.moonPhaseInfo(new Date('2026-08-28T04:18:00Z')); // full moon Aug 2026 ~04:18 UTC
  ok('Aug 2026 full ~bright', fullish.illum >= 95, fullish.name + ' ' + fullish.illum + '%');
  const newish = A.moonPhaseInfo(new Date('2026-08-12T21:37:00Z'));
  ok('Aug 2026 new ~dark', newish.illum <= 5, newish.name + ' ' + newish.illum + '%');

  // NASA frame URL stability
  console.log('\nNASA moon image mapping');
  const urlA = A.nasaMoonImageUrl(new Date('2026-08-12T21:37:00Z'));
  const urlB = A.nasaMoonImageUrl(new Date('2026-08-28T04:18:00Z'));
  ok('nasa url format', /mm-256-75\/\d{3}\.webp$/.test(urlA), urlA);
  ok('new vs full different frames', urlA !== urlB, urlA.split('/').pop() + ' vs ' + urlB.split('/').pop());

  // --- Seasonal twilight ---
  console.log('\nSeasonal twilight windows (noon→noon)');
  const seasons = [
    { label: 'winter solstice', when: new Date('2026-12-21T20:00:00-05:00') },
    { label: 'spring equinox', when: new Date('2026-03-20T20:00:00-04:00') },
    { label: 'summer solstice', when: new Date('2026-06-21T20:00:00-04:00') },
    { label: 'fall equinox', when: new Date('2026-09-22T20:00:00-04:00') },
  ];
  const nightPct = {};
  for (const s of seasons) {
    const { w, cuts } = buildCuts(A, LAT, LON, s.when);
    const W = widths(cuts);
    const sum = Object.values(W).reduce((a, b) => a + b, 0);
    const spanH = (+w.winEnd - +w.winStart) / 3600000;
    const hasEve = cuts.some((c) => c.cls === 'seg-golden' && c.at < 50);
    const hasMorn = cuts.some((c) => c.cls === 'seg-golden' && c.at > 50);
    const hasNight = (W['seg-night'] || 0) > 0;
    nightPct[s.label] = W['seg-night'] || 0;

    ok(s.label + ' window ~24h', spanH > 23.5 && spanH < 24.5, spanH.toFixed(3) + 'h');
    ok(s.label + ' bar fills 100%', Math.abs(sum - 100) < 0.05, 'sum=' + sum.toFixed(3));
    ok(s.label + ' evening zones', hasEve);
    ok(s.label + ' morning inverse zones', hasMorn);
    ok(s.label + ' has night band', hasNight, (W['seg-night'] || 0).toFixed(1) + '%');

    // Chronology: dusk before dawn; elevations descend then ascend
    ok(
      s.label + ' dusk < dawn',
      w.astroDusk && w.astroDawn && +w.astroDusk < +w.astroDawn,
      fmtEt(w.astroDusk) + ' → ' + fmtEt(w.astroDawn)
    );
    ok(
      s.label + ' elev order eve',
      +w.goldenEveningStart < +w.goldenEveningEnd &&
        +w.goldenEveningEnd <= +w.blueEveningEnd &&
        +w.blueEveningEnd <= +w.nauticalDusk &&
        +w.nauticalDusk <= +w.astroDusk
    );
    ok(
      s.label + ' elev order morn',
      +w.astroDawn <= +w.nauticalDawn &&
        +w.nauticalDawn <= +w.blueMorningStart &&
        +w.goldenMorningStart <= +w.goldenMorningEnd
    );

    // Proportionality check: night width === duration / span
    const nightDurPct = ((+w.astroDawn - +w.astroDusk) / (+w.winEnd - +w.winStart)) * 100;
    ok(
      s.label + ' night width ∝ duration',
      Math.abs(nightDurPct - (W['seg-night'] || 0)) < 0.05,
      'exp ' + nightDurPct.toFixed(2) + ' act ' + (W['seg-night'] || 0).toFixed(2)
    );
  }
  ok(
    'winter night longer than summer',
    nightPct['winter solstice'] > nightPct['summer solstice'] + 10,
    'W ' + nightPct['winter solstice'].toFixed(1) + '% vs S ' + nightPct['summer solstice'].toFixed(1) + '%'
  );

  // Polar edge: high latitude midsummer — sun may not reach -18°
  console.log('\nHigh-latitude summer (Tromsø 69.6°N) — missing phases must not break bar');
  const tromso = buildCuts(A, 69.65, 18.96, new Date('2026-06-21T15:00:00Z'));
  const tromsoSum = Object.values(widths(tromso.cuts)).reduce((a, b) => a + b, 0);
  ok('Tromsø summer bar fills', Math.abs(tromsoSum - 100) < 0.05, 'sum=' + tromsoSum.toFixed(2));
  ok('Tromsø cuts monotonic', tromso.cuts.every((c, i, arr) => i === 0 || c.at >= arr[i - 1].at));

  // --- Cross-check Open-Meteo ---
  console.log('\nOpen-Meteo cross-check (sunrise/sunset/moonrise)');
  try {
    const arch =
      await fetchJson(
        'https://archive-api.open-meteo.com/v1/archive?latitude=' +
          LAT +
          '&longitude=' +
          LON +
          '&daily=sunrise,sunset' +
          '&timezone=GMT' +
          '&start_date=2025-03-20&end_date=2025-12-22'
      );
    const fc = await fetchJson(
      'https://api.open-meteo.com/v1/forecast?latitude=' +
        LAT +
        '&longitude=' +
        LON +
        '&daily=sunrise,sunset,moonrise,moonset' +
        '&timezone=' +
        encodeURIComponent(TZ) +
        '&forecast_days=5'
    );
    ok('OM archive returned days', arch.daily && arch.daily.time && arch.daily.time.length > 10, String(arch.daily.time.length));
    ok('OM forecast returned days', fc.daily && fc.daily.time && fc.daily.time.length >= 3, String(fc.daily.time.length));

    function checkSunDay(daily, ymd, tolMin, asUtcStrings) {
      const i = daily.time.indexOf(ymd);
      if (i < 0) {
        ok('OM has ' + ymd, false);
        return;
      }
      const probe = new Date(ymd + 'T16:00:00Z');
      const t = A._ASTRO.getTimes(probe, LAT, LON);
      // Archive with timezone=GMT returns UTC instants; forecast returns wall times in TZ.
      const omRise = asUtcStrings
        ? new Date(/Z$/i.test(daily.sunrise[i]) ? daily.sunrise[i] : daily.sunrise[i] + 'Z')
        : A.parseOmLocal(daily.sunrise[i], TZ);
      const omSet = asUtcStrings
        ? new Date(/Z$/i.test(daily.sunset[i]) ? daily.sunset[i] : daily.sunset[i] + 'Z')
        : A.parseOmLocal(daily.sunset[i], TZ);
      const riseMin = minutesBetween(t.sunrise, omRise);
      const setMin = minutesBetween(t.sunset, omSet);
      ok(
        ymd + ' sunrise ±' + tolMin + ' min vs OM',
        riseMin <= tolMin,
        riseMin.toFixed(1) + ' min · local ' + fmtEt(t.sunrise) + ' OM ' + fmtEt(omRise)
      );
      ok(
        ymd + ' sunset ±' + tolMin + ' min vs OM',
        setMin <= tolMin,
        setMin.toFixed(1) + ' min · local ' + fmtEt(t.sunset) + ' OM ' + fmtEt(omSet)
      );
    }

    // Compare solar math to OM UTC archive (avoids OM America/New_York winter-offset quirk).
    checkSunDay(arch.daily, '2025-06-21', 8, true);
    checkSunDay(arch.daily, '2025-12-21', 8, true);
    checkSunDay(arch.daily, '2025-03-20', 8, true);
    checkSunDay(arch.daily, '2025-09-22', 8, true);

    const todayYmd = fc.daily.time[0];
    checkSunDay(fc.daily, todayYmd, 8, false);
    if (fc.daily.moonrise && fc.daily.moonrise[0]) {
      const probe = new Date(todayYmd + 'T16:00:00Z');
      const mt = A._ASTRO.getMoonTimes(probe, LAT, LON);
      const omRise = A.parseOmLocal(fc.daily.moonrise[0], TZ);
      if (mt && mt.rise && omRise) {
        const mr = minutesBetween(mt.rise, omRise);
        ok(todayYmd + ' moonrise ±45 min vs OM', mr <= 45, mr.toFixed(1) + ' min');
      } else {
        ok(todayYmd + ' moonrise available', false);
      }
    }

    // DST-safe parser: winter wall clock in ET must not shift by machine locale.
    const winter = A.parseOmLocal('2025-12-21T07:23', TZ);
    ok(
      'parseOmLocal winter ET',
      winter && Math.abs(+winter - Date.parse('2025-12-21T12:23:00Z')) < 120000,
      winter && winter.toISOString()
    );
  } catch (e) {
    ok('Open-Meteo fetch', false, String(e.message || e));
  }

  // Backend module smoke
  console.log('\nskyAstronomy module smoke');
  try {
    const sky = require(path.join(ROOT, 'src/weather/skyAstronomy.js'));
    ok('exports getSkyAstronomy', typeof sky.getSkyAstronomy === 'function');
    ok('exports setAstronomyCacheDir', typeof sky.setAstronomyCacheDir === 'function');
  } catch (e) {
    ok('require skyAstronomy', false, String(e.message || e));
  }

  // Moon altitude sign sanity
  console.log('\nMoon altitude sanity');
  const upSample = A._ASTRO.moonAltitude(new Date(), LAT, LON);
  ok('moonAltitude returns number', Number.isFinite(upSample), String(upSample));

  // nightWindowFor side of noon
  console.log('\nnightWindowFor noon boundary');
  const day = new Date('2026-08-02T10:00:00-04:00'); // before local noon
  const eve = new Date('2026-08-02T20:00:00-04:00'); // after local noon
  const wDay = A.nightWindowFor(LAT, LON, day);
  const wEve = A.nightWindowFor(LAT, LON, eve);
  ok('before noon uses prior noon start', +wDay.winStart < +day);
  ok('after noon uses today noon start', +wEve.winStart < +eve && +wEve.winEnd > +eve);
  ok('windows ~24h', (+wEve.winEnd - +wEve.winStart) / 3600000 > 23.5);

  console.log('\n' + (failed ? failed + ' failure(s)' : 'All checks passed'));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
