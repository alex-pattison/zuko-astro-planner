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

## Data storage

Auto-load / auto-save uses two locations when available:

1. `H:\Photography\Astrophotography\Dashboard\zuko-dashboard-data.json` (this desktop)
2. `data/zuko-dashboard-data.json` in this repo (laptop / git sync)

**On launch:** the app compares both files by modification time, loads the newer one, backs up the older copy into a `backups/` folder next to it, then overwrites the older file so both match.

When saving on the H: machine, the app also mirrors into `data/` so you can commit and pull on another computer.

**Laptop workflow:** edit as usual → commit `data/zuko-dashboard-data.json` when you want it synced → push → pull on the other machine → reopen the app (it will pick the newer pulled copy).

localStorage is kept as a cache. Use **File → Open Data Folder** to jump to the active directory.

## ASIAIR ingest (Shoot Log)

Each project needs a **Project directory** (edit project) that contains an ASIAIR `Autorun` or `Plan` folder with `Light` / `Flat` / `Bias` / `Dark` children. Lights may live under `Light/<Target>/`.

From a shoot’s **Ingest** button:

1. Discovers `Autorun` / `Plan` under the project directory.
2. Scans FITS **headers first** (filename fallback) for the shoot’s astronomical night (`D` and morning of `D+1`).
3. Shows status chips for Light / Flat / Bias (dark flats) / session Dark, plus per-filter light/flat counts.
4. Stages session **darks** into each channel (exp+gain+temp match; filter ignored). On Ingest open, matches the shoot’s exp/gain/temp against the **master dark library** (`H:\Photography\Astrophotography\Zuko\Dark Library`) and notes hits; optionally stages those library darks when the checkbox is on.
5. **Stage for Siril** builds:

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

## Build installer (optional)

```
npm run dist:win
```

Output lands in `dist/`.

## Reference material

Upstream clones for later inspiration live under `reference/` (gitignored — not committed to this repo):

- [SiriLic](https://gitlab.com/free-astro/sirilic) — Siril Interactive Companion (GPL-3.0). Local path: `reference/sirilic`
- [Siril](https://github.com/gnthibault/siril) — image processing app Zuko will build/execute plans against. Local path: `reference/siril`
