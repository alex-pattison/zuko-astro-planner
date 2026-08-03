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

## Log

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

### 2026-08-03 — build 9 — F:\zuko_dev Dev imaging pool (Siril prep)
- **Seen:** Need isolated Dev copies of real projects for Siril/Sirilic work without touching Beta on H:.
- **Layout:** `F:\zuko_dev\Projects\NGC7000_260720`, `F:\zuko_dev\Projects\NGC6960_Q326` (Veil + Sirilic), empty `F:\zuko_dev\Dark Library`, projects root `F:\zuko_dev\Projects`. Dev JSON: `F:\GitHub\zuko-astro-planner\data\zuko-dashboard-data.json`. Beta stays on `H:\...\Dashboard` + `H:\...\Zuko\`.
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
