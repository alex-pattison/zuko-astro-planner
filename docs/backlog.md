# Zuko idea catalog

Prune freely. Scratch / bugs: [`working-notes.md`](working-notes.md). Testing: [`testing.md`](testing.md).

**Status key:** keep · later · park · integrated (don’t ship alone)

---

## Keep

### 1. Editable filter wheel

Capture Plan filter dropdowns use a hard-coded EFW list. Settings should own add/rename/reorder and feed those dropdowns.

**Why:** First wheel change makes the UI lie.

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

### 5. ASIAIR Plan CSV / coords export from Target Framer

Export RA/Dec/rotation (later mosaic panels) in the CSV shape ASIAIR Plan can import.

**Why:** Pad setup without re-framing; same pattern CN users use with Telescopius → ASIAIR.

---

### 6. Surface gain / camera / rotator on nights & shoots

New dumps include `294MM`, `gain120`, `211deg` in filenames and FITS headers. Show them in the shoot/night UI.

**Notes (Alex):** Filename vs metadata as source of truth?

**Decision / best practice:** Prefer **FITS header when present**; use **filename as fallback** (and optionally flag mismatches). Ingest already merges that way (`mergeHeaderIntoParsed`). UI should display the merged values, not re-parse the name alone. A small “filename ≠ header” chip is a nice validation extra later.

---

### 7. Ingest move (or move-then-symlink)

Stop always leaving a full second copy of lights after import. Move claimed frames out of the dump once import is verified (or move + symlink).

**Why:** Dump + project tree doubles disk. Don’t delete until import OK.

---

### 8. Rotation alignment: lights ↔ flats (+ soft darkflat flag)

Soft warn when saved framer / project rotation ≠ recent dump `ROTATOR`. Going forward, treat **matching rotation as a requirement when pairing lights and flats** (re-shoot flats if rotation changed). Dark flats: optional soft flag only (less critical).

**Why:** Flats/stacks assume rotation; already in project notes.

---

### 9. Signed Windows Beta builds

Code-sign the installer so SmartScreen stops blocking.

---

### 10. Beta auto-update

Check GitHub Releases (or similar) and offer restart-to-update (`electron-updater`).

**Depends on:** #9 is nicer first; optional if manual install is fine.

---

### 11. Local crash / error log folder

Write last N main/renderer errors to a zipable folder. No cloud required.

---

### 12. First-run / empty-state guide

New install: walk “set ASIAIR dump + dark library” instead of empty projects.

**Why:** Clean machine / shared Beta. Lower priority for solo daily use.

---

### 13. In-app culling UI **(with FITS thumb / HFR preview)**

Cull inside Zuko (frame list + quality), write cull lists — beyond “scan Siril `.seq` + mark Cull done.”

**Requirement (Alex):** FITS thumbs and/or simple HFR (or similar) preview are **part of this feature**, not a follow-up. Without preview, don’t bother.

---

### 14. Imaging windows (alt + night + moon-by-filter)

Per project: when the target is high enough *and* moon is far enough for Ha vs OIII vs SII (Telescopius-style opportunity blocks).

**Notes (Alex):** Really cool — strong keep.

**Why:** Bortle 9 + narrowband priority.

---

### 15. Forecast ↔ project “best next N nights”

Sky Forecast ranks nights for *this* project/filter (e.g. Rosette Ha), not only generic weather.

**Depends on / pairs with:** #14.

---

### 16. Site horizon profile

Draw NYC roof / Queechy tree line so “visible” isn’t a flat altitude cut.

**Notes (Alex):** Same idea as Stellarium horizon — needed for home pier reality.

**Depends on:** After #14 is more useful.

---

### 17. Mosaic panels

Multi-panel grid with overlap % and per-panel centers (UI already says mosaics aren’t supported).

**When:** Only when a target won’t fit one reducer frame.

---

### 18. Mosaic → ASIAIR Plan CSV export

Export mosaic panel centers into ASIAIR Plan import CSV.

**Depends on:** #17. Little value alone. Natural extension of #5.

---

### 19. Optional Telescopius API target search

Search/highlights via Telescopius API (respect ToS / non-commercial).

**Why:** Richer discovery than name→coords. Sesame/MAST already covers lookup — keep optional.

---

### 20. “Highlights for my FOV + Bortle”

“These targets fit ~3.9°×2.7° and work from Bortle 9 this month.”

**Depends on:** Catalog and/or #14.

---

### 21. AstroBin deeper pull

Beyond storing a link — fetch public integration / plate-solve if API allows.

**Rec:** Low — links may be enough.

---

### 22. Session quality history chart

HFR / star count over nights — spot focus/seeing trends.

**Notes (Alex):** Interesting.

**Depends on:** A metric source (in-app cull #13, or Siril/export later).

---

## Integrated (don’t ship as standalone)

### Channel balance advisor

“You’re short SII; moon is up → prefer SII tonight.”

**Notes (Alex):** Fold into #14 / #15 / project UX — not a separate product.

---

## New from notes

### AI target composition & filter-hour estimates

Built-in help that suggests composition framing and hours per filter (Ha/OIII/SII/…) for a target given rig + site (Bortle, FOV).

**Notes (Alex):** Explicit project idea. Treat as research/spike before committing — data quality and “wrong advice” risk matter more than a chatbot wrapper.

**Pairs with:** #14–15, Capture Plan targets.

---

### Mobile viewing / companion

View forecast, projects, “go image” status on phone; later push notifications.

**Notes (Alex):** Wanted. Weather alerts (# below) become push on mobile.

**Status:** Later platform — not near-term Electron work.

---

### Cloud sync

Sync dashboard / settings across machines (or Dev↔laptop).

**Notes (Alex):** Wanted eventually. Was listed out-of-scope; moved here as aspirational.

**Status:** Later. Needs auth, conflict rules, and backup story (#2) first.

---

## Park / very low

### Export night plan → NINA sequencer

**Notes (Alex):** Low low priority — no plan to use NINA soon.

---

### Weather alerts / “go image” (desktop)

Notify when seeing/clouds/moon look good.

**Notes (Alex):** Fun; eventually mobile push. Astrospheric credits matter on desktop pulls.

**Status:** Park until #14–15 exist; revisit with mobile.

---

## Explicitly not doing (for now)

- Replacing ASIAIR / NINA as the **capture** controller  
- Full planetarium (Aladin framer is enough)  

~~Cloud sync~~ → moved to **New from notes**  
~~Mobile companion~~ → moved to **New from notes**

---

## Removed in this cleanup

Dropped (empty sections / no keep signal): night summary strip, Dev vs Beta path labels, framer e2e-only item, per-filter hardlink bias edge case, deeper multi-site travel mode, plate-solve vs framer verify, import HFR from capture apps, cross-project aggregates, OpenAstronomyLog export.

---

## Sorting scratchpad

```text
## 0.2.x
-

## 0.3.x
-

## Later
- Mobile viewing / companion
- Cloud sync
- Weather alerts (with mobile)
- AI composition & filter hours (spike first)

## Park
- NINA sequencer export
```
