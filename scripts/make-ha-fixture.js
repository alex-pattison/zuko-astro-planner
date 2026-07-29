/**
 * Copy a few SII lights/flats and rewrite FILTER header + filename to Ha
 * so the same night has a second filter for ingest testing.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'staging', 'asiair-sample', 'Autorun');
const LIGHT_DIR = path.join(ROOT, 'Light', 'NGC 6960');
const FLAT_DIR = path.join(ROOT, 'Flat');

function patchFilterCard(buf, newFilter) {
  const text = buf.toString('binary');
  const out = Buffer.from(buf);
  for (let i = 0; i + 80 <= Math.min(text.length, 2880 * 8); i += 80) {
    const card = text.slice(i, i + 80);
    if (card.slice(0, 8).trim().toUpperCase() === 'END') break;
    if (card.slice(0, 8).trim().toUpperCase() !== 'FILTER') continue;
    // Keep layout: FILTER  = 'X       '           / ...
    const val = ("'" + String(newFilter).padEnd(8, ' ') + "'");
    const rebuilt = ('FILTER  = ' + val + card.slice(10 + val.length)).slice(0, 80).padEnd(80, ' ');
    Buffer.from(rebuilt, 'binary').copy(out, i);
    return out;
  }
  throw new Error('FILTER card not found');
}

async function copyAsHa(srcPath, destPath) {
  const buf = await fsp.readFile(srcPath);
  const patched = patchFilterCard(buf, 'H');
  await fsp.writeFile(destPath, patched);
}

async function main() {
  const lights = (await fsp.readdir(LIGHT_DIR))
    .filter((n) => /\.fit$/i.test(n) && /_S_/i.test(n))
    .sort()
    .slice(0, 5);
  const flats = (await fsp.readdir(FLAT_DIR))
    .filter((n) => /\.fit$/i.test(n) && /_S_20260726/i.test(n))
    .sort()
    .slice(0, 5);

  for (const name of lights) {
    const destName = name.replace(/_S_/g, '_H_');
    const dest = path.join(LIGHT_DIR, destName);
    if (fs.existsSync(dest)) {
      console.log('skip light', destName);
      continue;
    }
    await copyAsHa(path.join(LIGHT_DIR, name), dest);
    console.log('Ha light', destName);
  }
  for (const name of flats) {
    const destName = name.replace(/_S_/g, '_H_');
    const dest = path.join(FLAT_DIR, destName);
    if (fs.existsSync(dest)) {
      console.log('skip flat', destName);
      continue;
    }
    await copyAsHa(path.join(FLAT_DIR, name), dest);
    console.log('Ha flat', destName);
  }
  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
