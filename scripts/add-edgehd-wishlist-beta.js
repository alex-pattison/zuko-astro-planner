'use strict';

/**
 * Add EdgeHD 8 wishlist kit to Beta dashboard JSON.
 * Usage: node scripts/add-edgehd-wishlist-beta.js
 */
const fs = require('fs');
const path = require('path');

const BETA = 'H:/Astrophotography/Dashboard/zuko-dashboard-data.json';

function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function backup(file, tag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `zuko-dashboard-data.${tag}.${stamp}.json`);
  fs.copyFileSync(file, dest);
  return dest;
}

const items = [
  {
    cat: 'Telescope',
    name: 'Celestron EdgeHD 8" OTA (CGE)',
    purchased: null,
    newRetail: 1699,
    acquired: null,
    condition: null,
    vendor: 'High Point Scientific',
    notes:
      'Wishlist — High Point SKU CEL-91030-XLT / MPN 91030-XLT. List $1,699 (Aug 2026). Pair with dedicated 0.7× reducer, ZWO OAG, and EAF Pro (SCT bracket). https://www.highpointscientific.com/celestron-edgehd-8-ota-8-quot-f-10-aplanatic-sct-ota-cge-dovetail-91030-xlt',
    specs: [
      ['Design', 'Aplanatic EdgeHD SCT (5-element flat field)'],
      ['Aperture / FL', '203.2 mm (8") / 2032 mm'],
      ['Focal ratio', 'f/10 native · f/7 with 0.7× · ~f/2 HyperStar/Fastar'],
      ['Image circle', '~42 mm flat (EdgeHD correctors)'],
      ['Coatings', 'StarBright XLT (~97.4% transmission claimed)'],
      ['Dovetail', 'CGE / Losmandy-D style bar included'],
      ['OTA weight / length', '~14 lb (6.35 kg) · ~17" (432 mm)'],
      ['Includes', '9×50 finder, 40 mm Plössl, 1.25" diagonal, CGE dovetail'],
    ],
    quirks: [
      '<strong>AM3 payload:</strong> OTA alone is ~14 lb — near the AM3’s 8 kg / 17 lb no-CW rating. Imaging train + dew gear will likely need the counterweight path (13 kg rated).',
      'Primary focuses by moving the mirror — expect some image shift; EdgeHD tension clutches help. An EAF on the focus knob is the usual imaging setup.',
      'Mirror flop / focus shift after meridian flips is classic SCT behavior — plan refocus routines.',
      'Back focus with the dedicated 0.7× reducer is generous (~105 mm to sensor); native imaging often uses the EdgeHD T-adapter for ~55 mm stacks.',
      'Fastar/HyperStar needs the secondary removed — separate accessory path, not the 0.7× reducer.',
    ],
    status: 'wishlist',
    released: '2010s (EdgeHD line)',
  },
  {
    cat: 'Telescope',
    name: 'Celestron EdgeHD 0.7× Reducer (8")',
    purchased: null,
    newRetail: 419,
    acquired: null,
    condition: null,
    vendor: 'High Point Scientific',
    notes:
      'Wishlist — dedicated EdgeHD 800 reducer (MPN 94242). List ~$419 at High Point (Aug 2026). Only for the 8" EdgeHD (not interchangeable with 9.25"/11" reducers).',
    specs: [
      ['Design', '4-element reducer/corrector (Lanthanum glass)'],
      ['Compression', '0.7× → ~1422 mm f/7 from 2032 mm f/10'],
      ['FOV gain', '~43% wider linear FOV (~2× area)'],
      ['Optimized circle', '~26.7 mm (APS-C / ASI294-class well covered)'],
      ['Back focus', '~105 mm from reducer to sensor'],
      ['Weight', '~0.8 lb (0.36 kg)'],
      ['MPN', '94242'],
    ],
    quirks: [
      'Must be the <strong>8" EdgeHD</strong> reducer — Celestron makes different 0.7× units per aperture.',
      'Maintains EdgeHD flat-field performance when spaced correctly; verify spacer stack to ~105 mm.',
      'Pairs with the EdgeHD 8 T-adapter ecosystem; re-tune flats after installing.',
    ],
    status: 'wishlist',
    released: 'EdgeHD accessory',
  },
  {
    cat: 'Guiding',
    name: 'ZWO OAG (standard)',
    purchased: null,
    newRetail: 128,
    acquired: null,
    condition: null,
    vendor: 'ZWO / High Point',
    notes:
      'Wishlist — standard OAG (8×8 mm prism, ~16.5 mm thick). List $128. Fits current 8×31 mm EFW + ASI120MM Mini better than OAG-L (OAG-L targets 36 mm / 2" EFWs).',
    specs: [
      ['Prism', '8 × 8 mm'],
      ['Thickness', '~16.5 mm in the imaging train'],
      ['Adapters', 'M42 / M48 included'],
      ['Guide cams', 'ASI Mini class (ASI120MM Mini already owned)'],
      ['Use case', 'Eliminate guide scope / flexure on long FL SCT'],
    ],
    quirks: [
      'With the existing <strong>31 mm EFW</strong>, prefer this OAG over OAG-L (larger clear aperture / different EFW pairing).',
      'Prism must clear the ASI294 imaging area — set prism depth carefully (daytime check).',
      'Still need correct total back focus with EdgeHD native or 0.7× reducer stacks.',
    ],
    status: 'wishlist',
    released: 'ongoing',
  },
  {
    cat: 'Accessories',
    name: 'ZWO EAF Pro (battery + Bluetooth)',
    purchased: null,
    newRetail: 299,
    acquired: null,
    condition: null,
    vendor: 'ZWO',
    notes:
      'Wishlist — EAF Pro with built-in 2500 mAh battery + Bluetooth 5.0 + on-body IN/OUT buttons. List $299 (standard EAF ~$269). Needs Celestron C8/C9.25 EAF bracket (EAF-C8-C925, sold separately) for EdgeHD 8 focus knob.',
    specs: [
      ['Power', 'Internal 2500 mAh Li-ion (~week typical AF use) + USB-C charge'],
      ['Control', 'Bluetooth 5.0 wireless · USB-C wired · ASIAIR / ASCOM'],
      ['Capacity', '5 kg / 11 lb rated load'],
      ['Body', '~258 g · 41 × 52 × 73 mm'],
      ['Ports', 'Temp sensor · optional hand controller'],
      ['Manual', 'On-body focus buttons (no separate HC required)'],
    ],
    quirks: [
      'Budget the <strong>EAF-C8-C925</strong> SCT bracket (~$50–70) — not included with the motor.',
      'Wireless mode is the point vs the Askar’s bundled cable EAF; still works USB-C to ASIAIR if preferred.',
      'Optional temp probe improves temp-compensated refocus; not required for basic AF.',
    ],
    status: 'wishlist',
    released: '2025',
  },
];

