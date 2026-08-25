#!/usr/bin/env node
/**
 * QA: Astrospheric credit math + header-chip / Aladin wiring in the renderer.
 * Usage: node scripts/qa-sky-forecast-credits.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const {
  creditInfo,
  resolveForecastPullCost,
  EXPECTED_COST,
  MONTHLY_CREDITS,
  MOON_API_COST,
} = require(path.join(ROOT, 'src', 'weather', 'tonightShoot.js'));

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  ok ', name);
  } else {
    failed += 1;
    console.error('  FAIL', name, detail == null ? '' : detail);
  }
}

console.log('\n=== resolveForecastPullCost ===');
check('table-sum fallback', EXPECTED_COST === 65, EXPECTED_COST);
check('moon 10 ignored', resolveForecastPullCost(10) === EXPECTED_COST);
check('live 15 kept', resolveForecastPullCost(15) === 15);
check('live 80 kept', resolveForecastPullCost(80) === 80);
check('null → fallback', resolveForecastPullCost(null) === EXPECTED_COST);
check('zero → fallback', resolveForecastPullCost(0) === EXPECTED_COST);

console.log('\n=== creditInfo live Aug 2026 pool ===');
{
  const info = creditInfo({ remaining: 95010, costOfCall: 15 });
  check('costPerPull 15', info.costPerPull === 15, info.costPerPull);
  check('pulls remaining 6334', info.pullsRemaining === 6334, info.pullsRemaining);
  check(
    'cap at least remaining (no 6334/1993)',
    info.creditsMonthlyCap >= 95010,
    info.creditsMonthlyCap
  );
  check(
    'pullsPerMonth >= pullsRemaining',
    info.pullsPerMonth >= info.pullsRemaining,
    info.pullsPerMonth + ' vs ' + info.pullsRemaining
  );
}

console.log('\n=== creditInfo classic 65 / 29900 ===');
{
  const info = creditInfo({ remaining: 20000, costOfCall: 65 });
  check('cost 65', info.costPerPull === 65);
  check('pulls 307', info.pullsRemaining === Math.floor(20000 / 65), info.pullsRemaining);
  check('cap stays 29900 when remaining lower', info.creditsMonthlyCap === MONTHLY_CREDITS);
}

console.log('\n=== moon leak ===');
{
  const info = creditInfo({ remaining: 95010, costOfCall: MOON_API_COST });
  check('moon cost does not become divider', info.costPerPull === EXPECTED_COST, info.costPerPull);
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
console.log('\n=== renderer wiring ===');
check('applyHeaderSkyFromForecast exists', html.includes('function applyHeaderSkyFromForecast('));
check('silent header refresh', html.includes('refreshHeaderSky({ silent: true })') || html.includes('refreshHeaderSky({ silent: true })'));
check(
  'panel paints header',
  html.includes('if (skyFxForecastCoordsNearHeader()) applyHeaderSkyFromForecast(res)')
);
check('auto refresh timer', html.includes('function initSkyForecastAutoRefresh('));
check('visibilitychange refresh', html.includes("document.addEventListener('visibilitychange'"));
check('DSS HiPS uses alaskybis mirror', html.includes('https://alaskybis.cds.unistra.fr/DSS/DSSColor'));
check('Aladin preload after boot', html.includes('ensureAladinLoaded()'));
check('no A.HiPS in constructor', !html.includes('function aladinSurveyLayer('));
check('no hardcoded 65 pull title', !html.includes('Force a new Astrospheric pull (~65 credits)'));

if (failed) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log('\nqa-sky-forecast-credits: all checks passed');
