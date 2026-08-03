#!/usr/bin/env node
/**
 * One-time seed of the Beta dashboard JSON on H:.
 *
 * Copies the freshest of:
 *   - H:\Photography\Astrophotography\Dashboard\zuko-dashboard-data.json
 *   - <repo>/data/zuko-dashboard-data.json
 * into the Beta data dir, then writes a .beta-seeded marker.
 *
 * Re-runs are no-ops once the marker exists (will not overwrite Beta data).
 *
 * Usage: node scripts/seed-beta-dashboard.js
 *        npm run seed:beta
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const BETA_DIR = 'H:\\Photography\\Astrophotography\\Dashboard';
const DATA_FILENAME = 'zuko-dashboard-data.json';
const MARKER = '.beta-seeded';
const REPO_DATA = path.join(__dirname, '..', 'data', DATA_FILENAME);
const BETA_FILE = path.join(BETA_DIR, DATA_FILENAME);
const MARKER_FILE = path.join(BETA_DIR, MARKER);

async function readCandidate(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const st = await fsp.stat(filePath);
    if (!st.isFile() || st.size === 0) return null;
    const text = await fsp.readFile(filePath, 'utf8');
    if (!text.trim()) return null;
    JSON.parse(text); // validate
    return { path: filePath, mtimeMs: st.mtimeMs, text };
  } catch (err) {
    console.warn('Skipping unreadable source:', filePath, err && err.message ? err.message : err);
    return null;
  }
}

async function main() {
  await fsp.mkdir(BETA_DIR, { recursive: true });

  if (fs.existsSync(MARKER_FILE)) {
    console.log('Beta already seeded (marker present):', MARKER_FILE);
    console.log('Leaving', BETA_FILE, 'unchanged.');
    return;
  }

  const candidates = [];
  for (const p of [BETA_FILE, REPO_DATA]) {
    const c = await readCandidate(p);
    if (c) candidates.push(c);
  }

  if (!candidates.length) {
    console.error('No source dashboard JSON found to seed from.');
    console.error('Looked at:', BETA_FILE, 'and', REPO_DATA);
    process.exit(1);
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const winner = candidates[0];

  if (path.normalize(winner.path) !== path.normalize(BETA_FILE)) {
    if (fs.existsSync(BETA_FILE)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(BETA_DIR, 'backups');
      await fsp.mkdir(backupDir, { recursive: true });
      const dest = path.join(backupDir, `zuko-dashboard-data.pre-seed.${stamp}.json`);
      await fsp.copyFile(BETA_FILE, dest);
      console.log('Backed up existing Beta file to', dest);
    }
    await fsp.writeFile(BETA_FILE, winner.text, 'utf8');
    console.log('Seeded Beta from', winner.path, '→', BETA_FILE);
  } else {
    console.log('Beta file already newest; keeping', BETA_FILE);
  }

  const marker = {
    seededAt: new Date().toISOString(),
    source: winner.path,
    sourceMtimeMs: winner.mtimeMs,
  };
  await fsp.writeFile(MARKER_FILE, JSON.stringify(marker, null, 2), 'utf8');
  console.log('Wrote marker', MARKER_FILE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
