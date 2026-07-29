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

## Also consider

- [ ] Symlink permissions on a clean Windows profile (Developer Mode / admin) — verify bias/dark links don’t silently fall back to full copies
- [ ] Multi-ingest restage UX when dest already exists (overwrite vs open folder)
- [ ] Whether Bias/Dark should remain non–night-gated once real dumps mix multiple nights in one Autorun
- [ ] Remove or quarantine `[TEST] Rosette` / `staging/asiair-test-rosette` from day-to-day dashboard data
- [ ] Build / installer bump and release notes for v1

## Notes

Add new items here as we defer production behavior for easier testing. Date entries when useful.

- 2026-07-29 — Logged copy→move as a hard go-live gate for ingest.
- 2026-07-29 — Stage for Siril stays disabled (and greys out) without Light/Flat/Bias/Dark; darks must be session and/or matching masters.
