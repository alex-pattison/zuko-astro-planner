# Working notes

Ongoing Dev scratchpad: bugs, fixes, go-live gates, and things to revisit. **Newest log entries at the top.**

Keep dated notes terse. Use the template below when useful.

## Template

```
### YYYY-MM-DD — build N — short title
- **Seen:** …
- **Cause:** … (if known)
- **Fix / next:** …
```

---

## Backlog

Canonical list: **[`docs/backlog.md`](backlog.md)** (0.2 polish vs 0.3 planning, best-practice app items, competitive notes).

Scratch items still land here until promoted:

- **Filter Wheel: add/edit filters** — Filter Target dropdown is fed from the hard-coded EFW slots; make the wheel section editable and the source of truth for available filters.

## Log

### 2026-08-17 — build 27 — Moon cycle day (not the waning twin)
- **Seen:** Beta showed **day 24** for a 26% waxing crescent (should be **day 5**).
- **Cause:** Astrospheric phase angle has two roots at the same illumination; a float compare picked the waning twin.
- **Fix:** Drop that flip; prefer Open-Meteo `moon_phase` (0=new); use next-phase list for waxing/waning. `npm run dist:win:beta`.

### 2026-08-16 — build 26 — CAA pipeline + camera-up flip
- Framer label **CAA** (0–359) = ASIAIR dial = `ROTATOR`/`NNNdeg`.
- Ingest: CAA mismatch forces target confirm; flats must match light CAA (±2°); darkflats soft-flag only.
- Camera-up marker inverted (local −Y) so ~211° reads upright for this train.
- Branch `debug/framer-rotation-asiair` kept open. `npm run dist:win:beta` for build 26.

### 2026-08-16 — debug/framer-rotation-asiair
- Branch renamed from `feat/editable-filter-wheel` (not started).
- **Bug:** Target Framer could vanish after reorder/re-render (empty placeholder slot; expand never rebuilt chrome). Fixed: always render framer details; detach before index remap; recover on expand.
- **Product:** Framer rotation slider is **0–359° ASIAIR CAA/ROTATOR** (was 0–180 planning angle). Label clarifies capture angle.
- **Data:** Dev Veil still **27°**; Beta Veil **40°** (separate JSON pools — not from FIT `211°`). Shots use ROTATOR **211°**.

### 2026-08-16 — build 25 — Dev bump; Beta dist installs on promote
- `zukoBuild` **25** (0.3.0). `npm run dist:win:beta` now builds **and** silent-installs + refreshes Desktop shortcut.
- If Desktop Beta still shows an old version, fully quit Beta and relaunch the Desktop icon (do not leave an old window open across install).

### 2026-08-16 — build 24 — Open 0.3.0 line
- **0.2.0 locked** (through build 23). Version bumped to **0.3.0**.
- Active 0.3.0 scope: backlog #1, #2, #3, #4, #6, #8, #11 (see `docs/backlog.md`). Starting with #1 editable filter wheel.
- `npm run dist:win:beta` for build 24 installer.

### 2026-08-16 — build 23 — Project reorder / dates / imaging config + ASIAIR filename parse
- Drag-reorder projects; shoot start/end from shot log (manual override); imaging config FOV in meta + framer; Set center unlocked.
- ASIAIR filenames: `294MM` / `gainN` / `NNNdeg` parse (header still wins when present).
- Idea catalog: `docs/backlog.md`.
- `npm run dist:win:beta` for build 23 installer.

### 2026-08-16 — build 22 — Moon altitude on Sky Forecast hours
- Hourly night tables: **Moon** column (after Seeing) shows `↑ nn°` / `↓` from local `_ASTRO.moonAltitude` — no Astrospheric credits.
- Tooltip: rise/set for that day. QA: `qa-sky-astro-modules` altitude vs rise/set.
- `npm run dist:win:beta` for build 22 installer.

### 2026-08-16 — build 21 — Import gate honors included flats/bias
- Included out-of-range flats and Bias count toward Import readiness (chip 30/30 no longer leaves Import disabled).
- `npm run dist:win:beta` for build 21 installer.

