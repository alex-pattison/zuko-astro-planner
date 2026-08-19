#!/usr/bin/env node
/**
 * Catalog + pipeline conflict QA for Filters (names, slots, colors, in-use remove).
 * Usage: node scripts/qa-filters.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok ', name);
  else {
    failed += 1;
    console.error('  FAIL', name, detail == null ? '' : detail);
  }
}

function extractFunction(src, name) {
  const re = new RegExp(`function ${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error(`missing function ${name}`);
  let i = m.index + m[0].length - 1;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) { i += 1; break; }
    }
  }
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (src[i] !== '{') throw new Error(`no body for ${name}`);
  depth = 0;
  quote = null;
  escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inRegex = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; continue; }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (inRegex) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '/') inRegex = false;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j -= 1;
      const prev = j >= 0 ? src[j] : '';
      if (!/[)\]}\w$]/.test(prev)) { inRegex = true; continue; }
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
  'Add Filter toolbar matches New Project',
  /data-section="filter-wheel"[\s\S]*?<div class="section-toolbar">\s*<button class="add-btn" data-testid="add-filter"/.test(html)
  && /data-section="tracked-projects"[\s\S]*?<div class="section-toolbar">\s*<button class="add-btn" data-testid="new-project"/.test(html)
);
check(
  'edit modal has Remove filter',
  /id="modal-remove"/.test(html) && /Remove filter/.test(html) && /removeCurrentWheelFilter/.test(html)
);
check('duplicate name is blocked with an alert', html.includes('A filter named "') && html.includes('already exists.'));
check('duplicate slot is blocked with an alert', html.includes('is already assigned.'));
check('empty name is blocked with an alert', html.includes("Enter a filter name."));
check(
  'in-use remove warns and keeps capture-plan names',
  html.includes('is used in') && html.includes('Capture plan entries will keep the name.')
);
check('no window.confirm()', !/\bconfirm\s*\(/.test(html));
check('no window.alert()', !/\balert\s*\(/.test(html));
check('in-app dialog overlay exists', /id="app-dialog-overlay"/.test(html) && /function appConfirm/.test(html));

console.log('\n=== catalog + pipeline conflict logic ===');

const sandbox = { console, data: { filters: [], projects: [] } };
vm.createContext(sandbox);
const boot = [
  extractConstArray(html, 'FILTER_NAMED_COLOR_KEYS'),
  extractConstArray(html, 'DEFAULT_FILTERS'),
  extractFunction(html, 'normalizeFilterHex'),
  extractFunction(html, 'normalizeFilterColorKey'),
  extractFunction(html, 'formatFilterSlot'),
  extractFunction(html, 'nextFilterSlot'),
  extractFunction(html, 'filterSlotTaken'),
  extractFunction(html, 'uniqueFilterId'),
  extractFunction(html, 'sortFiltersBySlot'),
  extractFunction(html, 'ensureFilters'),
  extractFunction(html, 'filterNameTaken'),
  extractFunction(html, 'countFilterUsage'),
  extractFunction(html, 'renameFilterInProjects'),
  extractFunction(html, 'getWheelFilterOptions'),
  extractFunction(html, 'listedFilterByName'),
  extractFunction(html, 'filterToneKeyHeuristic'),
  extractFunction(html, 'filterToneKey'),
  extractFunction(html, 'listPipelineFilterGroups'),
  extractFunction(html, 'findPipelineGroup'),
  extractFunction(html, 'getShootsForFilterTone'),
].join('\n');
vm.runInContext(boot, sandbox);

function resetCatalog() {
  sandbox.data = {
    filters: JSON.parse(JSON.stringify(vm.runInContext('DEFAULT_FILTERS', sandbox))),
    projects: [
      {
        name: 'Veil',
        filterTargets: [
          { filter: 'Ha', location: 'NYC', targetHrs: 8, loggedHrs: 2 },
          { filter: 'OIII', location: 'NYC', targetHrs: 6, loggedHrs: 0 },
          { filter: 'Ha', location: 'Dark', targetHrs: 4, loggedHrs: 1 },
        ],
        shoots: [
          { filterIndex: 0, date: '260801', hours: 2, complete: true },
          { filterIndex: 2, date: '260802', hours: 1, complete: true },
          { filterIndex: 1, date: '260803', hours: 1, complete: false },
        ],
      },
    ],
  };
}

resetCatalog();
const {
  filterNameTaken,
  filterSlotTaken,
  nextFilterSlot,
  countFilterUsage,
  renameFilterInProjects,
  getWheelFilterOptions,
  ensureFilters,
  uniqueFilterId,
  filterToneKey,
  listPipelineFilterGroups,
  findPipelineGroup,
  getShootsForFilterTone,
  DEFAULT_FILTERS,
} = vm.runInContext(`({
  filterNameTaken, filterSlotTaken, nextFilterSlot, countFilterUsage,
  renameFilterInProjects, getWheelFilterOptions, ensureFilters, uniqueFilterId,
  filterToneKey, listPipelineFilterGroups, findPipelineGroup, getShootsForFilterTone,
  DEFAULT_FILTERS,
})`, sandbox);

check('default catalog has 8 filters', DEFAULT_FILTERS.length === 8, DEFAULT_FILTERS.length);
check(
  'default names unique',
  new Set(DEFAULT_FILTERS.map((f) => f.name.toLowerCase())).size === 8
);
check(
  'default slots 1–8 unique',
  DEFAULT_FILTERS.map((f) => f.slot).sort((a, b) => a - b).join(',') === '1,2,3,4,5,6,7,8'
);

check('Ha name is taken', filterNameTaken('Ha', -1) === true);
check('ha case-insensitive taken', filterNameTaken('ha', -1) === true);
check('editing Ha can keep Ha', filterNameTaken('Ha', sandbox.data.filters.findIndex((f) => f.name === 'Ha')) === false);
check('new unique name is free', filterNameTaken('L-eXtreme', -1) === false);

check('slot 6 taken (Ha)', filterSlotTaken(6, -1) === true);
check('editing Ha can keep slot 6', filterSlotTaken(6, sandbox.data.filters.findIndex((f) => f.name === 'Ha')) === false);
check('slot 9 free', filterSlotTaken(9, -1) === false);
check('next free slot is 9', nextFilterSlot(-1) === 9, nextFilterSlot(-1));

check(
  'same color is allowed (no unique-color guard)',
  !/filterColorTaken|color already|already uses this color/i.test(html)
);

const haUsage = countFilterUsage('Ha');
check('Ha is used in 2 capture-plan rows', haUsage === 2, haUsage);
check('unused Hb usage is 0', countFilterUsage('Hb') === 0);

const namesBefore = getWheelFilterOptions().map((o) => o.value);
check('catalog options include Ha', namesBefore.includes('Ha'));

sandbox.data.filters = sandbox.data.filters.filter((f) => f.name !== 'Ha');
check('after removing Ha, options drop it', getWheelFilterOptions().every((o) => o.value !== 'Ha'));
check(
  'capture plan still has both Ha rows',
  sandbox.data.projects[0].filterTargets.filter((ft) => ft.filter === 'Ha').length === 2
);
check(
  'removed Ha still colors as ha via name heuristic',
  filterToneKey('Ha') === 'ha',
  filterToneKey('Ha')
);

resetCatalog();
renameFilterInProjects('Ha', 'H-alpha');
check(
  'rename updates every capture-plan row',
  sandbox.data.projects[0].filterTargets.filter((ft) => ft.filter === 'H-alpha').length === 2
  && sandbox.data.projects[0].filterTargets.every((ft) => ft.filter !== 'Ha')
);

resetCatalog();
ensureFilters();
sandbox.data.filters.push({
  id: uniqueFilterId('Ha 3nm'),
  name: 'Ha 3nm',
  brand: 'Antlia',
  band: '3nm',
  slot: 9,
  colorKey: 'ha',
  color: '',
});
check('two Ha-colored filters can share a color', sandbox.data.filters.filter((f) => f.colorKey === 'ha').length === 2);
sandbox.data.projects[0].filterTargets.push({ filter: 'Ha 3nm', location: 'NYC', targetHrs: 3, loggedHrs: 0 });
const groups = listPipelineFilterGroups(sandbox.data.projects[0]);
check(
  'same color, different names → separate pipeline channels',
  groups.filter((g) => g.name === 'Ha').length === 1
  && groups.filter((g) => g.name === 'Ha 3nm').length === 1,
  groups.map((g) => g.name + ':' + g.tone).join(',')
);
check(
  'two Ha location rows still share one channel',
  groups.find((g) => g.name === 'Ha').fis.length === 2
);
const haShoots = getShootsForFilterTone(sandbox.data.projects[0], 'ha', 'Ha');
const ha3Shoots = getShootsForFilterTone(sandbox.data.projects[0], 'ha', 'Ha 3nm');
check('Ha nights stay on the Ha channel', haShoots.length === 2, haShoots.length);
check('Ha 3nm channel does not inherit Ha nights', ha3Shoots.length === 0, ha3Shoots.length);
check('find by name prefers the named group', findPipelineGroup(sandbox.data.projects[0], 'Ha 3nm').name === 'Ha 3nm');

sandbox.data.filters.push({
  id: uniqueFilterId('L-eXtreme'),
  name: 'L-eXtreme',
  brand: 'Optolong',
  band: 'dual',
  slot: 10,
  colorKey: 'custom',
  color: '#e879f9',
});
check(
  'custom-colored filter is not forced into an LRGB/SHO bucket',
  filterToneKey('L-eXtreme') === 'other',
  filterToneKey('L-eXtreme')
);

if (failed) {
  console.error(`\n${failed} filter QA check(s) failed`);
  process.exit(1);
}
console.log('\nAll filter QA checks passed');