function main() {
  const bak = backup(BETA, 'pre-edgehd-wishlist');
  console.log('backup', bak);

  const data = JSON.parse(fs.readFileSync(BETA, 'utf8'));
  if (!Array.isArray(data.assets) || !data.assets.length) throw new Error('assets empty — abort');
  if (!Array.isArray(data.projects) || !data.projects.length) throw new Error('projects empty — abort');

  const names = new Set(data.assets.map((a) => a.name));
  const added = [];
  for (const item of items) {
    if (names.has(item.name)) {
      console.log('skip existing', item.name);
      continue;
    }
    data.assets.push(item);
    names.add(item.name);
    added.push(item.name);
  }

  data.appMeta = {
    ...(data.appMeta || {}),
    savedAt: new Date().toISOString(),
    note: 'Added EdgeHD 8 wishlist set (OTA, 0.7× reducer, ZWO OAG, EAF Pro)',
  };

  atomicWrite(BETA, data);
  JSON.parse(fs.readFileSync(BETA, 'utf8'));

  const wish = data.assets.filter((a) => a.status === 'wishlist');
  const wishValue = wish.reduce((s, a) => s + (typeof a.newRetail === 'number' ? a.newRetail : 0), 0);
  console.log('added', added);
  console.log('wishlist count', wish.length, 'value $' + wishValue);
  console.log('projects', data.projects.length, 'assets', data.assets.length);
}

main();
