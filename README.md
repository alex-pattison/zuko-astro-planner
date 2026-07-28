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

Auto-load / auto-save uses:

1. **Preferred (this desktop):** `H:\Photography\Astrophotography\Dashboard\zuko-dashboard-data.json` when that folder exists
2. **Fallback (laptop / other machines):** `data/zuko-dashboard-data.json` in this repo

When saving on the H: machine, the app also mirrors into `data/` so you can commit and pull your latest data on another computer.

**Laptop workflow:** edit as usual → commit `data/zuko-dashboard-data.json` when you want it synced → push → pull on the other machine.

localStorage is kept as a cache. Use **File → Open Data Folder** to jump to the active directory.

## Build installer (optional)

```
npm run dist:win
```

Output lands in `dist/`.

## Reference material

Upstream clones for later inspiration live under `reference/` (gitignored — not committed to this repo):

- [SiriLic](https://gitlab.com/free-astro/sirilic) — Siril Interactive Companion (GPL-3.0). Local path: `reference/sirilic`
- [Siril](https://github.com/gnthibault/siril) — image processing app Zuko will build/execute plans against. Local path: `reference/siril`