### 2026-08-16 — build 20 — Reimport wipe + remove-night delete
- Overwrite & import again deletes that night’s staged folder and the filter’s `Aggregate/` + `_stack/` (Calibrate / Register / Cull / Stack), then recopies.
- Remove night can also delete imported files + that filter’s downstream pipeline folders (`working/` stacks kept).
- `npm run dist:win:beta` for build 20 installer.

### 2026-08-16 — build 19 — Darkflat filter + ±12h pairing
- Session Bias (darkflats) must match flats’ **filter**, exp/gain/bin, light temp, and DATE-OBS within **±12h**. Other-filter Bias/Flats are omitted from the Import file lists.
- Bias chip is green when matching Bias count ≥ flat count. Same-filter frames outside ±12h stay optional via Include.
- Darks still ignore filter. QA: calib focused + `qa-asiair-ingest` (live last-night dump 30/30 Ha).
- `npm run dist:win:beta` for build 19 installer.

### 2026-08-12 — build 18 — Register → Cull → Stack (Siril .seq cull)
- Pipeline trunk: **Register** (aggregate nights into `Filter/Aggregate/` + Siril register → `r_pp_light_*`) → **Cull** (scan Siril `.seq`, write `culled.txt`) → **Stack** (optional re-register checkbox, default off).
- Cull popup lists included/excluded frames; Plot works on registered sequence. Aggregate folder keeps both `pp_light_*` and `r_pp_light_*`.
- QA: `qa-siril-cull-seq`, `qa-siril-register-stack` (synth + real mini Siril smoke); unit + e2e green.
- `npm run dist:win:beta` for build 18 installer.

### 2026-08-11 — build 17 — Import master-dark fallback + Siril script warn
- Import all / stage: if “Use matching master darks” is on but no library match, fall back to session darks instead of staging nothing.
- Banner when installed Siril `Mono_Preprocessing.ssf` differs from bundled reference (version header + hash); dismiss stores fingerprint.
- Volume-test helpers: `scripts/seed-veil-volume.js`, `scripts/seed-veil-import-source.js` (Dev only).
- `npm run dist:win:beta` for build 17 installer.

### 2026-08-11 — build 16 — Cleanup + source review polish
- Night **Cleanup** + project **Cleanup project** remove Siril intermediates (`masters`/`process`/`scripts`; project also `Aggregate`/`_stack`); keeps lights and `working/` results. In-app confirm modal (not Windows `confirm`).
- Night detail shows Folder size + Intermediates size; Copy Working Path; Source review shows ASIAIR path with Browse/Rescan.
- Capture/Cull unchecked = dashed stub; green connectors only between consecutive done steps.
- Red mode: filter colors remapped to red-only tones.
- `npm run dist:win:beta` for build 16 installer.

### 2026-08-10 — build 15 — Aggregate before Cull
- Per-filter trunk: **Aggregate → Cull → Register**. Aggregate hardlinks calibrated nights’ `process/pp_light_*` into `<Filter>/Aggregate/` (Siril home for cross-night cull). Register reads surviving Aggregate files (not re-gather from nights). Confirm modal includes Copy path.

### 2026-08-10 — build 15 — Imaging Pipeline polish + beta
- Cull/Register allowed on calibrated subset (not all nights); re-cal clears cull/reg for the channel.
- Merge SVG green stops at Cull; Cull→Register stays gray until Register is done.
- Confirm modals for Calibrate/Register; Register is the Register dot (no separate button).
- QA: unit + e2e green; Dev reset to Veil + NAN on `F:\zuko_dev` (ingested, cal/cull/stack clear).
- `npm run dist:win:beta` for build 15 installer.

### 2026-08-09 — build 14 — Imaging Pipeline merges Shoot Log + channel flow
- Replaced separate Shoot Log table + Preprocessing Pipeline with one **Imaging Pipeline**: per-filter channels, night rails Capture→Import→Calibrate, multi-night SVG fan-in into Cull→Register.
- Channel `+` locks shoot modal to that filter; rollup is `N nights · captured/planned`.
- Night chrome: row/chevron expands details; date edits; Edit/Remove in the detail panel (no always-on ✕).
- Merge lines: measured Calibration→Cull orthogonal SVG, redrawn on add/remove/resize.
- UX polish: single- and multi-night share the same rails|gutter|trunk grid; fixed step widths; shared `--pipeline-line` color; labels spaced off dots.

