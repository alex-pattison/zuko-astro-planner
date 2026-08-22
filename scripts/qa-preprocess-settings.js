#!/usr/bin/env node
/**
 * QA: preprocessing settings presets + script permutations (no Siril run required).
 *
 * Uses staging/preprocess-settings-sample/fixtures.json as the permutation catalog.
 *
 * Usage: node scripts/qa-preprocess-settings.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  buildCalibrateScript,
  buildRegisterScript,
  buildStackScript,
  defaultPreprocessSettings,
  normalizePreprocessSettings,
  resolveStageOptions,
  formatStackArgs,
  HELP_CATALOG,
} = require('../src/siril/preprocess');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'scripts', 'fixtures', 'preprocess-settings.json');

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok ', name);
  else {
    failed += 1;
    console.error('  FAIL', name, detail != null ? detail : '');
  }
}

function expectIncludes(script, needles, label) {
  for (const n of needles) {
    check(`${label} includes ${JSON.stringify(n)}`, script.includes(n), script.slice(0, 240));
  }
}

function expectExcludes(script, needles, label) {
  for (const n of needles) {
    check(`${label} excludes ${JSON.stringify(n)}`, !script.includes(n));
  }
}

function testDefaultsShape() {
  console.log('\n=== default Mono 1.4 script shape ===');
  const cal = buildCalibrateScript();
  expectIncludes(cal, [
    'set core.binning_update=false',
    'stack bias rej 3 3 -nonorm -out=../masters/bias_stacked',
    'calibrate flat -bias=../masters/bias_stacked',
    'stack pp_flat rej 3 3 -norm=mul -out=../masters/pp_flat_stacked',
    'stack dark rej 3 3 -nonorm -out=../masters/dark_stacked',
    'calibrate light -dark=../masters/dark_stacked -flat=../masters/pp_flat_stacked -cc=dark',
  ], 'calibrate default');

  const reg = buildRegisterScript();
  expectIncludes(reg, ['set core.binning_update=false', 'register pp_light'], 'register default');
  expectExcludes(reg, ['-2pass', 'seqapplyreg'], 'register default');

  const stack = buildStackScript('result_Ha', { reregister: false });
  expectIncludes(stack, [
    'set core.binning_update=false',
    'stack pp_light rej 3 3 -norm=addscale -output_norm -32b -out=result',
  ], 'stack default');
  expectExcludes(stack, ['register pp_light'], 'stack default');

  const stackRe = buildStackScript('result_Ha', { reregister: true });
  expectIncludes(stackRe, ['register pp_light', 'stack r_pp_light'], 'stack reregister');
}

function testMonoRecommended() {
  console.log('\n=== mono recommended ===');
  const settings = normalizePreprocessSettings({
    ...defaultPreprocessSettings(),
    register: { preset: 'monoRecommended' },
    stack: { preset: 'monoRecommended' },
    binningUpdate: false,
  });
  const reg = buildRegisterScript({ settings });
  expectIncludes(reg, ['register pp_light -2pass', 'seqapplyreg pp_light'], 'register mono');

  const stackFew = buildStackScript('result_Ha', { settings, frameCount: 8 });
  expectIncludes(stackFew, ['stack pp_light med'], 'stack mono N=8 → median');

  const stackMany = buildStackScript('result_Ha', { settings, frameCount: 25 });
  expectIncludes(stackMany, ['stack pp_light rej 3 3 -norm=addscale'], 'stack mono N=25 → rej');
}

function testBinningCheckbox() {
  console.log('\n=== binning_update override ===');
  const off = buildStackScript('result_Ha', { binningUpdate: false });
  const on = buildStackScript('result_Ha', { binningUpdate: true });
  const regOn = buildRegisterScript({ binningUpdate: true });
  expectIncludes(off, ['set core.binning_update=false'], 'stack unchecked');
  expectIncludes(on, ['set core.binning_update=true'], 'stack checked');
  expectIncludes(regOn, ['set core.binning_update=true'], 'register checked');
}

function testCustomFlags() {
  console.log('\n=== custom flags ===');
  const settings = {
    bias: {
      preset: 'custom',
      custom: { method: 'rej', rejection: 'sigma', sigmaLow: 2.5, sigmaHigh: 4, norm: 'none', weight: 'none' },
    },
    flat: {
      preset: 'custom',
      custom: {
        useBias: false,
        method: 'rej',
        rejection: 'winsorized',
        sigmaLow: 3,
        sigmaHigh: 3,
        norm: 'mul',
        weight: 'none',
      },
    },
    calibrate: { preset: 'custom', custom: { cosmetic: false } },
    register: { preset: 'custom', custom: { twoPass: true } },
    stack: {
      preset: 'custom',
      custom: {
        method: 'rej',
        rejection: 'linear',
        sigmaLow: 3,
        sigmaHigh: 3,
        norm: 'addscale',
        weight: 'wfwhm',
        outputNorm: true,
        bits32: true,
      },
    },
    binningUpdate: false,
  };
  const cal = buildCalibrateScript({ settings });
  expectIncludes(cal, ['stack bias rej s 2.5 4 -nonorm', 'calibrate flat\n', 'calibrate light -dark='], 'custom calibrate');
  expectExcludes(cal, ['-cc=dark', 'calibrate flat -bias='], 'custom calibrate no bias/cc');

  const reg = buildRegisterScript({ settings });
  expectIncludes(reg, ['-2pass', 'seqapplyreg'], 'custom register 2pass');

  const stack = buildStackScript('result_Ha', { settings });
  expectIncludes(stack, ['rej l 3 3', '-weight=wfwhm'], 'custom stack');
}

function testFixturesFile() {
  console.log('\n=== fixtures.json permutations ===');
  check('fixtures exist', fs.existsSync(FIXTURES), FIXTURES);
  const catalog = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
  check('has cases', Array.isArray(catalog.cases) && catalog.cases.length >= 8, catalog.cases && catalog.cases.length);

  for (const c of catalog.cases) {
    const settings = normalizePreprocessSettings(c.settings || {});
    let script = '';
    if (c.kind === 'calibrate') script = buildCalibrateScript({ settings, binningUpdate: c.binningUpdate });
    else if (c.kind === 'register') script = buildRegisterScript({ settings, binningUpdate: c.binningUpdate });
    else if (c.kind === 'stack') {
      script = buildStackScript(c.resultBase || 'result_Ha', {
        settings,
        binningUpdate: c.binningUpdate,
        reregister: !!c.reregister,
        frameCount: c.frameCount,
      });
    } else {
      check(`${c.id} unknown kind`, false, c.kind);
      continue;
    }
    expectIncludes(script, c.expectIncludes || [], c.id);
    expectExcludes(script, c.expectExcludes || [], c.id);
  }
}

function testHelpAndResolve() {
  console.log('\n=== help catalog + resolve ===');
  check('HELP has binningUpdate', !!(HELP_CATALOG && HELP_CATALOG.binningUpdate));
  check('HELP has weight', !!(HELP_CATALOG && HELP_CATALOG.weight));
  check('HELP has twoPass', !!(HELP_CATALOG && HELP_CATALOG.twoPass));
  const resolved = resolveStageOptions(
    { register: { preset: 'monoRecommended' } },
    'register'
  );
  check('mono register twoPass', resolved.twoPass === true);
  const stackFew = resolveStageOptions(
    { stack: { preset: 'monoRecommended' } },
    'stack',
    { frameCount: 12 }
  );
  check('mono stack N=12 → med', stackFew.method === 'med', stackFew.method);
  const stackMany = resolveStageOptions(
    { stack: { preset: 'monoRecommended' } },
    'stack',
    { frameCount: 40 }
  );
  check('mono stack N=40 → rej', stackMany.method === 'rej', stackMany.method);
  const args = formatStackArgs({
    method: 'rej',
    rejection: 'winsorized',
    sigmaLow: 3,
    sigmaHigh: 3,
    norm: 'addscale',
    outputNorm: true,
    bits32: true,
  }, { out: 'result' });
  check('formatStackArgs default-like', args === 'rej 3 3 -norm=addscale -output_norm -32b -out=result', args);
}

function testWeightAndNormPermutations() {
  console.log('\n=== weight / norm / rejection permutations ===');
  const weights = ['none', 'noise', 'wfwhm', 'nbstars'];
  for (const w of weights) {
    const settings = {
      stack: {
        preset: 'custom',
        custom: {
          method: 'rej',
          rejection: 'winsorized',
          sigmaLow: 3,
          sigmaHigh: 3,
          norm: 'addscale',
          weight: w,
          outputNorm: true,
          bits32: true,
        },
      },
    };
    const script = buildStackScript('result_Ha', { settings });
    if (w === 'none') {
      expectExcludes(script, ['-weight='], `weight=${w}`);
    } else {
      expectIncludes(script, [`-weight=${w}`], `weight=${w}`);
    }
  }

  const norms = [
    { norm: 'none', expect: '-nonorm' },
    { norm: 'mul', expect: '-norm=mul' },
    { norm: 'addscale', expect: '-norm=addscale' },
    { norm: 'add', expect: '-norm=add' },
  ];
  for (const n of norms) {
    const settings = {
      bias: {
        preset: 'custom',
        custom: {
          method: 'rej',
          rejection: 'winsorized',
          sigmaLow: 3,
          sigmaHigh: 3,
          norm: n.norm,
          weight: 'none',
        },
      },
    };
    const script = buildCalibrateScript({ settings });
    expectIncludes(script, [`stack bias rej 3 3 ${n.expect}`], `bias norm=${n.norm}`);
  }

  const rejs = [
    { r: 'winsorized', needle: 'stack pp_light rej 3 3' },
    { r: 'sigma', needle: 'rej s 3 3' },
    { r: 'median', needle: 'rej m 3 3' },
    { r: 'none', needle: 'rej n' },
  ];
  for (const { r, needle } of rejs) {
    const settings = {
      stack: {
        preset: 'custom',
        custom: {
          method: 'rej',
          rejection: r,
          sigmaLow: 3,
          sigmaHigh: 3,
          norm: 'addscale',
          weight: 'none',
          outputNorm: true,
          bits32: true,
        },
      },
    };
    const script = buildStackScript('result_Ha', { settings });
    expectIncludes(script, [needle], `rej=${r}`);
  }
}

function testMonoAllStages() {
  console.log('\n=== mono recommended all stages ===');
  const settings = normalizePreprocessSettings({
    bias: { preset: 'monoRecommended' },
    flat: { preset: 'monoRecommended' },
    calibrate: { preset: 'monoRecommended' },
    register: { preset: 'monoRecommended' },
    stack: { preset: 'monoRecommended' },
    binningUpdate: false,
  });
  const cal = buildCalibrateScript({ settings });
  expectIncludes(cal, [
    'set core.binning_update=false',
    'stack bias rej 3 3 -nonorm',
    'calibrate flat -bias=',
    '-norm=mul',
    '-cc=dark',
  ], 'mono calibrate');
  const reg = buildRegisterScript({ settings });
  expectIncludes(reg, ['-2pass', 'seqapplyreg'], 'mono register');
  const stack = buildStackScript('result_OIII', { settings, frameCount: 22, binningUpdate: false });
  expectIncludes(stack, ['set core.binning_update=false', 'stack pp_light rej 3 3 -norm=addscale'], 'mono stack');
}

async function main() {
  console.log('qa-preprocess-settings');
  testDefaultsShape();
  testMonoRecommended();
  testBinningCheckbox();
  testCustomFlags();
  testFixturesFile();
  testHelpAndResolve();
  testWeightAndNormPermutations();
  testMonoAllStages();
  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll preprocess-settings checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
