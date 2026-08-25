# External data sources

What Zuko pulls from the network (or CDN), where it goes in the UI, and how long it’s cached. Local astronomy math (SunCalc-style twilight, moon phase age) runs offline in the renderer and does **not** need a network call.

API keys: `ASTROSPHERIC_API_KEY` in `.env` (see `.env.example`). Never commit `.env`.

---

## Sky Forecast (Tonight / multi-night)

| Source | Endpoint | Auth / cost | Fields used | UI | Cache |
|--------|----------|-------------|-------------|----|-------|
| **Astrospheric** (primary) | `POST https://v2-api-public.astrospheric.com/api/GetForecastData` | Pro API key · **per-variable** on the new v2 host. Default pull is `Cloud` + `Transparency` + `Seeing`. Live: 3-var ≈ **15**/pull; adding `Temperature` billed **80**; `DewPoint`+`Wind`+`Smoke` with those billed **225**. Accepted names also include `WindDirection`, `GDPSExtended`, `GFSCloud`, `ICONCloud`, `NBMCloud`. Remaining pool is `APICreditsRemaining` (observed ~95k). | Hourly cloud %, transparency, seeing, derived RAG. Temp/precip still merged from Open-Meteo unless those fields are in the payload. | Header chip · Sky Forecast metrics · hourly night tables · RAG status (GO / OK / NO) | ~**4 hours** on disk (`astrospheric-v2-cache-*.json`) |
| **Local math** (no network) | Renderer `_ASTRO.moonAltitude` | — | Per-hour moon altitude | **Moon** column on hourly night tables (`↑ nn°` / `↓`) | — |
| **Open-Meteo** (fallback) | `GET https://api.open-meteo.com/v1/forecast` | Free | `cloud_cover`, `temperature_2m`, `precipitation_probability` (hourly) | Same panels when Astrospheric is missing/offline — **no** transparency, seeing, or shoot RAG | Short-lived / as returned; used when primary fails |
| **Clear Outside** (visual) | `https://clearoutside.com/forecast_image_large/{lat}/{lon}/forecast.png` | Free image | Forecast strip image | Optional graphic under Sky Forecast | Browser image cache only |
| **Astrospheric site** | Link only | — | — | “Open Astrospheric ↗” | — |

Code: `src/weather/tonightShoot.js` · IPC `zuko-sky-forecast`.

Temperature on Astrospheric rows is merged from Open-Meteo when available (Astrospheric pull requests cloud/transparency/seeing only).

---

## Moon & Sun cards

| Source | Endpoint | Auth / cost | Fields used | UI | Cache |
|--------|----------|-------------|-------------|----|-------|
| **Astrospheric Moon** | `POST https://v2-api-public.astrospheric.com/api/Moon` | Pro API key · **10 credits**/call (same monthly pool as forecast) | Illumination %, phase angle, next major phases (alt/az still returned but not shown) | Moon metrics when fetch &lt; ~24h old; next-new-moon prefers API phases | ~**24 hours** (`astrospheric-moon-*.json`). Updates `astrospheric-credits.json` remaining balance; does **not** change the forecast “cost per pull” used for requests-remaining math. |
| **Open-Meteo astronomy** | `GET https://api.open-meteo.com/v1/forecast` · `daily=sunrise,sunset,moonrise,moonset,moon_phase` · `forecast_days=16` · `timezone=auto` | Free | Daily rise/set calendar | Moon rise/set · optional sun rise/set overlay | ~**12 hours** (`open-meteo-astro-*.json`) |
| **NASA SVS stills (local)** | Bundled `vendor/moon-cycle/mm-256-75/{001–708}.webp` | NASA public domain via moon-cycle | 708 synodic-month frames | Moon photo disc | On disk (no network). jsdelivr CDN 403s these in Electron — do not use it. |
| **Local math** (no network) | Renderer `_ASTRO` + `moonPhaseInfo` | — | Twilight elevations, solar noon→noon bar, moon phase name/%, next new moon (offline) | Sun twilight bar + boxes · moon phase fallback | — |

Code: `src/weather/skyAstronomy.js` · IPC `zuko-sky-astronomy` · moon/sun UI in `index.html`.

Credit snapshot (remaining monthly pool) is written to `astrospheric-credits.json` after Astrospheric calls. The Sky Forecast ticker shows **pulls left** using live `APICreditCostOfCall` (not a hardcoded 65) and the remaining credit pool from the API.

---

## Location

| Source | Endpoint | Used for |
|--------|----------|----------|
| **Open-Meteo Geocoding** | `https://geocoding-api.open-meteo.com/v1/search` | Place-name → lat/lon |
| **Nominatim (OSM)** | `https://nominatim.openstreetmap.org/reverse` | Reverse geocode (coords → place label) |
| **Electron / browser geolocation** | OS location services | “Use my location” |

---

## Target Framer & ingest confirm (sky charts)

| Source | Notes |
|--------|--------|
| **Aladin Lite** | Bundled `vendor/aladin-lite.js` (v3.8.2). Target Framer loads DSS2 color from the CDS **bis** HiPS mirror (`https://alaskybis.cds.unistra.fr/DSS/DSSColor`) — the primary `alasky.cds.unistra.fr` host currently hangs from US networks and left a black WebGL canvas. Properties + Allsky JPEG are prefetched after boot. |
| **Sesame / SIMBAD / MAST** | Name → RA/Dec resolve when looking up targets (`cdsweb.u-strasbg.fr`, `simbad.cds.unistra.fr`, `mast.stsci.edu`) |

---

## Other remote assets

| Source | Used for |
|--------|----------|
| **Google Fonts** | UI type (Space Mono / Inter) |
| **AstroBin** thumbs | Optional project image URLs the user pastes |

---

## Offline behavior

- Forecast: serve last Astrospheric cache if fresh enough; else Open-Meteo if online; else offline placeholders.
- Moon/Sun: local twilight + phase always work; rise/set prefer Open-Meteo cache; Astrospheric moon fields only if cache &lt; ~24h.
- Maps / fonts need network when those surfaces are shown. Moon disc stills are local.

---

## Related code

- `src/weather/tonightShoot.js` — forecast + RAG scoring  
- `src/weather/skyAstronomy.js` — moon API + Open-Meteo calendar  
- `main.js` / `preload.js` — IPC bridges  
- `scripts/qa-sky-astro-modules.js` — seasonal/phase accuracy checks vs Open-Meteo  
