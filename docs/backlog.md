# Zuko backlog

Scratch / bugs: [`working-notes.md`](working-notes.md). Testing: [`testing.md`](testing.md).

**On every build or version ship:** update this file *and* the [0.3.0 planning canvas](C:/Users/alexp/.cursor/projects/c-Users-alexp-Projects-zuko-astro-planner/canvases/zuko-backlog-02-vs-03.canvas.tsx) (current `version` / `zukoBuild`, shipped items, next headline).

| Line | Status |
|------|--------|
| **0.2.0** | **Locked** — shipped through build 23 (project reorder, imaging config, ASIAIR filename parse, moon altitude, pipeline). |
| **0.3.0** | Active — items below. |
| **Backlog** | Everything else. |

---

## 0.3.0 (active)

### 1. Editable filter wheel — *shipped build 29*

Filters section is the source of truth (add/edit/remove, slot, color). Capture Plan dropdowns read `data.filters`.

---

### 23. Filter mount + size (before go-live)

Today the catalog is only names and slot numbers. Spell the hardware so it isn’t implied EFW 8×31.

- **Mount:** integrated filter, filter drawer, or filter wheel. If a wheel: which one and how many slots.
- **Slot numbers:** only when the mount is a wheel (the numbers already on each filter). Hidden/omitted for integrated and drawer.
- **Size:** a size field on each filter (e.g. 31mm unmounted / 2").

**Why:** Next wheel or drawer change would make the UI lie again.

---

### 2. Dashboard JSON backup / restore

One-click export of `zuko-dashboard-data.json` + restore picker (timestamped copies).

**Why:** QA resets and Dev/Beta mixups already wipe or rewrite local data.

---

### 3. `dataVersion` + migrate-on-load

Stamp dashboard JSON with a schema version; on open, run small migrations instead of forever-inferring fields.

**Why:** Data shape keeps evolving. Pairs with #2.

---

### 4. Startup loading skeleton

Spinner/skeleton while disk reconcile + first render finish.

**Why:** Blank/frozen shell on launch (already in working-notes).

---

### 6. Surface gain / camera / rotator on nights & shoots

New dumps include `294MM`, `gain120`, `211deg` in filenames and FITS headers. Show them in the shoot/night UI.

**Source of truth:** Prefer **FITS header when present**; **filename as fallback** (optionally flag mismatches). Ingest already merges that way. UI should display merged values.

---

### 8. CAA alignment: Target Framer ↔ ASIAIR ↔ lights ↔ flats — *shipped (0.3.0 builds 26–32)*

One number: Target Framer **CAA** = ASIAIR dial = FITS/`NNNdeg` **ROTATOR**. Confirm when project CAA ≠ dump lights. Import gates lights/flats vs Target Framer (±10° or 180°±10° after meridian flip); bias/darks ignore CAA. File list CAA column + Use checkboxes. Determinate Import progress (% + file counts). Shoot header light count uses staged totals (not pre-reject scan). Alert when ASIAIR source is offline. Dashboard saves snapshot to `backups/` and refuse empty-projects overwrite. Register/Cull/Stack match filter display names to tone keys (Ha/OIII/SII). Camera-up marker matches this train; NASA moon stills local.

**Why:** Same dial value for framing, shooting, and ingest checks (target + flats).

---

### 11. Local crash / error log folder

Write last N main/renderer errors to a zipable folder. No cloud required.

---

### 24. Dark-flat library (like Dark Library)

Reusable master dark flats, not only the ASIAIR Bias folder that rode in with that night’s flats.

- Import / build masters the way Dark Library does (copy from dump → set folders → stack).
- Match on **filter + exp / gain / temp / bin** (dark flats are per-filter; darks are not).
- Import checkbox: use matching library dark flats when the session Bias set is missing or you choose library over session.
- 0.2 removed a **Bias Library** product on purpose (session darkflats only). This is the 0.3 revisit with the right name and match keys — not a revival of offset-bias masters.

**Why:** Same dark flats get reshot every flat set. A library stops duplicating disk and lets a good set cover later nights.

---

## Backlog

### ASIAIR / ingest / framer

#### 25. ASIAIR session logs (Autorun / Plan / PHD2) — *merged to main*

Read `{asiairSource}/log/` beside Import. Persist digest on `ingestMeta.sessionLog` and copy logs into `shoot/session-logs/`. Soft-warn CAA vs plate Angle, planned vs staged lights, filter fails; guide quality on Calibrate/Cull.

**Why:** FITS alone miss plan name, AF, pauses, and guide RMS.

---

#### 5. ASIAIR Plan CSV / coords export from Target Framer

Export RA/Dec/rotation (later mosaic panels) in the CSV shape ASIAIR Plan can import.

#### 7. Ingest move (or move-then-symlink)

Move claimed frames out of the dump once import is verified (stop doubling disk).

#### 9. Signed Windows Beta builds

Code-sign the installer so SmartScreen stops blocking.

#### 10. Beta auto-update

`electron-updater` + GitHub Releases; nicer after #9.

#### 12. First-run / empty-state guide

Walk “set ASIAIR dump + dark library” on clean install.

#### 17. Mosaic panels

Multi-panel grid with overlap % and per-panel centers.

#### 18. Mosaic → ASIAIR Plan CSV export

Depends on #17; extension of #5.

---

### Planning / discovery

#### 14. Imaging windows (alt + night + moon-by-filter)

Per project: high enough *and* moon far enough for Ha vs OIII vs SII.

#### 15. Forecast ↔ project “best next N nights”

Rank nights for *this* project/filter. Pairs with #14.

#### 16. Site horizon profile

NYC roof / Queechy tree line (Stellarium-style). More useful after #14.

#### 19. Optional Telescopius API target search

Respect ToS / non-commercial. Sesame/MAST already covers lookup.

#### 20. “Highlights for my FOV + Bortle”

Seasonal targets that fit FOV from city LP. Needs catalog and/or #14.

#### 21. AstroBin deeper pull

Fetch public integration / plate-solve if API allows. Links may be enough.

#### Channel balance advisor *(integrated)*

Fold into #14 / #15 / project UX — not a standalone feature.

#### AI target composition & filter-hour estimates

Suggest framing + hours per filter for rig + site. Spike first — wrong-advice risk.

---

### Processing / quality

#### 26. Siril preprocessing settings (Default / Mono Recommended / Custom) — *shipped build 33* · polish *build 34*

Per-stage presets on Calibrate / Register / Stack confirms; Custom unlocks Siril flags with (i) help. SHO/Hβ → Mono Recommended, LRGB → Default. Stack: binning checkbox (default off → `core.binning_update=false`). Docs: `docs/preprocess-settings.md`; QA: `scripts/qa-preprocess-settings.js`.

Build 34: stable Calibrate→Register merge lines while popups open; human-readable Last run; Veil Queechy capture-plan row restored (disk was intact).

#### 27. CD for Siril (clipboard) — *shipped build 35*

Cull + Imaging Pipeline buttons copy `cd "…"` for Siril’s command bar (Aggregate / `working/`). Plan Shoot date quick fills: Yesterday · Today · Tomorrow. QA: `scripts/qa-siril-cd-command.js`.

#### 13. In-app culling UI **(requires FITS thumb / HFR preview)**

Cull in Zuko with thumbs/metrics. Without preview, don’t bother.

#### 22. Session quality history chart

HFR / star count over nights. Needs a metric source (#13 or export).

---

### Platform / later

#### Mobile viewing / companion

Forecast / projects / “go image” on phone; later push notifications.

#### Cloud sync

Across machines. Needs auth, conflicts, and backup (#2) first.

#### Weather alerts / “go image”

Park until imaging windows exist; revisit with mobile push. Astrospheric credits matter.

#### Export night plan → NINA sequencer

Park — no plan to use NINA soon.

---

### Explicitly not doing (for now)

- Replacing ASIAIR / NINA as the **capture** controller
- Full planetarium (Aladin framer is enough)
