# Go-live considerations (v1)

Checklist of deliberate **pre-production** choices to revisit before shipping / trusting real ASIAIR dumps.

## Must change before v1

### [ ] Ingest: copy → move for staged FITS

**Today (safe for testing):** staging **copies** lights/flats into the Siril tree and **copies** biases/session darks into `_calibration/…` (then symlinks). ASIAIR source folders are never modified — important while iterating on ingest.

**Before go-live:** switch to **move** (or move-then-symlink) for frames that should leave the dump once ingested, so disk isn’t doubled and the Autorun/Plan tree reflects what’s already been claimed.

Likely touch points:

- `src/ingest/asiairIngest.js` — `ensureCopied` / bias + session-dark calibration paths / light & flat staging loops
- Confirm master-library darks stay **symlink-only** (never move out of the dark library)
- Restage / `DEST_EXISTS` / force overwrite behavior with moves
- QA harness + Rosette test fixture expectations (fixtures assume copy-safe re-runs)

### [ ] Real-world ASIAIR dump validation (hard gate)

**Before v1 launches:** run the full planner → Review source → target confirm → Ingest / Ingest all → Stage for Siril loop against a **real** ASIAIR Autorun/Plan dump (not `staging/asiair-*` synthetic fixtures). Confirm:

- RA/Dec auto vs confirm bands feel right on real multi-folder nights
- ROTATOR / framer FOV comparison is usable in the field
- Single-shoot ingest does not spam unrelated folder confirms
- Ingest-all ready counts skip missing-flats / no-log rows
- Master dark matching + bias/dark linking on a real library path
- Dashboard shoot log / logged hours stay correct after stage

Synthetic fixtures (`build-*-fixture.js`, Playwright E2E) stay for regression; they are not a substitute for this pass.

## Also consider

- [ ] Symlink permissions on a clean Windows profile (Developer Mode / admin) — verify bias/dark links don’t silently fall back to full copies
- [ ] Multi-ingest restage UX when dest already exists (overwrite vs open folder)
- [ ] Tune RA/Dec target-match thresholds (`TARGET_MATCH_AUTO_DEG` 0.75° / `TARGET_MATCH_CONFIRM_DEG` 2.5°) after more real multi-target dumps
- [ ] Whether Bias/Dark should remain non–night-gated once real dumps mix multiple nights in one Autorun
- [ ] Keep `[TEST]` / fixture projects out of day-to-day dashboard data (rebuild scripts may re-add them locally — don’t commit)
- [ ] Build / installer bump and release notes for v1

## Notes

Add new items here as we defer production behavior for easier testing. Date entries when useful.

- 2026-07-29 — Logged copy→move as a hard go-live gate for ingest.
- 2026-07-29 — Stage for Siril stays disabled (and greys out) without Light/Flat/Bias/Dark; darks must be session and/or matching masters.
- 2026-07-29 — RA/Dec Light-folder matching + Aladin pre-ingest confirm (build 6).
- 2026-07-29 — Ready-only Ingest-all counts; red-theme Captured/Ingest buttons; synthetic dashboard projects cleared (build 7).
- 2026-07-29 — **Must** validate ingest + target-match on real ASIAIR data before v1 launch.