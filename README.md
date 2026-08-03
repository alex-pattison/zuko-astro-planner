# Zuko Astro Planner

Desktop astrophotography planner and rig dashboard for Alex's imaging setup.

Baseline UI comes from the existing standalone HTML/Electron dashboard (`rig-dashboard-v6` lineage). This repo is a new project — not a fork.

## Setup (any machine)

1. Install [Node.js LTS](https://nodejs.org) if needed.
2. Clone or pull this repo.
3. From this folder:
   ```
   npm install
   npm start
   ```

Desktop shortcut (optional): point at `node_modules\electron\dist\electron.exe` with arguments `.` and this folder as the working directory.

## Dev vs Beta

Two side-by-side channels with **separate data pools** (they never sync):

| Channel | How you run it | Data root |
|---|---|---|
| **Dev** | `npm start` from a checkout | `<checkout>/data/` (Dev home: `F:\GitHub\zuko-astro-planner`) |
| **Beta** | NSIS installer (`npm run dist:win:beta`) | `H:\Photography\Astrophotography\Dashboard` |

- Window title shows **Dev** or **Beta** so you know which pool is open.
- Override either pool with `ZUKO_DATA_DIR` (used by Playwright / QA).
- Force channel with `ZUKO_CHANNEL=dev` or `ZUKO_CHANNEL=beta`.
- Promote builds: merge `main` → `beta-release`, then `npm run dist:win:beta`.

**One-time Beta seed** (copies the freshest H: or repo JSON into the Beta folder, then writes `.beta-seeded`; re-runs are no-ops):

```
npm run seed:beta
```

## Data storage

- **Dev** loads/saves only `<checkout>/data/zuko-dashboard-data.json` (plus forecast/moon caches in that folder).
- **Beta** loads/saves only `H:\Photography\Astrophotography\Dashboard\zuko-dashboard-data.json` — no mirror into git `data/`.

localStorage is kept as a cache. Use **File → Open Data Folder** to jump to the active directory.

## ASIAIR ingest (Shoot Log)

Each project needs a **Project directory** (edit project) that contains ASIAIR `Autorun` and/or `Plan` folders with `Light` / `Flat` / `Bias` / `Dark` children. Lights may live under `Light/<Target>/`. Ingest **merges all sessions** into one source (no Autorun/Plan picker); the filter table shows a **Type** column (Autorun / Plan).

**Target match:** lights are matched to the project’s saved RA/Dec (Target Framer). Folders within **0.75°** auto-include; **0.75°–2.5°** (or ambiguous multi-folder dumps) open a pre-ingest Aladin side-by-side confirm before the staging window; farther folders are excluded unless you accept them. Flats / Bias / Dark stay shared (not target-gated).

From a shoot’s **Ingest** button:

1. Discovers `Autorun` / `Plan` under the project directory and scans them together.
2. Scans FITS **headers first** (filename fallback) for the shoot’s astronomical night (`D` and morning of `D+1`). Lights and flats are night-gated; session **Bias** (dark flats) and **Dark** frames are treated as reusable calibration and are not night-gated (shared across sessions).
3. Shows status chips for Light / Flat / Bias (dark flats) / session Dark, plus per-filter light/flat counts and shooting type.
4. **Blocks Stage** unless all four are present for the shoot: Light, Flat, Bias, and Dark (session darks, or matching master-library darks when that checkbox is on). Backend returns `MISSING_FRAMES` if staging is attempted anyway.
5. Stages session **darks** into each channel (exp+gain+temp match; filter ignored). On Ingest open, matches the shoot’s exp/gain/temp against the **master dark library** (`H:\Photography\Astrophotography\Zuko\Dark Library`) and notes hits; optionally stages those library darks when the checkbox is on (symlinked from the master library — not copied into `_calibration`).
6. **Stage for Siril** builds:

```text
<projectDir>/
  _calibration/darkflats/<YYYYMMDD>/   # Bias copied from ASIAIR (source kept)
  _calibration/darks/<YYYYMMDD>/       # Darks copied from session/master (source kept)
  <Filter>/<ShootName>/   # e.g. SII/260725_SII_B9_NYCRoof (from shoot log Name)
    lights/    # copied from source
    flats/     # copied from source
    biases/    # symlink → _calibration/darkflats/<night>/
    darks/     # symlink → _calibration/darks/<night>/
```

Local development fixture (gitignored): `staging/asiair-sample/` (NGC 6960 lights only).

Source ASIAIR folders are never moved. Calibration frames are copied into `_calibration/` by night, then symlinked into each channel (falls back to hardlink/copy if symlink fails). The filter subfolder uses the shoot log auto-name, not the bare date.

**Before v1 go-live / ongoing notes:** **[docs/working-notes.md](docs/working-notes.md)** (bugs, fixes, and the v1 checklist).

## External weather & astronomy data

Sky Forecast, Moon, and Sun cards pull from Astrospheric, Open-Meteo, NASA moon frames (CDN), and a few location/map helpers. Full inventory (endpoints, fields, cache, credits):

→ **[docs/external-data.md](docs/external-data.md)**

## Testing

See [docs/testing.md](docs/testing.md) for the pyramid (unit → thin Playwright Electron E2E). Quick commands:

```
npm run test:unit
npm run test:e2e
npm test
```

E2E uses `ZUKO_DATA_DIR` / `ZUKO_PROJECTS_DIR` so it never writes to the H: live dashboard.

## Build installer (optional)

```
npm run dist:win
```

Output lands in `dist/`.

## Reference material

- **Siril 1.4 scripts** (tracked): `reference/siril/` — stock `.ssf` scripts copied from the installed Siril 1.4.x app. See that folder’s README for version pin and refresh steps.
- [SiriLic](https://gitlab.com/free-astro/sirilic) — full local clone (gitignored): `reference/sirilic`
- Upstream Siril: [siril.org](https://siril.org) · [gitlab.com/free-astro/siril](https://gitlab.com/free-astro/siril)
