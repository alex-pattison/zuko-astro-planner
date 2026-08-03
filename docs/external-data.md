# External data sources

What Zuko pulls from the network (or CDN), where it goes in the UI, and how long it’s cached. Local astronomy math (SunCalc-style twilight, moon phase age) runs offline in the renderer and does **not** need a network call.

API keys: `ASTROSPHERIC_API_KEY` in `.env` (see `.env.example`). Never commit `.env`.

---

## Sky Forecast (Tonight / multi-night)

| Source | Endpoint | Auth / cost | Fields used | UI | Cache |
|--------|----------|-------------|-------------|----|-------|
| **Astrospheric** (primary) | `POST https://v2-api-public.astrospheric.com/api/GetForecastData` | Pro API key · ~65 credits/pull (`Cloud` + `Transparency` + `Seeing`) | Hourly cloud %, transparency (0–27+), seeing (0–5), plus derived shoot RAG | Header chip · Sky Forecast metrics · hourly night tables · RAG status (GO / OK / NO) | ~**4 hours** on disk (`astrospheric-v2-cache-*.json`) |
| **Open-Meteo** (fallback) | `GET https://api.open-meteo.com/v1/forecast` | Free | `cloud_cover`, `temperature_2m`, `precipitation_probability` (hourly) | Same panels when Astrospheric is missing/offline — **no** transparency, seeing, or shoot RAG | Short-lived / as returned; used when primary fails |
| **Clear Outside** (visual) | `https://clearoutside.com/forecast_image_large/{lat}/{lon}/forecast.png` | Free image | Forecast strip image | Optional graphic under Sky Forecast | Browser image cache only |
| **Astrospheric site** | Link only | — | — | “Open Astrospheric ↗” | — |

Code: `src/weather/tonightShoot.js` · IPC `zuko-sky-forecast`.

Temperature on Astrospheric rows is merged from Open-Meteo when available (Astrospheric pull requests cloud/transparency/seeing only).

---

## Moon & Sun cards

| Source | Endpoint | Auth / cost | Fields used | UI | Cache |
|--------|----------|-------------|-------------|----|-------|
| **Astrospheric Moon** | `POST https://v2-api-public.astrospheric.com/api/Moon` | Pro API key · **10 credits**/call | Illumination %, phase angle, altitude, azimuth, above-horizon, next major phases | Moon metrics (when fetch &lt; ~6h old); next-new-moon prefers API phases | ~**6 hours** (`astrospheric-moon-*.json`) |
| **Open-Meteo astronomy** | `GET https://api.open-meteo.com/v1/forecast` · `daily=sunrise,sunset,moonrise,moonset,moon_phase` · `forecast_days=16` · `timezone=auto` | Free | Daily rise/set calendar | Moon rise/set · optional sun rise/set overlay | ~**12 hours** (`open-meteo-astro-*.json`) |
| **NASA SVS via moon-cycle CDN** | `https://cdn.jsdelivr.net/gh/acamarata/moon-cycle@main/mm-256-75/{001–708}.webp` | Free CDN | 708 synodic-month stills (NASA public-domain frames) | Moon photo disc | Browser/CDN cache |
| **Local math** (no network) | Renderer `_ASTRO` + `moonPhaseInfo` | — | Twilight elevations, solar noon→noon bar, moon phase name/%, next new moon (offline) | Sun twilight bar + boxes · moon phase fallback | — |

Code: `src/weather/skyAstronomy.js` · IPC `zuko-sky-astronomy` · moon/sun UI in `index.html`.

Credit snapshot (remaining monthly pool) is written to `astrospheric-credits.json` after Astrospheric calls.

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
| **Aladin Lite** | Bundled under `vendor/aladin-lite.js` (loads survey tiles from CDS / partner hosts when the map is shown) |
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
- Moon/Sun: local twilight + phase always work; rise/set prefer Open-Meteo cache; Astrospheric moon fields only if cache &lt; ~6h (avoids stale illumination vs today’s photo).
- Maps / Clear Outside / fonts need network when those surfaces are shown.

---

## Related code

- `src/weather/tonightShoot.js` — forecast + RAG scoring  
- `src/weather/skyAstronomy.js` — moon API + Open-Meteo calendar  
- `main.js` / `preload.js` — IPC bridges  
- `scripts/qa-sky-astro-modules.js` — seasonal/phase accuracy checks vs Open-Meteo  
