#!/usr/bin/env node
/** Unit QA: Siril .seq cull parsing + listRPpLights / listPpLights exclusions. */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  parseSirilSeq,
  ppLightBasename,
  writeAggregateCullManifest,
  findSirilSeqFile,
} = require('../src/siril/sirilSeq');
const { listPpLights, listRPpLights, buildRegisterScript, buildStackScript } = require('../src/siril/preprocess');

const FIXTURE = `#Siril sequence file. Contains list of images, selection, registration data and statistics
#S 'sequence_name' start_index nb_images nb_selected fixed_len reference_image version variable_size fz_flag drizzle
S 'r_pp_light_' 1 24 19 5 5 6 0 0 0
L 1
I 1 0
I 2 0
I 3 0
I 4 0
I 5 0
I 6 1
I 7 1
I 8 1
I 9 1
I 10 1
I 11 1
I 12 1
I 13 1
I 14 1
I 15 1
I 16 1
I 17 1
I 18 1
I 19 1
I 20 1
I 21 1
I 22 1
I 23 1
I 24 1
`;

function testParseFixture() {
  const parsed = parseSirilSeq(FIXTURE);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.frames.length, 24);
  assert.strictEqual(parsed.header.selectedCount, 19);
  assert.strictEqual(parsed.frames[0].basename, 'r_pp_light_00001.fit');
  assert.strictEqual(parsed.frames[0].included, false);
  assert.strictEqual(parsed.frames[5].basename, 'r_pp_light_00006.fit');
  assert.strictEqual(parsed.frames[5].included, true);
  const excluded = parsed.frames.filter((f) => !f.included);
  assert.strictEqual(excluded.length, 5);
  console.log('parseSirilSeq r_pp_light fixture OK — 19 included, 5 excluded');
}

function testBasename() {
  assert.strictEqual(ppLightBasename('r_pp_light_', 1, 5), 'r_pp_light_00001.fit');
  assert.strictEqual(ppLightBasename('pp_light_', 24, 5), 'pp_light_00024.fit');
  console.log('ppLightBasename OK');
}

function testScripts() {
  const reg = buildRegisterScript();
  assert.ok(/register pp_light/.test(reg));
  assert.ok(!/stack r_pp_light/.test(reg));
  const stackOnly = buildStackScript('result_Ha', { reregister: false });
  assert.ok(/stack pp_light/.test(stackOnly));
  assert.ok(!/register pp_light/.test(stackOnly));
  const stackRe = buildStackScript('result_Ha', { reregister: true });
  assert.ok(/register pp_light/.test(stackRe));
  assert.ok(/stack r_pp_light/.test(stackRe));
  console.log('buildRegisterScript / buildStackScript OK');
}

async function testManifestAndList(dir) {
  await writeAggregateCullManifest(dir, [
    'r_pp_light_00001.fit',
    'r_pp_light_00002.fit',
    'r_pp_light_00003.fit',
    'r_pp_light_00004.fit',
    'r_pp_light_00005.fit',
  ]);
  const hasR = fs.readdirSync(dir).some((n) => /^r_pp_light_\d/i.test(n));
  if (hasR) {
    const rLights = listRPpLights(dir);
    assert.ok(rLights.length < 24, 'expected cull to drop some r_pp_light');
    console.log('listRPpLights + culled.txt OK —', rLights.length, 'frames');
  } else {
    console.log('no r_pp_light on disk yet; listPpLights count', listPpLights(dir).length);
  }
}

async function main() {
  testParseFixture();
  testBasename();
  testScripts();

  const liveAgg = 'F:\\zuko_dev\\Projects\\NGC6960_Q326\\Ha\\Aggregate';
  if (fs.existsSync(liveAgg)) {
    const seq = findSirilSeqFile(liveAgg);
    console.log('live prefer seq →', seq ? path.basename(seq) : '(none)');
    if (seq && fs.existsSync(seq)) {
      const parsed = parseSirilSeq(fs.readFileSync(seq, 'utf8'));
      assert.strictEqual(parsed.ok, true);
      console.log(
        'live seq OK —',
        parsed.frames.length,
        'frames,',
        parsed.frames.filter((f) => f.included).length,
        'included',
      );
    }
    await testManifestAndList(liveAgg);
    const manifest = path.join(liveAgg, 'culled.txt');
    if (fs.existsSync(manifest)) fs.unlinkSync(manifest);
    console.log('live aggregate restored (removed test culled.txt)');
  } else {
    console.log('skip live Aggregate test —', liveAgg, 'not found');
  }

  console.log('\nqa-siril-cull-seq: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
