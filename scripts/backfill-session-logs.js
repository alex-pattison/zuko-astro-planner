#!/usr/bin/env node
/**
 * Backfill ingestMeta.sessionLog (+ optional session-logs/ copies) onto existing
 * shoots by matching shoot night + ASIAIR source log/.
 *
 * Usage:
 *   node scripts/backfill-session-logs.js
 *   node scripts/backfill-session-logs.js --data path/to/zuko-dashboard-data.json
 *   node scripts/backfill-session-logs.js --source G:\ --copy
 *   node scripts/backfill-session-logs.js --dry-run
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildSessionLogInsight,
  copySessionLogsToShootDirs,
} = require('../src/ingest/asiairSessionLogs');

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const DRY = process.argv.includes('--dry-run');
const COPY = process.argv.includes('--copy');
const dataPath = argVal('--data')
  || path.join(__dirname, '..', 'data', 'zuko-dashboard-data.json');
const sourceOverride = argVal('--source');

function nightYmd(sh) {
  let d = String((sh && sh.date) || '').replace(/[^0-9]/g, '');
  if (d.length === 6) d = `20${d}`;
  return d.length === 8 ? d : null;
}

(async () => {
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const sourceRoot = sourceOverride || raw.asiairSourcePath;
  if (!sourceRoot) {
    console.error('No asiairSourcePath / --source');
    process.exit(1);
  }
  console.log('data:', dataPath);
  console.log('source:', sourceRoot, 'copy:', COPY, 'dry:', DRY);

  let updated = 0;
  let skipped = 0;
  for (const project of raw.projects || []) {
    for (const sh of project.shoots || []) {
      const night = nightYmd(sh);
      const ft = project.filterTargets && project.filterTargets[sh.filterIndex];
      if (!night || !ft || !ft.filter) {
        skipped += 1;
        continue;
      }
      if (!sh.ingestMeta || !sh.ingestMeta.stagedAt) {
        skipped += 1;
        continue;
      }
      const insight = await buildSessionLogInsight({
        sourceRoot,
        nightDate: night,
        shootFilter: ft.filter,
        refCaaDeg: project.framerRotation != null ? Number(project.framerRotation) : null,
        lightCount: sh.ingestMeta.lightCount != null
          ? Number(sh.ingestMeta.lightCount)
          : (sh.ingestMeta.byType && sh.ingestMeta.byType.light),
        targetNames: [project.target, project.name].filter(Boolean),
      });
      if (!insight.ok || !insight.digest) {
        skipped += 1;
        continue;
      }
      console.log(
        `  ${project.name} ${night} ${ft.filter}: plan=${insight.digest.planName || '—'} `
        + `angle=${insight.digest.plateAngleDeg ?? '—'} guide=${insight.digest.guide && insight.digest.guide.quality}`
      );
      if (!DRY) {
        sh.ingestMeta.sessionLog = insight.digest;
        const warns = [...new Set([
          ...(sh.ingestMeta.softWarnings || []),
          ...(insight.softWarnings || []),
        ])];
        sh.ingestMeta.softWarnings = warns;
        if (COPY && sh.ingestPath) {
          await copySessionLogsToShootDirs([sh.ingestPath], insight);
        }
      }
      updated += 1;
    }
  }

  if (!DRY && updated) {
    const bak = dataPath.replace(/\.json$/i, `.pre-session-log-backfill.${Date.now()}.json`);
    fs.copyFileSync(dataPath, bak);
    fs.writeFileSync(dataPath, JSON.stringify(raw, null, 2));
    console.log('backup →', bak);
    console.log('wrote', dataPath);
  }
  console.log(`done: updated=${updated} skipped=${skipped}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
