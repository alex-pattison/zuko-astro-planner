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

| Channel | How you run it | App / dashboard JSON | Imaging files |
|---|---|---|---|
| **Dev** | `npm start` from this checkout | `<checkout>/data/` | `F:\zuko_dev\Projects` + `F:\zuko_dev\Dark Library` |
| **Beta** | NSIS installer (`npm run dist:win:beta`) | `H:\Photography\Astrophotography\Dashboard` | `H:\Photography\Astrophotography\Zuko\…` |

**One checkout only** — develop and launch from `C:\Users\alexp\Projects\zuko-astro-planner`. The old `F:\GitHub\zuko-astro-planner` clone is retired (do not run it). `F:\zuko_dev` is Dev FITS / synthetic data only.

- Window title shows **Dev** or **Beta** so you know which pool is open.
- Override either pool with `ZUKO_DATA_DIR` (used by Playwright / QA).
- Force channel with `ZUKO_CHANNEL=dev` or `ZUKO_CHANNEL=beta`.
- Promote builds: merge `main` → `beta-release`, then `npm run dist:win:beta`.

**One-time Beta seed** (copies the freshest H: or repo JSON into the Beta folder, then writes `.beta-seeded`; re-runs are no-ops):

```
npm run seed:beta
```

## Data storage

- **Dev** loads/saves only `<checkout>/data/zuko-dashboard-data.json` (plus forecast/moon caches in that folder). Project directories and the Dark Library live under `F:\zuko_dev\…`.
- **Beta** loads/saves only `H:\Photography\Astrophotography\Dashboard\zuko-dashboard-data.json` — no mirror into git `data/`. Dark Library lives under `H:\Photography\Astrophotography\Zuko\…`.

localStorage is kept as a cache. Use **File → Open Data Folder** to jump to the active directory.

## Dark Library

Reusable master darks (match **lights** by exp / gain / temp / bin):

| | Dev | Beta |
|---|---|---|
| **Dark Library** | `F:\zuko_dev\Dark Library` | `H:\…\Zuko\Dark Library` |

- **Import from ASIAIR…** copies Dark subs into set folders (`Darks_<exp>_BinN_<temp>c[/filter]`).
- **Build master** runs Siril stack → `master.fit` (optionally remove subs afterward).
- Shoot **Import** checkbox: **Use matching master darks**. Biases/darkflats are **not** library-managed — they come from the ASIAIR session with every flat set (`_calibration/darkflats/<night>/`).

## ASIAIR Import (Shoot Log)

Your ASIAIR unit (or a USB dump) looks like this — matching what we see on disk:

```text
Autorun/   (or Plan/)
  Light/ or lights/     Light_<Target>_<exp>s_Bin2_<H|O|S>_YYYYMMDD-HHMMSS_<temp>C_####.fit
  Flat/  or flats/
  Bias/  or biases/     (ASIAIR “Bias” = dark flats)
  Dark/  or darks/
```

**Project directory** = Siril destination (`Filter/ShootCode/`, `_calibration/`, `working/`).  
**ASIAIR source** = where frames are read from (Settings → ASIAIR source, or Browse in the Import window). Typically the unit share / USB folder that contains `Autorun`/`Plan`, or `Autorun` itself.

### Flow

1. Set **ASIAIR source** once (Settings), or Browse when Import opens.
2. Open **Import** on a Captured shoot (or **Import all**).
3. Modal shows source path (editable via Browse/Rescan) + project destination.
4. Discovers `Autorun`/`Plan` under the source; merges them; night-gates lights/flats; target-matches to the project RA/Dec.
5. Status column: **match** / **already imported** / **no shot log** / missing flats/bias/darks…
6. **Import** copies matched frames into the project tree (same layout as before). Source on the ASIAIR/USB is not moved.

```text
<projectDir>/
  _calibration/darkflats/<YYYYMMDD>/   (session biases / darkflats — with flats)
  _calibration/darks/<YYYYMMDD>/       (session darks when not using Dark Library)
  <Filter>/<ShootName>/{lights,flats,biases,darks,masters}/
```

When **Use matching master darks** is on, Dark Library frames (preferring `master.fit`) are linked instead of copying session darks into `_calibration/darks`. Session Bias/darkflats are always required with flats.

Live Wi‑Fi auto-watch of a connected ASIAIR is still deferred — use Browse to the mounted share for now.

**Before v1 go-live / ongoing notes:** **[docs/working-notes.md](docs/working-notes.md)**.

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
