#!/usr/bin/env node
/**
 * Flatten a night-date folder under a Veil-style project root.
 *
 * Moves children of <root>/<night>/ up into <root>/, then removes the empty
 * night folder. Dry-run by default; pass --apply to execute.
 *
 * Usage:
 *   node scripts/flatten-veil-night-folder.js --root "H:\…\NGC6960_Q326" [--night 260725]
 *   node scripts/flatten-veil-night-folder.js --root "F:\…\NGC6960_Q326" --apply
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

function parseArgs(argv) {
  const out = { apply: false, night: '260725', root: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--night') out.night = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('Unknown arg: ' + a);
  }
  return out;
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p) {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isEmptyDir(p) {
  const ents = await fsp.readdir(p);
  return ents.length === 0;
}

/**
 * Recursively plan moves from src into dest without overwriting files.
 * Returns { moves: [{from,to}], conflicts: [{from,to}], mkdirs: string[] }
 */
async function planMerge(src, dest, acc) {
  if (!(await pathExists(dest))) {
    acc.moves.push({ from: src, to: dest, kind: 'rename-tree' });
    return;
  }
  if (!(await isDir(src)) || !(await isDir(dest))) {
    acc.conflicts.push({ from: src, to: dest, reason: 'type-or-file-collision' });
    return;
  }
  const ents = await fsp.readdir(src, { withFileTypes: true });
  for (const ent of ents) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      if (!(await pathExists(to))) {
        acc.mkdirs.push(to);
        acc.moves.push({ from, to, kind: 'rename-tree' });
      } else {
        await planMerge(from, to, acc);
      }
    } else {
      if (await pathExists(to)) {
        acc.conflicts.push({ from, to, reason: 'file-exists' });
      } else {
        acc.moves.push({ from, to, kind: 'rename-file' });
      }
    }
  }
}

async function applyPlan(plan, apply) {
  for (const d of plan.mkdirs) {
    console.log((apply ? 'MKDIR ' : 'would mkdir ') + d);
    if (apply) await fsp.mkdir(d, { recursive: true });
  }
  for (const m of plan.moves) {
    console.log((apply ? 'MOVE  ' : 'would move  ') + m.from + '  ->  ' + m.to);
    if (apply) {
      await fsp.mkdir(path.dirname(m.to), { recursive: true });
      await fsp.rename(m.from, m.to);
    }
  }
}

async function removeEmptyTree(dir) {
  if (!(await pathExists(dir))) return;
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await removeEmptyTree(p);
  }
  if (await isEmptyDir(dir)) {
    await fsp.rmdir(dir);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.root) {
    console.log(`Usage: node scripts/flatten-veil-night-folder.js --root <projectRoot> [--night 260725] [--apply]`);
    process.exit(args.help ? 0 : 1);
  }

  const root = path.resolve(args.root);
  const nightDir = path.join(root, args.night);

  if (!(await pathExists(root))) throw new Error('Root not found: ' + root);
  if (!(await pathExists(nightDir))) {
    console.log('Nothing to do — night folder missing:', nightDir);
    return;
  }
  if (!(await isDir(nightDir))) throw new Error('Night path is not a directory: ' + nightDir);

  console.log(args.apply ? 'APPLY' : 'DRY-RUN', 'flatten', nightDir, '→', root);

  const plan = { moves: [], conflicts: [], mkdirs: [] };
  const children = await fsp.readdir(nightDir, { withFileTypes: true });
  for (const ent of children) {
    const from = path.join(nightDir, ent.name);
    const to = path.join(root, ent.name);
    await planMerge(from, to, plan);
  }

  if (plan.conflicts.length) {
    console.error('\nConflicts (aborting — no silent overwrite):');
    for (const c of plan.conflicts) {
      console.error('  ', c.reason, c.from, '->', c.to);
    }
    process.exit(2);
  }

  await applyPlan(plan, args.apply);

  if (args.apply) {
    await removeEmptyTree(nightDir);
    if (await pathExists(nightDir)) {
      console.error('Night folder not empty after move — left in place:', nightDir);
      const left = await fsp.readdir(nightDir);
      console.error('  remaining:', left.join(', '));
      process.exit(3);
    }
    console.log('Removed empty', nightDir);
  } else {
    console.log('would remove empty', nightDir, '(if empty after moves)');
  }

  console.log('Done.', plan.moves.length, 'moves,', plan.mkdirs.length, 'mkdirs.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