### 2026-08-09 — build 14 — pipeline: per-night Capture→Cal, channel Cull/Reg
- *(superseded by Imaging Pipeline merge)* Per-night Capture→Import→Calibration; Cull + Registration per filter.

### 2026-08-09 — build 14 — cleaned Dev data pool
- Reseeded `data/zuko-dashboard-data.json` from Beta H: dashboard (path-remapped to `F:\zuko_dev`).
- Synced Dark Library H→F; replaced polluted Veil F: tree with clean H: copy (shoots only; dangling Sirilic/Autorun links skipped).
- Cleared cal/stack meta + `process/` so preprocess can be re-run; NAN ingest paths wired.

### 2026-08-09 — build 13 — beta release (dark link fix)
- Promote hardlink-first `ensureLink`, replace dangling/0-byte dests, calibrate `UNREADABLE_FRAMES` preflight.
- `npm run dist:win:beta`; refresh Desktop Beta shortcut after install.

### 2026-08-09 — build 12 — cal failed on dangling Dark Library symlinks
- SII `260725_SII_B5_Queechy`: bias/flat OK; dark stack failed — `darks/` were relative symlinks to `…\Astrophotography\Dark Library\…` (missing `\Zuko`), 0-byte to Siril.
- Fix: `ensureLink` hardlink-first + replace broken dest; calibrate preflight rejects unreadable/0-byte FITS. Repaired this shoot’s 75 darks to hardlinks.

### 2026-08-09 — build 12 — beta release
- Promote latest main (darkflat↔flat + light-temp matching, Include overrides, Settings ASIAIR mount check, Bias Library removed).
- `npm run dist:win:beta`; refresh Desktop Beta shortcut after install.

### 2026-08-04 — remove Bias Library; session darkflats only
- Dropped Bias Library product (path, index, Import/Build master, master-bias matching).
- Dark Library remains; Import checkbox is “Use matching master darks” only.
- ASIAIR Bias (= darkflats) always stages from the session with flats → `_calibration/darkflats/<night>/`.

### 2026-08-04 — feat/dark-bias-library — Import chips + library Import tool
- *(superseded)* Shoot Import chips included Master bias; Calibration Library Import for Dark + Bias.
### 2026-08-04 — build 10 — ASIAIR Import + Veil flatten (beta release)
- Import from mounted ASIAIR root (`Autorun`/`Plan`/`Light`…); Settings source path; copy-only into projectDir.
- Veil project root flattened; DEV/BETA Electron profile isolation.
- Sample dump `F:\ASIAIR-SampleData` matches live mount (G: = those top-level folders). New Plan Ha 260803 needs night flats before Import can complete.

### 2026-08-03 — build 9 — Dev/Beta isolation (userData + single-instance)
- Dev and Beta no longer share Electron `userData` (`…\zuko-astro-planner-dev` vs `…-beta`).
- Per-channel single-instance lock: second Dev focuses the first Dev (same for Beta). Dev + Beta can still run together.
- Stronger DEV/BETA header badge. If UI still says “Ingest”, you’re on old Beta — use Dev (`npm start`) or rebuild Beta.

### 2026-08-03 — build 9 — Import from ASIAIR source (not projectDir)
- Renamed Shoot Log **Ingest → Import**; primary button **Import** (was Stage for Siril); status **already imported**.
- Import modal has **ASIAIR source** path at top (Browse / Rescan). Default from **Settings → ASIAIR source**; falls back to projectDir if unset.
- Scans/copies off the unit/USB `Autorun|Plan` tree; destination remains project `Filter/ShootCode/`. Real dumps: `Light_NGC 6960_…_S_20260725-….fit` under `lights/` (or singular `Light/`).

