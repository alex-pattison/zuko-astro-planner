# ASIAIR ingest QA report

**Branch:** `testing-and-debugging`  
**Date:** 2026-07-29  
**Harness:** `scripts/qa-asiair-ingest.js`  
**Fixture:** `staging/asiair-qa/` (isolated copy under gitignored `staging/`)

### Ingest all — multi-night tabs
When pending Captured shoots span multiple nights, **Ingest all** shows a tab per night (YYMMDD + shoot count).  
- **Stage day (N)** — stages only the highlighted tab  
- **Stage all (M)** — stages every remaining night/queue  

After staging a day, that night’s tab drops away and the next night is selected automatically.

---


### Behavior
Ingest filter table **Shoot?** priority:
1. **already staged** — same filter + same night already has `ingestMeta.stagedAt`
2. **match** — pending for this ingest
3. **other** — everything else  

Staged on another night does **not** mark the same filter as staged on tonight’s scan.

### Harness coverage
- Synthetic Ha lights rewritten to `20260720` (same filter, different night)
- Night isolation: `20260720` scan is Ha-only; `20260725` still has Ha/OIII/SII
- Shoot? label unit checks for staged-vs-pending across nights

### How to manually verify
1. Reload app (quit first if open)
2. Veil shoot log: Ha `260720`, Ha `260725`, OIII `260725`, SII Queechy `260725` — all Captured
3. Ingest Ha on `260725` → Stage
4. Open OIII (or Ingest all for remaining on that night) → Ha row should say **already staged**, not **other**
5. Separately ingest Ha on `260720` — independent of the 0725 Ha shoot

---

## What was tested

### Unit / helpers
- Filter normalization (`H`→Ha, `O`→OIII, `S`→SII)
- Night normalization (`260725`→`20260725`) and D/D+1 night window
- Windows path normalization (collapsed double-backslashes)
- Master-dark **set folder** grouping (must be `Darks_180s_Bin2_-10c`, not `H`/`O`/`S`)
- Age flagging: darks older than ~6 months still **match**, but are flagged `expired`
- Temp mismatch beyond ±3°C is rejected

### Pipeline (against `staging/asiair-qa`)
- Discover `Autorun` under project dir
- Scan night `20260725` with Veil target hint → Ha + OIII + SII lights
- Index real master dark library on `H:\…\Zuko\Dark Library` (75 frames)
- Match master darks for light exp/gain/temp
- **Frame readiness** — requires Light + Flat + Bias + Dark; missing → `MISSING_FRAMES`
- Stage without master dark matches → `MISSING_FRAMES`
- Stage Ha with master darks (symlink into channel `darks/`)
- Confirm dark symlinks point at the library (not `_calibration/darks`)
- Restage without `force` → `DEST_EXISTS`
- Force restage succeeds
- Stage OIII and reuse biases already in `_calibration/darkflats/<night>`
- Wrong night (`20260101`) finds no lights
- Multi-day Ha isolation + Shoot? column priority

### Dashboard data sanity
- `appMeta.build` present
- Dark library path not double-escaped
- Veil `projectDir` + captured shoots + `loggedHrs` vs shoot log
- Assets: SV165 present / SV106 gone; release dates filled

### Result
**61 passed, 0 failed** (2026-07-29).

---

## Bugs found

### 1. Biases gated on shoot night (real)
Session **darks** were intentionally not night-filtered, but **biases / dark flats** were. ASIAIR Bias frames are often dated differently from the lights (fixture biases were `20260714` vs lights `20260725`), so scans returned **0 biases**, staging wrote empty `biases/`, and same-night multi-filter ingest could not reuse calibration.

### 2. `ingestMeta.darkLibrary` pointed at filter letter folders (real)
With a library layout like `Dark Library/Darks_180s_Bin2_-10c/{H,O,S}/`, staging stored  
`…\Darks_180s_Bin2_-10c\H` because it used `path.dirname(file)`. That is a filter subfolder, not the set folder.

### 3. Not bugs (verified OK)
- Double-escaped dark library path: already normalized; UI grouping works
- Aged darks: flagged, not excluded
- Master darks: symlinked from library; not copied into `_calibration` when master mode is on
- Restage guard / force overwrite behavior
- Filter `loggedHrs` consistency with shoot log

---

## Fixes applied

1. **`scanSession`** — biases/dark flats are no longer filtered by shoot night (same policy as session darks).
2. **`masterDarkSourceSetDir`** — walks up past `H`/`O`/`S`/etc. so `meta.darkLibrary` is the set folder (`Darks_180s_…`).
3. **Dashboard JSON** — corrected existing Veil `ingestMeta.darkLibrary` paths on local + `H:` copies.
4. **`evaluateIngestFrameReadiness` / UI stage gate** — Stage disabled and `stageSirilTree` returns `MISSING_FRAMES` unless Light, Flat, Bias, and Dark are all present (Dark = session or master library when checkbox is on).

---

## How to re-run

```bash
node scripts/qa-asiair-ingest.js
```

Requires:
- `staging/asiair-sample/Autorun` as the FITS source for the QA copy
- Master dark library at `H:\Photography\Astrophotography\Zuko\Dark Library` (optional for match/stage darks tests; those asserts fail if missing)

Machine-readable last run: `staging/asiair-qa-report.json` (gitignored).
