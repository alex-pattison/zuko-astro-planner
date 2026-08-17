# NASA SVS moon stills

708 synodic-month frames (001 = new … ~354 = full … 708), NASA public-domain SVS imagery via [acamarata/moon-cycle](https://github.com/acamarata/moon-cycle) `mm-256-75`.

Zuko loads these from disk (`vendor/moon-cycle/mm-256-75/NNN.webp`). Do not use the jsdelivr CDN — it 403s and the Moon card falls back to a black disc.

Rebuild: `node scripts/vendor-moon-cycle.js`
