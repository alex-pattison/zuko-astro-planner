#!/usr/bin/env node
/**
 * QA: Register → Cull → Stack pipeline (synth + real mini smoke).
 *
 * - Synth: aggregate hardlinks, .seq prefer r_, cull manifest, script shapes
 * - Real: scan live Aggregate; optional 2-frame Siril register+stack in a temp project
 *
 * Usage: node scripts/qa-siril-register-stack.js
 * Env: ZUKO_QA_SKIP_SIRIL=1 to skip live siril-cli smoke
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const assert = require('assert');

const {
  parseSirilSeq,
  findSirilSeqFile,
  scanAggregateCull,
  writeAggregateCullManifest,
  listRPpLightBasenames,
} = require('../src/siril/sirilSeq');
const {
  aggregateFilter,
  registerFilter,
  stackFilter,
  listPpLights,
  listRPpLights,
  buildRegisterScript,
  buildStackScript,
  resolveSirilCli,
  aggregateDirFor,
} = require('../src/siril/preprocess');

const REAL_PROJECT = 'F:\\zuko_dev\\Projects\\NGC6960_Q326';
const REAL_AGG = path.join(REAL_PROJECT, 'Ha', 'Aggregate');
const REAL_NIGHT = path.join(REAL_PROJECT, 'Ha', '261010_Ha_B9_Home');

let failed = 0;
function check(name, cond, detail) {
  if (cond) console.log('  ok ', name);
  else {
    failed += 1;
    console.error('  FAIL', name, detail != null ? detail : '');
  }
}

async function withTemp(fn) {
  const root = path.join(os.tmpdir(), `zuko-reg-qa-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await fsp.mkdir(root, { recursive: true });
  try {
    await fn(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

function writeSeq(dir, name, inclusions) {
  // inclusions: array of 0|1 for frames 1..N
  const n = inclusions.length;
  const selected = inclusions.filter((x) => x).length;
  const lines = [
    `#Siril sequence file`,
    `S '${name}' 1 ${n} ${selected} 5 0 6 0 0 0`,
    `L 1`,
  ];
  inclusions.forEach((incl, i) => {
    lines.push(`I ${i + 1} ${incl ? 1 : 0}`);
  });
  fs.writeFileSync(path.join(dir, `${name}.seq`), lines.join('\n') + '\n');
}

async function testSynthScriptsAndSeq() {
  console.log('\n=== synth: scripts + seq prefer ===');
  const reg = buildRegisterScript();
  check('register script has register pp_light', /register pp_light/.test(reg));
  check('register script no stack', !/stack /.test(reg));
  const s0 = buildStackScript('result_Ha', { reregister: false });
  check('stack default no register', !/register pp_light/.test(s0) && /stack pp_light/.test(s0));
  const s1 = buildStackScript('result_Ha', { reregister: true });
  check('stack reregister has register+stack r_', /register pp_light/.test(s1) && /stack r_pp_light/.test(s1));

  await withTemp(async (root) => {
    fs.writeFileSync(path.join(root, 'pp_light_.seq'), "S 'pp_light_' 1 2 2 5 0 6 0 0 0\n");
    fs.writeFileSync(path.join(root, 'r_pp_light_.seq'), "S 'r_pp_light_' 1 2 1 5 0 6 0 0 0\nI 1 0\nI 2 1\n");
    const preferred = findSirilSeqFile(root);
    check('prefer r_pp_light_.seq', preferred && /r_pp_light_\.seq$/i.test(preferred), preferred);
    const parsed = parseSirilSeq(fs.readFileSync(preferred, 'utf8'));
    check('parsed r_ frames', parsed.ok && parsed.frames.length === 2);
    check('frame0 excluded', parsed.frames[0].included === false);
    check('frame1 included', parsed.frames[1].included === true);
  });
}

async function testSynthAggregateAndCull() {
  console.log('\n=== synth: aggregate + cull manifest ===');
  await withTemp(async (root) => {
    const projectDir = path.join(root, 'Proj');
    const nightA = path.join(projectDir, 'Ha', 'n1', 'process');
    const nightB = path.join(projectDir, 'Ha', 'n2', 'process');
    await fsp.mkdir(nightA, { recursive: true });
    await fsp.mkdir(nightB, { recursive: true });
    for (let i = 1; i <= 3; i += 1) {
      await fsp.writeFile(path.join(nightA, `pp_light_${String(i).padStart(5, '0')}.fit`), Buffer.alloc(256, i));
    }
    for (let i = 1; i <= 2; i += 1) {
      await fsp.writeFile(path.join(nightB, `pp_light_${String(i).padStart(5, '0')}.fit`), Buffer.alloc(256, 10 + i));
    }

    const agg = await aggregateFilter({
      projectDir,
      filter: 'Ha',
      shootDirs: [path.join(projectDir, 'Ha', 'n1'), path.join(projectDir, 'Ha', 'n2')],
    });
    check('aggregate ok', agg.ok, agg.error);
    check('aggregate 5 frames', agg.frameCount === 5, agg.frameCount);
    const aggDir = aggregateDirFor(projectDir, 'Ha');
    check('aggregate dir exists', fs.existsSync(aggDir));
    check('renumbered pp_light_00005', fs.existsSync(path.join(aggDir, 'pp_light_00005.fit')));

    // Fake registered siblings + seq
    for (let i = 1; i <= 5; i += 1) {
      await fsp.copyFile(
        path.join(aggDir, `pp_light_${String(i).padStart(5, '0')}.fit`),
        path.join(aggDir, `r_pp_light_${String(i).padStart(5, '0')}.fit`),
      );
    }
    writeSeq(aggDir, 'r_pp_light_', [0, 0, 1, 1, 1]);

    const scan = await scanAggregateCull(aggDir);
    check('scan ok', scan.ok, scan.error);
    check('scan prefers r_ seq', scan.seqPath && /r_pp_light_\.seq$/i.test(scan.seqPath), scan.seqPath);
    check('scan 3 included', scan.includedCount === 3, scan);
    check('scan 2 excluded', scan.excludedCount === 2, scan);

    const applied = await writeAggregateCullManifest(
      aggDir,
      scan.frames.filter((f) => !f.included).map((f) => f.basename),
    );
    check('manifest written', applied.ok && applied.excludedCount === 2);
    const surviving = listRPpLights(aggDir);
    check('listRPpLights = 3', surviving.length === 3, surviving.map((p) => path.basename(p)));
    check('excluded not listed', !surviving.some((p) => /00001|00002/.test(path.basename(p))));
  });
}

async function testRealAggregateScan() {
  console.log('\n=== real: Aggregate scan ===');
  if (!fs.existsSync(REAL_AGG)) {
    console.log('  skip — no', REAL_AGG);
    return;
  }
  const seq = findSirilSeqFile(REAL_AGG);
  check('live seq found', !!seq, seq);
  const rCount = listRPpLightBasenames(REAL_AGG).length;
  const ppCount = listPpLights(REAL_AGG).length;
  check('live has pp_light', ppCount > 0, ppCount);
  check('live has r_pp_light (post-Register)', rCount > 0, rCount);
  const scan = await scanAggregateCull(REAL_AGG);
  check('live scan ok', scan.ok, scan.error);
  check('live scan frames > 0', scan.totalCount > 0, scan.totalCount);
  console.log(
    `  info live: pp=${ppCount} r=${rCount} scan=${scan.includedCount}/${scan.totalCount}` +
      ` seq=${seq ? path.basename(seq) : 'none'}`,
  );

  // Round-trip apply then restore manifest
  const beforeManifest = path.join(REAL_AGG, 'culled.txt');
  const hadManifest = fs.existsSync(beforeManifest);
  const beforeText = hadManifest ? fs.readFileSync(beforeManifest, 'utf8') : null;
  try {
    const excluded = (scan.frames || []).filter((f) => !f.included).map((f) => f.basename);
    await writeAggregateCullManifest(REAL_AGG, excluded);
    const after = listRPpLights(REAL_AGG);
    check(
      'live listRPpLights honors exclusions',
      after.length === scan.includedCount,
      { after: after.length, included: scan.includedCount },
    );
  } finally {
    if (hadManifest) fs.writeFileSync(beforeManifest, beforeText);
    else if (fs.existsSync(beforeManifest)) fs.unlinkSync(beforeManifest);
  }
}

async function testRealSirilMiniSmoke() {
  console.log('\n=== real: Siril 2-frame register+stack smoke ===');
  if (process.env.ZUKO_QA_SKIP_SIRIL === '1') {
    console.log('  skip — ZUKO_QA_SKIP_SIRIL=1');
    return;
  }
  const cli = resolveSirilCli();
  if (!cli) {
    console.log('  skip — siril-cli not found');
    return;
  }
  if (!fs.existsSync(path.join(REAL_NIGHT, 'process'))) {
    console.log('  skip — no calibrated night', REAL_NIGHT);
    return;
  }
  const srcLights = fs
    .readdirSync(path.join(REAL_NIGHT, 'process'))
    .filter((n) => /^pp_light_\d+\.fit[s]?$/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, 2);
  if (srcLights.length < 2) {
    console.log('  skip — need ≥2 pp_light in night process/');
    return;
  }

  await withTemp(async (root) => {
    const projectDir = path.join(root, 'MiniProj');
    const shootDir = path.join(projectDir, 'Ha', 'qa_night');
    const processDir = path.join(shootDir, 'process');
    await fsp.mkdir(processDir, { recursive: true });
    for (let i = 0; i < srcLights.length; i += 1) {
      const dest = path.join(processDir, `pp_light_${String(i + 1).padStart(5, '0')}.fit`);
      await fsp.copyFile(path.join(REAL_NIGHT, 'process', srcLights[i]), dest);
    }

    console.log('  … registerFilter (2 frames, may take a few minutes)');
    const reg = await registerFilter({
      projectDir,
      filter: 'Ha',
      shootDirs: [shootDir],
    });
    check('registerFilter ok', reg.ok, reg.error || reg.code);
    if (!reg.ok) {
      console.error('  register logTail:', (reg.logTail || '').slice(-800));
      return;
    }
    check('register wrote r_pp_light', (reg.rPpLightCount || 0) >= 2, reg.rPpLightCount);
    const aggDir = reg.aggregateDir;
    check('Aggregate has r_ and pp_', listRPpLightBasenames(aggDir).length >= 2);

    // Exclude first registered frame in seq + manifest
    writeSeq(aggDir, 'r_pp_light_', [0, 1]);
    await writeAggregateCullManifest(aggDir, ['r_pp_light_00001.fit']);
    check('cull left 1 r_ frame', listRPpLights(aggDir).length === 1);

    console.log('  … stackFilter (1 included frame, no re-register)');
    const stack = await stackFilter({
      projectDir,
      filter: 'Ha',
      reregister: false,
    });
    // Stacking a single frame may fail in Siril (need ≥2) — accept either ok or known NO_/stack error
    if (stack.ok) {
      check('stackFilter ok', true);
      check('result fit exists', !!(stack.resultPath && fs.existsSync(stack.resultPath)), stack.resultPath);
    } else {
      console.log('  info stack with 1 frame failed (often expected):', stack.error || stack.code);
      // Re-include both and stack again
      writeSeq(aggDir, 'r_pp_light_', [1, 1]);
      await writeAggregateCullManifest(aggDir, []);
      console.log('  … stackFilter (2 frames)');
      const stack2 = await stackFilter({ projectDir, filter: 'Ha', reregister: false });
      check('stackFilter 2-frame ok', stack2.ok, stack2.error || stack2.code);
      if (stack2.ok) {
        check('working result exists', !!(stack2.resultPath && fs.existsSync(stack2.resultPath)), stack2.resultPath);
      } else {
        console.error('  stack logTail:', (stack2.logTail || '').slice(-800));
      }
    }
  });
}

async function main() {
  console.log('QA siril register/cull/stack');
  console.log('  siril-cli:', resolveSirilCli() || '(missing)');
  await testSynthScriptsAndSeq();
  await testSynthAggregateAndCull();
  await testRealAggregateScan();
  await testRealSirilMiniSmoke();

  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\nqa-siril-register-stack: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
