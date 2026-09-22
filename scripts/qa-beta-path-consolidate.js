'use strict';

/**
 * Confirm Beta consolidation onto H:\Astrophotography.
 */
const fs = require('fs');
const path = require('path');
const { discoverSessions, scanSession } = require('../src/ingest/asiairIngest');
const { buildSessionLogInsight } = require('../src/ingest/asiairSessionLogs');

const DASH = 'H:\\Astrophotography\\Dashboard';
const ZUKO = 'H:\\Astrophotography\\Zuko';
const OLD_DASH = 'H:\\Photography\\Astrophotography\\Dashboard';
const PKG = require('../package.json');

let failed = 0;
function pass(n, d) { console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); }
function fail(n, d) { failed += 1; console.error(`  FAIL  ${n} — ${d || ''}`); }
function assert(n, c, d) { if (c) pass(n, d); else fail(n, d); }

async function main() {
  console.log('=== confirm H:\\Astrophotography consolidation ===');
  assert('package build 41', Number(PKG.zukoBuild) === 41, String(PKG.zukoBuild));
  assert('main.js BETA_DATA_DIR', fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').includes("H:\\\\Astrophotography\\\\Dashboard"));
  assert('main.js no old BETA_DATA_DIR', !fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').includes("Photography\\\\Astrophotography\\\\Dashboard"));

  assert('old Dashboard gone', !fs.existsSync(OLD_DASH));
  assert('new Dashboard exists', fs.existsSync(DASH));
  assert('.env present', fs.existsSync(path.join(DASH, '.env')));
  assert('astrospheric v2 cache', fs.existsSync(path.join(DASH, 'astrospheric-v2-cache-40.716,-73.986.json')));
  assert('astrospheric credits', fs.existsSync(path.join(DASH, 'astrospheric-credits.json')));
  assert('astrospheric moon', fs.existsSync(path.join(DASH, 'astrospheric-moon-40.716,-73.986.json')));
  assert('open-meteo', fs.existsSync(path.join(DASH, 'open-meteo-astro-40.716,-73.986.json')));

  const data = JSON.parse(fs.readFileSync(path.join(DASH, 'zuko-dashboard-data.json'), 'utf8'));
  assert('projects > 0', (data.projects || []).length > 0, String((data.projects || []).length));
  const raw = fs.readFileSync(path.join(DASH, 'zuko-dashboard-data.json'), 'utf8');
  assert('no Photography\\\\Astrophotography left in JSON', !/Photography\\Astrophotography/.test(raw));
  assert('dark library path new root', data.darkLibrary && /H:\\Astrophotography\\Zuko\\Dark Library/i.test(data.darkLibrary.path), data.darkLibrary && data.darkLibrary.path);
  assert('dark library on disk', data.darkLibrary && fs.existsSync(data.darkLibrary.path));

  for (const p of data.projects) {
    if (!p.projectDir) continue;
    assert(`projectDir ${p.name}`, fs.existsSync(p.projectDir), p.projectDir);
    assert(`projectDir under new Zuko (${p.name})`, String(p.projectDir).startsWith(ZUKO), p.projectDir);
  }

  const et = data.projects.find((p) => /elephant/i.test(p.name || ''));
  assert('Elephant Trunk present', !!et);
  if (et) {
    assert('ET framer 281', Number(et.framerRotation) === 281, String(et.framerRotation));
    const ingested = (et.shoots || []).filter((s) => s.ingestPath).length;
    assert('ET ingested shoots', ingested >= 5, String(ingested));
    for (const s of et.shoots || []) {
      if (!s.ingestPath) continue;
      assert(`ET ingest ${s.ingestMeta && s.ingestMeta.shootFolder}`, fs.existsSync(s.ingestPath), s.ingestPath);
    }
  }

  const credits = JSON.parse(fs.readFileSync(path.join(DASH, 'astrospheric-credits.json'), 'utf8'));
  assert('credits remaining finite', Number.isFinite(Number(credits.creditsRemaining)), String(credits.creditsRemaining));
  const v2 = JSON.parse(fs.readFileSync(path.join(DASH, 'astrospheric-v2-cache-40.716,-73.986.json'), 'utf8'));
  assert('v2 cache has forecast', !!(v2.forecast || v2.hourly || v2.data), Object.keys(v2).join(','));

  // Ingest can still discover ET dump if present
  const src = data.asiairSourcePath || 'J:\\Astrophotography\\ASIAIRDUMP_260915';
  if (fs.existsSync(src)) {
    const disc = await discoverSessions(src);
    assert('ASIAIR source discover', disc.ok, disc.error);
    const scan = await scanSession({
      projectDir: src,
      nightDate: '20260915',
      targetCoords: et && et.savedTarget,
      refCaaDeg: et && et.framerRotation,
      includeTargets: ['IC 1396'],
      skipTargetHint: true,
    });
    assert('ET night scan ok', scan.ok, scan.error);
    assert('ET night has lights', (scan.lights || []).length > 0, String((scan.lights || []).length));
    assert('no false CAA warn', !(scan.softWarnings || []).some((w) => /CAA mismatch/i.test(w)), (scan.softWarnings || []).join(' | '));
    const insight = await buildSessionLogInsight({
      sourceRoot: src,
      nightDate: '20260915',
      shootFilter: 'SII',
      refCaaDeg: 281,
      lightCount: 30,
      targetNames: ['IC 1396'],
    });
    assert('session log SII plan 30', insight.digest && insight.digest.plannedLights === 30, insight.digest && insight.digest.plannedLights);
  } else {
    console.log('  skip ASIAIR dump checks (source offline)');
  }

  if (failed) {
    console.error(`\nFAILED ${failed}`);
    process.exit(1);
  }
  console.log('\nAll consolidation checks passed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
