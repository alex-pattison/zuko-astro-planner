'use strict';

/**
 * QA: Siril cd command formatting + UI wiring markers in index.html.
 * Usage: node scripts/qa-siril-cd-command.js
 */
const fs = require('fs');
const path = require('path');

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log('  ok ', name);
  else {
    failed += 1;
    console.error('  FAIL', name, detail || '');
  }
}

/** Mirror of index.html formatSirilCdCommand */
function formatSirilCdCommand(dir) {
  const p = String(dir || '').trim();
  if (!p) return '';
  return `cd "${p.replace(/"/g, '\\"')}"`;
}

console.log('qa-siril-cd-command\n');

console.log('=== format ===');
ok('empty → empty', formatSirilCdCommand('') === '');
ok(
  'simple path',
  formatSirilCdCommand('H:\\Photography\\Astrophotography\\Zuko\\NGC6960_Q326\\SII\\Aggregate')
    === 'cd "H:\\Photography\\Astrophotography\\Zuko\\NGC6960_Q326\\SII\\Aggregate"'
);
ok(
  'spaces quoted',
  formatSirilCdCommand('H:\\My Projects\\Veil Aggregate')
    === 'cd "H:\\My Projects\\Veil Aggregate"'
);
ok(
  'embedded quote escaped',
  formatSirilCdCommand('H:\\foo"bar') === 'cd "H:\\foo\\"bar"'
);

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

console.log('\n=== index.html wiring ===');
ok('formatSirilCdCommand defined', /function formatSirilCdCommand\(dir\)/.test(html));
ok('copySirilCdToClipboard defined', /function copySirilCdToClipboard\(dir\)/.test(html));
ok('copySirilCdButton defined', /function copySirilCdButton\(/.test(html));
ok(
  'cull uses CD for Siril',
  /copySirilCdButton\(aggregateDir,\s*'CD for Siril'/.test(html)
);
ok(
  'pipeline testid copy-siril-cd-working',
  /data-testid="copy-siril-cd-working"/.test(html)
);
ok(
  'pipeline button between working path and cleanup',
  /\$\{copyWorkingBtn\}\s*\$\{copySirilWorkingCdBtn\}\s*\$\{cleanupProjectBtn\}/.test(html)
);
ok(
  'refresh updates siril-cd-working buttons',
  /data-copy-siril-cd-working/.test(html) && /copySirilCdToClipboard\(btn\.getAttribute\('data-copy-siril-cd-working'\)\)/.test(html)
);

// Live Veil Aggregate (if present) — command shape only
const veilAgg = 'H:\\Photography\\Astrophotography\\Zuko\\NGC6960_Q326\\SII\\Aggregate';
if (fs.existsSync(veilAgg)) {
  console.log('\n=== live Aggregate path ===');
  const cmd = formatSirilCdCommand(veilAgg);
  ok('veil aggregate command starts with cd "', cmd.startsWith('cd "') && cmd.endsWith('"'));
  ok('veil aggregate path inside', cmd.includes(veilAgg));
  console.log('  sample:', cmd);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll siril-cd-command checks passed');
