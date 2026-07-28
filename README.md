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

From a project's **Shoot Log**, use **Attach folder…** next to a shoot's Done checkbox. That opens the ASIAIR Ingest Tool (`src/ingest/asiairIngest.js`):

1. Pick an ASIAIR dump folder (Autorun/Plan or a deeper Light/Flat folder).
2. Parse filenames (+ optional FITS headers) for type, filter, exposure, gain, temp, date.
3. Copy/hardlink into a Siril-ready tree:

   `H:\Photography\Astrophotography\Projects\<Object>\<Filter>\<YYYYMMDD>\{lights,darks,flats,darkflats,biases}\`

   Fallback when H: is unavailable: `data/projects/…`

The shoot stores `sourcePath`, `ingestPath`, and parsed `ingestMeta` (frame counts, exposure, etc.).

## Build installer (optional)

```
npm run dist:win
```

Output lands in `dist/`.

## Reference material

Upstream clones for later inspiration live under `reference/` (gitignored — not committed to this repo):

- [SiriLic](https://gitlab.com/free-astro/sirilic) — Siril Interactive Companion (GPL-3.0). Local path: `reference/sirilic`
- [Siril](https://github.com/gnthibault/siril) — image processing app Zuko will build/execute plans against. Local path: `reference/siril`
