#!/usr/bin/env node
/**
 * Static + pure-logic QA for project FOV / imaging config / shoot dates / framer gates.
 * Usage: node scripts/qa-project-framer-fov.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  ok ', name);
  } else {
    failed += 1;
    console.error('  FAIL', name, detail == null ? '' : detail);
  }
}

function extractFunction(src, name) {
  const re = new RegExp(`function ${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error(`missing function ${name}`);
  // Skip parameter list (may contain default `{}`) before the function body.
  let i = m.index + m[0].length - 1; // at '('
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (src[i] !== '{') throw new Error(`no body for ${name}`);
  const bodyStart = i;
  depth = 0;
  quote = null;
  escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inRegex = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (inRegex) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '/') inRegex = false;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j -= 1;
      const prev = j >= 0 ? src[j] : '';
      if (!/[)\]}\w$]/.test(prev)) {
        inRegex = true;
        continue;
      }
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error(`unclosed function ${name}`);
}

function extractConstArray(src, name) {
  const start = src.indexOf(`const ${name} = [`);
  if (start < 0) throw new Error(`missing const ${name}`);
  let i = start + `const ${name} = `.length;
  let depth = 0;
  const begin = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1) + ';';
    }
  }
  throw new Error(`unclosed array ${name}`);
}

console.log('=== static UI contracts ===');

check(
  'project meta shows Imaging configuration label',
  /pm-label">Imaging configuration<\/div>/.test(html)
  && /id="project-imaging-config-\$\{pi\}"/.test(html)
  && /onclick="editProjectMeta\(\$\{pi\}\)"/.test(html)
);
check(
  'project meta has no imaging-config select',
  !/class="project-imaging-select"/.test(html)
  && !/onchange="updateProjectImagingConfig/.test(html)
);
check(
  'mosaics note only in new-project modal path',
  (html.match(/Mosaics are not supported yet/g) || []).length === 1
  && html.includes("Mosaics are not supported yet — use a single framing per project.")
);
check(
  'framer select uses IMAGING_CONFIGS map',
  /framer-mode-\$\{pi\}[\s\S]*?IMAGING_CONFIGS\.map/.test(html)
  && /updateFramerSetting\(\$\{pi\}, 'imagingConfig'/.test(html)
);
check(
  'Set center button not disabled in markup',
  /id="framer-center-btn-\$\{pi\}"[^>]*>📍 Set center/.test(html)
  && !/id="framer-center-btn-\$\{pi\}"[^>]*\bdisabled\b/.test(html)
);
check(
  'moveFramerToView not gated on unlock',
  /function moveFramerToView\(pi\) \{[\s\S]*?\n\}/.exec(html)
  && !/function moveFramerToView\(pi\) \{[\s\S]*?if \(!unlockedFramers\.has\(pi\)\) return;/.test(html)
);
check(
  'syncFramerRotationControls keeps center enabled',
  /centerBtn\.disabled = false/.test(html)
  && /Unlock the framer to set center/.test(html) === false
);

console.log('\n=== imaging config + shoot date logic ===');

const sandbox = { console };
vm.createContext(sandbox);
const boot = [
  extractConstArray(html, 'IMAGING_CONFIGS'),
  extractFunction(html, 'getImagingConfig'),
  extractFunction(html, 'formatImagingConfigSummary'),
  extractFunction(html, 'formatImagingConfigDetail'),
  extractFunction(html, 'inferImagingConfigId'),
  extractFunction(html, 'applyImagingConfigToProject'),
  extractFunction(html, 'shootDateToISO'),
  extractFunction(html, 'projectShootISOBounds'),
  extractFunction(html, 'syncProjectShootDates'),
  extractFunction(html, 'formatProjectDateShort'),
  extractFunction(html, 'formatProjectDateRange'),
  extractFunction(html, 'remapIndexAfterMove'),
].join('\n');
vm.runInContext(boot, sandbox);
const exported = vm.runInContext(`({
  IMAGING_CONFIGS,
  getImagingConfig,
  formatImagingConfigSummary,
  formatImagingConfigDetail,
  inferImagingConfigId,
  applyImagingConfigToProject,
  shootDateToISO,
  projectShootISOBounds,
  syncProjectShootDates,
  formatProjectDateRange,
  remapIndexAfterMove,
})`, sandbox);

const {
  IMAGING_CONFIGS,
  getImagingConfig,
  formatImagingConfigSummary,
  formatImagingConfigDetail,
  inferImagingConfigId,
  applyImagingConfigToProject,
  shootDateToISO,
  projectShootISOBounds,
  syncProjectShootDates,
  formatProjectDateRange,
  remapIndexAfterMove,
} = exported;

check('four imaging configs', IMAGING_CONFIGS.length === 4, IMAGING_CONFIGS.length);
check(
  'config ids unique',
  new Set(IMAGING_CONFIGS.map((c) => c.id)).size === 4
);
check(
  'each config has fov + framerMode + bin',
  IMAGING_CONFIGS.every((c) => c.fov && c.framerMode && (c.bin === 1 || c.bin === 2))
);

const expectedIds = ['reducer-bin2', 'reducer-bin1', 'native-bin2', 'native-bin1'];
check('canonical id order', IMAGING_CONFIGS.map((c) => c.id).join(',') === expectedIds.join(','));

for (const id of expectedIds) {
  const p = {};
  const cfg = applyImagingConfigToProject(p, id);
  check(`apply ${id}`, p.imagingConfig === id && p.framerMode === cfg.framerMode && p.frameMode === formatImagingConfigSummary(cfg));
}

check('infer empty → reducer-bin2', inferImagingConfigId('', '') === 'reducer-bin2');
check('infer native bin1', inferImagingConfigId('Native + Bin1 · 400mm f/5.6', 'native') === 'native-bin1');
check('infer by id', inferImagingConfigId('native-bin2', 'reducer') === 'native-bin2');
check('infer 400mm text', inferImagingConfigId('something 400 mm', '') === 'native-bin2');
check('get unknown null', getImagingConfig('nope') == null);
check('apply unknown falls back', applyImagingConfigToProject({}, 'nope').id === 'reducer-bin2');
check(
  'detail line reducer-bin2',
  formatImagingConfigDetail(getImagingConfig('reducer-bin2')) === 'Reducer · Bin2 · 280mm · f/3.9 · 3.91°×2.66°'
);
check(
  'detail line native-bin1',
  formatImagingConfigDetail(getImagingConfig('native-bin1')) === 'Native · Bin1 · 400mm · f/5.6 · 2.74°×1.86°'
);
check('detail empty', formatImagingConfigDetail(null) === '—');

// FOV pairs: bin does not change FOV string within optical mode
const redFov = getImagingConfig('reducer-bin1').fov;
check('reducer bins share FOV', getImagingConfig('reducer-bin2').fov === redFov);
check('native bins share FOV', getImagingConfig('native-bin1').fov === getImagingConfig('native-bin2').fov);
check('reducer ≠ native FOV', redFov !== getImagingConfig('native-bin2').fov);

console.log('\n=== shootDateToISO edge cases ===');
check('YYMMDD', shootDateToISO('260725') === '2026-07-25');
check('YYYYMMDD', shootDateToISO('20260725') === '2026-07-25');
check('with dashes', shootDateToISO('26-07-25') === '2026-07-25');
check('empty', shootDateToISO('') === '');
check('garbage', shootDateToISO('abc') === '');
check('too short', shootDateToISO('2607') === '');
check('nullish', shootDateToISO(null) === '' && shootDateToISO(undefined) === '');

console.log('\n=== syncProjectShootDates ===');
{
  const p = {
    status: 'active',
    startDateManual: false,
    endDateManual: false,
    startDate: '',
    endDate: '2099-01-01',
    shoots: [{ date: '260720' }, { date: '260801' }, { date: 'bad' }],
  };
  syncProjectShootDates(p);
  check('auto start = earliest', p.startDate === '2026-07-20');
  check('imaging clears end', p.endDate === '');
  check('bounds ignore bad', projectShootISOBounds(p).last === '2026-08-01');

  syncProjectShootDates(p, { prevStatus: 'active', nextStatus: 'processing' });
  check('leave imaging sets end', p.endDate === '2026-08-01' && p.status === 'active');

  p.startDateManual = true;
  p.startDate = '2020-01-01';
  syncProjectShootDates(p);
  check('manual start preserved', p.startDate === '2020-01-01');

  p.endDateManual = true;
  p.endDate = '2021-02-02';
  p.status = 'planning';
  syncProjectShootDates(p, { prevStatus: 'processing', nextStatus: 'planning' });
  check('manual end preserved while planning', p.endDate === '2021-02-02');

  p.endDateManual = false;
  p.endDate = '2021-02-02';
  syncProjectShootDates(p, { nextStatus: 'planning' });
  check('auto end cleared in planning', p.endDate === '');

  const empty = { status: 'active', startDateManual: false, endDateManual: false, shoots: [] };
  syncProjectShootDates(empty);
  check('no shoots → empty start', empty.startDate === '');
  check('no shoots imaging → empty end', empty.endDate === '');

  const many2 = {
    status: 'complete',
    startDateManual: false,
    endDateManual: false,
    startDate: '',
    endDate: '',
    shoots: [
      { date: '251231' },
      { date: '260101' },
      ...Array.from({ length: 20 }, (_, i) => ({ date: `2607${String(i + 1).padStart(2, '0')}` })),
      { date: '' },
      { date: null },
    ],
  };
  syncProjectShootDates(many2);
  check('many shoots start min', many2.startDate === '2025-12-31');
  check('many shoots end last', many2.endDate === '2026-07-20');
}

console.log('\n=== formatProjectDateRange ===');
check('both empty', formatProjectDateRange('', '') === '');
check('start only open-ended', /→\s*$/.test(formatProjectDateRange('2026-07-25', '')) || formatProjectDateRange('2026-07-25', '').includes('→'));
check('same day single', formatProjectDateRange('2026-07-25', '2026-07-25').includes('25') && !formatProjectDateRange('2026-07-25', '2026-07-25').includes('–'));
check('range has en-dash', formatProjectDateRange('2026-07-01', '2026-07-25').includes('–'));
check('bad iso ignored', formatProjectDateRange('not-a-date', 'also-bad') === '');

console.log('\n=== remapIndexAfterMove ===');
check('move self', remapIndexAfterMove(2, 5, 2) === 5);
check('shift left when moving down', remapIndexAfterMove(1, 4, 3) === 2);
check('shift right when moving up', remapIndexAfterMove(4, 1, 2) === 3);
check('unaffected', remapIndexAfterMove(1, 3, 5) === 5);

console.log('\n=== framer dirty / baseline helpers (inline) ===');
{
  function getFramerEditableState(p) {
    if (!p || !p.savedTarget) return null;
    return {
      ra: Number(p.savedTarget.ra),
      dec: Number(p.savedTarget.dec),
      centerCoords: p.centerCoords || '',
      framerRotation: Number(p.framerRotation) || 0,
      framerMode: p.framerMode || 'reducer',
      imagingConfig: p.imagingConfig || '',
    };
  }
  function dirty(a, b) {
    const near = (x, y) => Math.abs(Number(x) - Number(y)) < 1e-6;
    return !(
      near(a.ra, b.ra)
      && near(a.dec, b.dec)
      && a.centerCoords === b.centerCoords
      && a.framerRotation === b.framerRotation
      && a.framerMode === b.framerMode
      && a.imagingConfig === b.imagingConfig
    );
  }
  const p = {
    imagingConfig: 'reducer-bin2',
    framerMode: 'reducer',
    framerRotation: 12,
    centerCoords: 'RA 1 Dec 1',
    savedTarget: { ra: 10, dec: 20 },
  };
  const base = getFramerEditableState(p);
  check('clean vs self', !dirty(base, getFramerEditableState(p)));
  p.imagingConfig = 'native-bin1';
  p.framerMode = 'native';
  check('dirty on config', dirty(base, getFramerEditableState(p)));
  p.imagingConfig = 'reducer-bin2';
  p.framerMode = 'reducer';
  p.framerRotation = 90;
  check('dirty on rotation', dirty(base, getFramerEditableState(p)));
  p.framerRotation = 12;
  p.savedTarget.ra = 10.0000001;
  check('near ra not dirty', !dirty(base, getFramerEditableState(p)));
  p.savedTarget.ra = 11;
  check('dirty on ra', dirty(base, getFramerEditableState(p)));
}

if (failed) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log('\nqa-project-framer-fov: all checks passed');