### 2026-08-03 — build 9 — Veil project root flatten + asiair/<night>
- **Layout:** Project directory is `NGC6960_Q326` (no night folder). Filter / `_calibration` / `working` live at that root (same shape as NAN Dev).
- **Disk:** Flattened `260725\` up into project root on H: Beta and F: Dev (`scripts/flatten-veil-night-folder.js`).
- **Dumps:** Prefer `asiair/<YYMMDD>/Autorun|Plan` per night; legacy root `Autorun`/`Plan` still discovered. Shoot Log → **Import ASIAIR dump** copies into `asiair/<YYMMDD>/` without staging. Live ASIAIR connect/watch deferred.
- **UI:** Project directory path ellipsis; light-mode darker SII/Ha filter tones.

### 2026-08-03 — build 9 — Filter dropdown + cull skip + log heartbeat
- Add Filter Target: **dropdown** of wheel filters (L/R/G/B/SII/Ha/OIII/Hb). Editable wheel filters → backlog.
- Calibration log modal: immediate banner + “still running…” heartbeats (Siril buffers stdout; dump arrives in bursts).
- Registration skips `process/pp_light_*` listed in `culled.txt` / `culled.lst` / `rejected.txt`, and any file already deleted. Cull-dot alert explains the workflow. In-app culling → backlog.

### 2026-08-03 — build 9 — Calibration/Registration rename + working/ + live logs
- Renamed pipeline steps: **Calibration** (was PP1), **Registration** (was PP2). Shoot button: Calibrate.
- Final stacks copy to `<projectDir>/working/result_<Filter>.fit` (create `working/` if missing). Intermediates stay in `<Filter>/_stack/`.
- Pipeline bars grouped by **filter name** (locations combine). Color-coded by filter tone (Ha/OIII/SII…); done dots green again.
- Live log via IPC `zuko-siril-log` + file poll; banner written immediately so the modal isn’t empty while Siril buffers.
- Seeded `Ha/260722_Ha_B9_Test50` (50 lights) for longer Calibration/log testing (`scripts/seed-ha-50-test.js`).

### 2026-08-03 — build 9 — Pipeline UX + 2-night seed
- Pipeline bars moved **below Shoot Log**; muted green/teal (less neon).
- **Register & stack** lives at the end of each filter’s pipeline row; enabled only when **all ingested shoots for that filter have PP1** and **Cull** is marked (click Cull dot).
- Pre-process opens a progress modal (min 3s) with live `calibrate.log` / `stack.log` tail + progress estimate.
- Synthetic night **260721** seeded per filter (hardlink/copy from 260720); shoot log has 6 rows; preprocess/stack/cull meta reset. Script: `scripts/seed-nan-second-night.js`.

### 2026-08-03 — build 9 — Siril preprocess automation (PP1 + PP2 + pipeline stub)
- **CLI:** `C:\Program Files\Siril\bin\siril-cli.exe` (`-d` workdir, `-s` script). Module: `src/siril/preprocess.js`; IPC `zukoSiril.calibrate` / `zukoSiril.stackFilter`.
- **PP1 (Pre-process button):** Mono 1.4 calibrate-only → `masters/` + `process/pp_light_*.fit` + `scripts/calibrate.ssf|.log` under each shoot. Stops before register.
- **PP2 (Register & stack):** Gathers `pp_light_*` from calibrated shoots → `<Filter>/_stack/calibrated/` (unique names) → convert/register/stack/mirrorx → `result_<Filter>.fit`.
- **UI:** Shoot Log Ingest/PP pair; Register & stack next to Ingest all; per-filter pipeline dots (Capture→Ingest→PP1→Cull stub→PP2) above Filter Targets.
- **Smoke (F:\zuko_dev\Projects\NGC7000_260720):** Ha calibrate → 10 `pp_light_*`; stack → `Ha\_stack\result_Ha.fit` (~45 MB). BU at `NGC7000_260720 - BU`.
- **Cull:** not implemented (pipeline dot stays stub / dashed).

### 2026-08-03 — build 9 — Siril reference → 1.4.4 scripts only
- Removed full outdated `reference/siril` git clone (old Mono_Preprocessing v1.0).
- Replaced with lean snapshot: `reference/siril/scripts/*.ssf` copied from installed Siril **1.4.4** + README pin. `reference/sirilic` full clone still gitignored.
- `.gitignore` now tracks the lean Siril scripts; still ignores `reference/sirilic/`.

### 2026-08-03 — build 9 — First Mono_Preprocessing run (SII shoot)
- **CWD:** `F:\zuko_dev\Projects\NGC7000_260720\SII\260720_SII_B9_Home\`
- **Script:** Installed Siril 1.4.4 `Mono_Preprocessing.ssf` — evidence: created `masters/`, final name `result_S_900s.fit` from `$FILTER` + `$LIVETIME` headers (5×180s = 900s). Canonical copy now at `reference/siril/scripts/` (1.4 snapshot; old full v1.0 clone removed).
- **Inputs unchanged:** `biases/` `darks/` `flats/` `lights/` (10/10/10/5 fits; biases/darks still hardlinked into `_calibration`).
- **Outputs added:**
  - `masters/bias_stacked.fit`, `dark_stacked.fit`, `pp_flat_stacked.fit`
  - `process/` work area (~67 files): convert sequences + calibrated/registered lights
  - `result_S_900s.fit` (~45 MB) at shoot root; also `process/result.fit` before the mirrorx/save rename
- **Convert behavior:** `bias_####.fit` / `dark_####.fit` / `flat_####.fit` / `light_####.fit` in `process/` are **symlinks** (0-byte reparse points) back to the source folders — Siril avoided copying RAWs. `pp_flat_*`, `pp_light_*`, `r_pp_light_*` are real new FITS.
- **Pipeline observed:** convert+stack biases → calibrate+stack flats (bias-sub) → convert+stack darks → convert+calibrate lights (dark+flat, `-cc=dark`) → register → stack → `mirrorx -bottomup` → save `result_$FILTER_$LIVETIME`.
- **Notes for Zuko integration:**
  - Working dir must be the **shoot folder** (`Filter/ShootCode`), not project root.
  - Expect `masters/` + `process/` + named `result_*.fit`; `process/` is disposable intermediate (large if not using symlinks).
  - Sequence files (`*.seq`) + `*_conversion.txt` document the convert mapping.
  - Registration cache under `process/cache/*.lst`.
- **Fix / next:** Automate this from Zuko (invoke Siril CLI/script per channel using `reference/siril/scripts/Mono_Preprocessing.ssf`); decide cleanup policy for `process/`; optional: per-filter bias/dark selection (SII channel currently still has shared H-named hardlinked biases from earlier staging).

### 2026-08-03 — build 9 — Single Dev checkout (C:) + F:\zuko_dev imaging only
- **Seen:** Two clones (`C:\Users\…\Projects` + `F:\GitHub`) caused edits to miss the running app.
- **Layout now:** Code + Dev JSON = `C:\Users\alexp\Projects\zuko-astro-planner`. Dev FITS = `F:\zuko_dev\Projects` + `F:\zuko_dev\Dark Library`. Beta = H: only. Duplicate `F:\GitHub\zuko-astro-planner` clone marked retired (`RETIRED-DO-NOT-USE.txt` + `npm start` disabled); rename/delete when nothing has the folder locked.

### 2026-08-03 — build 9 — F:\zuko_dev Dev imaging pool (Siril prep)
- **Seen:** Need isolated Dev copies of real projects for Siril/Sirilic work without touching Beta on H:.
- **Layout:** `F:\zuko_dev\Projects\NGC7000_260720`, `F:\zuko_dev\Projects\NGC6960_Q326` (Veil + Sirilic), empty `F:\zuko_dev\Dark Library`, projects root `F:\zuko_dev\Projects`. Dev JSON: `<checkout>/data/zuko-dashboard-data.json`. Beta stays on `H:\...\Dashboard` + `H:\...\Zuko\`.
- **Fix / next:** `resolveProjectsRoot()` uses `F:\zuko_dev\Projects` when channel=dev. Seed script: `scripts/seed-dev-f-zuko-json.js`.

### 2026-08-02 — build 9 — Slow cold start, blank blue page
- **Seen:** On launch, UI sits on an empty/blue page for a long time (up to ~10s) before dashboard data appears. No loading indicator, so it looks hung.
- **Cause:** Unknown yet (likely data load / render path before first paint).
- **Fix / next:** Add a visible loading state (spinner/skeleton/status text) as soon as the shell opens; then profile what’s blocking (disk reconcile, large JSON parse, heavy first render).

### 2026-08-02 — build 9 — Dev/Beta channel split
- **Seen:** Packaged Beta could not save Astrospheric key (`ENOENT` on `app.asar/.env`). Header/channel label and Z taskbar icons landed after channel work.
- **Cause:** Packaged app tried to read/write `.env` inside read-only asar; icon `.ico` needed proper embedding + Windows cache clear.
- **Fix / next:** Beta `.env` lives on `H:\Photography\Astrophotography\Dashboard\.env`. Dev = F:\ checkout `data/`. Promote to Beta via `beta-release` + `npm run dist:win:beta` when ready.

### 2026-07-29 — builds 6–7 — Go-live / ingest notes
- Logged copy→move as a hard go-live gate for ingest.
- Stage for Siril stays disabled (and greys out) without Light/Flat/Bias/Dark; darks must be session and/or matching masters.
- RA/Dec Light-folder matching + Aladin pre-ingest confirm (build 6).
- Ready-only Ingest-all counts; red-theme Captured/Ingest buttons; synthetic dashboard projects cleared (build 7).
- **Must** validate ingest + target-match on real ASIAIR data before v1 launch.

---

## Go-live considerations (v1)

Checklist of deliberate **pre-production** choices to revisit before shipping / trusting real ASIAIR dumps.

### Must change before v1

#### [ ] Ingest: copy → move for staged FITS

**Today (safe for testing):** staging **copies** lights/flats into the Siril tree and **copies** biases/session darks into `_calibration/…` (then symlinks). ASIAIR source folders are never modified — important while iterating on ingest.

**Before go-live:** switch to **move** (or move-then-symlink) for frames that should leave the dump once ingested, so disk isn’t doubled and the Autorun/Plan tree reflects what’s already been claimed.

Likely touch points:

- `src/ingest/asiairIngest.js` — `ensureCopied` / bias + session-dark calibration paths / light & flat staging loops
- Confirm master-library darks stay **symlink-only** (never move out of the dark library)
- Restage / `DEST_EXISTS` / force overwrite behavior with moves
- QA harness + Rosette test fixture expectations (fixtures assume copy-safe re-runs)

#### [ ] Real-world ASIAIR dump validation (hard gate)

**Before v1 launches:** run the full planner → Review source → target confirm → Ingest / Ingest all → Stage for Siril loop against a **real** ASIAIR Autorun/Plan dump (not `staging/asiair-*` synthetic fixtures). Confirm:

- RA/Dec auto vs confirm bands feel right on real multi-folder nights
- ROTATOR / framer FOV comparison is usable in the field
- Single-shoot ingest does not spam unrelated folder confirms
- Ingest-all ready counts skip missing-flats / no-log rows
- Master dark matching + bias/dark linking on a real library path
- Dashboard shoot log / logged hours stay correct after stage

Synthetic fixtures (`build-*-fixture.js`, Playwright E2E) stay for regression; they are not a substitute for this pass.

### Also consider

- [ ] Symlink permissions on a clean Windows profile (Developer Mode / admin) — verify bias/dark links don’t silently fall back to full copies
- [ ] Multi-ingest restage UX when dest already exists (overwrite vs open folder)
- [ ] Tune RA/Dec target-match thresholds (`TARGET_MATCH_AUTO_DEG` 0.75° / `TARGET_MATCH_CONFIRM_DEG` 2.5°) after more real multi-target dumps
- [ ] Whether Bias/Dark should remain non–night-gated once real dumps mix multiple nights in one Autorun
- [ ] Keep `[TEST]` / fixture projects out of day-to-day dashboard data (rebuild scripts may re-add them locally — don’t commit)
- [ ] Build / installer bump and release notes for v1
- [ ] Cold-start loading indicator (see log: blank blue page up to ~10s)
