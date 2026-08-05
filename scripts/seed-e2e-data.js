#!/usr/bin/env node
/**
 * Seed an isolated dashboard JSON for Playwright E2E.
 * Does not touch H: live data. Writes to staging/e2e-data/ by default.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = process.env.ZUKO_DATA_DIR
  ? path.resolve(process.env.ZUKO_DATA_DIR)
  : path.join(ROOT, 'staging', 'e2e-data');
const FIXTURE_ASIAIR = path.join(ROOT, 'staging', 'asiair-test-target-match');
const OUT_FILE = path.join(OUT_DIR, 'zuko-dashboard-data.json');

const hasAsiair = fs.existsSync(path.join(FIXTURE_ASIAIR, 'Autorun'));

const project = {
  name: '[E2E] Target Match Smoke',
  target: 'Rosette Nebula',
  frameMode: 'Reducer',
  centerCoords: 'RA 6h31m55s Dec +4°56\'',
  anchorStar: '',
  rotation: '27° (set via framer)',
  status: 'active',
  notes: 'Playwright E2E seed — isolated from live dashboard',
  filterTargets: [
    { filter: 'Ha', location: 'Home', bortle: '9', targetHrs: 4, loggedHrs: 0 },
    { filter: 'OIII', location: 'Home', bortle: '9', targetHrs: 4, loggedHrs: 0 },
    { filter: 'SII', location: 'Home', bortle: '9', targetHrs: 2, loggedHrs: 0 },
  ],
  checklist: [],
  shoots: [
    {
      date: '260728',
      filterIndex: 0,
      hours: 1.5,
      complete: true,
    },
    {
      date: '260729',
      filterIndex: 1,
      hours: 1,
      complete: false,
    },
  ],
  astrobinLinks: [],
  projectDir: hasAsiair ? FIXTURE_ASIAIR : '',
  savedTarget: { name: 'Rosette Nebula', ra: 97.9792, dec: 4.9428 },
  framerRotation: 27,
  asiairIgnoredFolders: [],
  asiairIgnoredSources: [],
  asiairBoundFolders: [],
};

const data = {
  rigName: 'Zuko E2E',
  forecastLocation: { name: 'Test Site', lat: 40.72, lon: -73.98 },
  asiairSourcePath: hasAsiair ? FIXTURE_ASIAIR : '',
  projects: [project],
  assets: [],
  notes: [],
  appMeta: { build: 6 },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), 'utf8');
console.log('Wrote', OUT_FILE);
console.log('ASIAIR fixture:', hasAsiair ? FIXTURE_ASIAIR : '(missing — Review source will be locked)');
