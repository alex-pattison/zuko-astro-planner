---
name: Siril preprocess automation
overview: "Add CLI-driven Siril preprocess #1 (per-shoot → pp_light) and #2 (per-filter register+stack), plus a simple pipeline status bar stub above filter targets—using Mono 1.4 settings via siril-cli."
todos:
  - id: siril-module
    content: "Add src/siril/preprocess.js: resolve CLI, generate calibrate/stack .ssf from Mono 1.4, spawn siril-cli, verify outputs"
    status: completed
  - id: ipc-preload
    content: Wire zuko-siril-calibrate + zuko-siril-stack-filter in main.js and preload.js
    status: completed
  - id: ui-pp1
    content: "Shoot Log: Pre-process button next to Ingest; persist preprocessMeta on shoot"
    status: completed
  - id: ui-pp2
    content: "Shoot log actions: Register & stack next to Ingest all; per-filter _stack + stackMeta"
    status: completed
  - id: pipeline-stub
    content: Per-filter horizontal pipeline dots above filter targets (Capture→Ingest→PP1→Cull→PP2)
    status: completed
  - id: dev-verify-notes
    content: Smoke on F:\zuko_dev\NGC7000_260720; note CLI + layout in working-notes.md
    status: completed
isProject: false
---

# Siril Preprocess Automation (1A + 2C)

## Answers locked in
- **1A:** Generate `.ssf` **and run** via `siril-cli` (`C:\Program Files\Siril\bin\siril-cli.exe`, flags `-d` / `-s`).
- **2C:** Per-shoot **Pre-process**, project-level **Register & stack**, and a **pipeline status bar stub**.
- **Safe test tree:** `F:\zuko_dev\Projects\NGC7000_260720` (BU at `…\NGC7000_260720 - BU`). Do not touch H: Beta.

## Pipeline (product)

```mermaid
flowchart LR
  Capture --> Ingest
  Ingest --> PP1["Pre-process 1 calibrate"]
  PP1 --> Cull["Cull later"]
  Cull --> PP2["Pre-process 2 register stack"]
  PP2 --> Result["One FIT per filter"]
```

Cull stays a stub (dot always pending / “manual in Siril for now”).

## File layout (backend)

Per staged shoot (already from ingest):

```text
<projectDir>/<Filter>/<ShootCode>/{biases,darks,flats,lights}/
```

**PP1** runs with cwd = that shoot folder; Mono-compatible outputs:

```text
…/<ShootCode>/masters/     # bias_stacked, dark_stacked, pp_flat_stacked
…/<ShootCode>/process/     # convert + pp_flat_* + pp_light_* (+ .seq)
…/<ShootCode>/scripts/calibrate.ssf
…/<ShootCode>/scripts/calibrate.log
```

**PP2** (per filter) collects `process/pp_light_*.fit` from ready shoots into a combine workspace with unique sequential names (Siril FAQ / Sirilic multi-session pattern):

```text
<projectDir>/<Filter>/_stack/
  pp_light_XXXXX.fit   # hardlink/copy from each shoot’s process/
  scripts/stack.ssf
  scripts/stack.log
  result_<Filter>.fit  # final (Mono stack settings + mirrorx)
```

Keep `pp_light` in each shoot’s `process/` as the durable calibrated set; `_stack/` is disposable working + final master.

## Script templates

Source of truth: [`reference/siril/scripts/Mono_Preprocessing.ssf`](reference/siril/scripts/Mono_Preprocessing.ssf).

| Job | Script content |
|-----|----------------|
| **PP1** | Bias → flat(+bias) → dark → convert lights → `calibrate light … -cc=dark`. **Stop** (no `register` / `stack` / `mirrorx`). |
| **PP2** | In `_stack/`: convert `pp_light` sequence (or load existing seq) → `register` → `stack` with Mono flags (`rej 3 3 -norm=addscale -output_norm -32b`) → `mirrorx -bottomup` → `save result_<Filter>` (or livetime sum if easy). |

Generate scripts into the shoot/`_stack` `scripts/` folders (not only reference/), so runs are auditable.

## Backend module

New: [`src/siril/preprocess.js`](src/siril/preprocess.js)

- `resolveSirilCli()` — default Program Files path; allow override later.
- `calibrateShoot({ shootDir })` — write `calibrate.ssf`, `spawn` `siril-cli -d shootDir -s scripts/calibrate.ssf`, capture log, verify `process/pp_light_*.fit` exist.
- `stackFilter({ projectDir, filter, shootDirs[] })` — build `_stack/` with unique `pp_light_*`, write `stack.ssf`, run CLI, verify final FIT.
- Return `{ ok, code, logPath, outputs, error }` style like ingest.

Wire in [`main.js`](main.js) + [`preload.js`](preload.js):

- `zuko-siril-calibrate` → `window.zukoSiril.calibrate`
- `zuko-siril-stack-filter` → `window.zukoSiril.stackFilter`

## UI ([`index.html`](index.html))

**Shoot Log table** (~Ingest column ~6811): add **Pre-process** button beside Ingest.
- Enabled when `sh.ingestPath` + `ingestMeta.stagedAt` and shoot dir has `lights/`.
- On click: resolve `destRoot` from `ingestMeta.destRoots` (match shoot filter) → `zukoSiril.calibrate` → set `sh.preprocessMeta = { calibratedAt, shootDir, ppLightCount, logPath }`.
- Done state when `preprocessMeta.calibratedAt` present.

**Shoot log actions** (~next to Ingest all ~6868): add **Register & stack**.
- Groups shoots by filter where `preprocessMeta.calibratedAt` is set.
- Runs `stackFilter` per filter group with ≥1 calibrated shoot (single-night still OK).
- Sets `project.filterTargets[i].stackMeta = { stackedAt, resultPath, shootCount }` (or equivalent on filter target).

**Pipeline bar stub** above filter-targets block (one bar **per filter**):
- Dots: `Capture → Ingest → PP1 → Cull → PP2`
- Fill from shoot/filter meta (any/all heuristics: e.g. PP1 = all ingested shoots for that filter calibrated; Cull = always hollow; PP2 = `stackMeta.resultPath` exists).
- Minimal CSS; no fancy animation required for stub.

## Gates / safety
- Refuse PP1 if staged folders missing bias/dark/flat/light.
- Refuse PP2 if no `pp_light_*.fit` found.
- If `process/` already has a full Mono run (e.g. existing SII `r_pp_light` / `result_S_*.fit`), PP1 still regenerates masters/pp_lights (overwrite process intermediates) — document; optional `force` later.
- Long-running: disable button + show status text; surface last log path on failure.
- Dev only against `F:\zuko_dev\…`; BU available to restore.

## Docs
- Short log entry in [`docs/working-notes.md`](docs/working-notes.md): CLI path, PP1/PP2 layout, pipeline stub, test on NGC7000 SII/Ha.

## Out of scope (this pass)
- Real culling UI / rejection filters.
- Sirilic darkflat path (keep Mono **bias** flat-calib).
- Auto-open Siril GUI.
- Beta/H: paths.
