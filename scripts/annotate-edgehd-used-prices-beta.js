'use strict';

/** Annotate EdgeHD wishlist assets with used-market price notes (Beta). */
const fs = require('fs');
const path = require('path');

const BETA = 'H:/Astrophotography/Dashboard/zuko-dashboard-data.json';

const usedByName = {
  'Celestron EdgeHD 8" OTA (CGE)':
    'Used market (Aug 2026 snapshot): fair/dealer ~$750–1,000; clean OTA ask ~$1,000–1,250 (Astromart/AstroBin); Celestron CPO list ~$1,400. Realistic target ~$900–1,200 CONUS for a clean CGE-bar OTA. Bundles with reducer/mount run much higher.',
  'Celestron EdgeHD 0.7× Reducer (8")':
    'Used market: Astromart ~$325 shipped; Celestron used/refurb ~$330 when stocked. Realistic ~$280–350 vs $419 new. Confirm MPN 94242 (8" only).',
  'ZWO OAG (standard)':
    'Used market: often $50–100 on CN/AstroBuySell (chipped prism cheaper). Clean units ~$80–110 vs $128 new. OAG-L used often ~$135–180.',
  'ZWO EAF Pro (battery + Bluetooth)':
    'EAF Pro is new (2025) — thin used market. Prior-gen ZWO EAF used ~$150–200. Expect Pro ~$220–270 until supply catches up; watch CN/Astromart/ZWO FB groups. SCT bracket often separate.',
};

function backup(file, tag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `zuko-dashboard-data.${tag}.${stamp}.json`);
  fs.copyFileSync(file, dest);
  return dest;
}

const bak = backup(BETA, 'pre-used-price-notes');
const data = JSON.parse(fs.readFileSync(BETA, 'utf8'));
if (!data.projects || !data.projects.length) throw new Error('projects empty');

let n = 0;
for (const a of data.assets || []) {
  const note = usedByName[a.name];
  if (!note) continue;
  if (String(a.notes || '').includes('Used market')) {
    console.log('already annotated', a.name);
    continue;
  }
  a.notes = `${a.notes || ''} ${note}`.trim();
  n += 1;
  console.log('updated', a.name);
}

data.appMeta = {
  ...(data.appMeta || {}),
  savedAt: new Date().toISOString(),
  note: 'Added used-market price notes to EdgeHD wishlist',
};

const tmp = `${BETA}.tmp`;
fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
fs.renameSync(tmp, BETA);
console.log('backup', bak, 'updated', n);
