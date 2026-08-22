# Preprocess settings sample

Tiny catalog for testing Siril script generation (Default / Mono Recommended / Custom + binning checkbox).

## Layout

```
staging/preprocess-settings-sample/
  fixtures.json          # permutation cases (expectIncludes / expectExcludes)
  README.md              # this file
  project/               # fake Aggregate paths (markers only — not real FITS)
    Ha/Aggregate/.keep
    Ha/_stack/scripts/.keep
    working/.keep
```

## Run

```bash
node scripts/qa-preprocess-settings.js
```

No Siril install required. Cases cover:

- Default Mono 1.4 script shape
- `set core.binning_update=false|true` (Stack checkbox / register sampling)
- Mono Recommended 2-pass + N&lt;20 median / N≥20 rejection
- Custom rejection, weight, no-bias flat, no cosmetic, median stack
- Re-register + mono mix

Canonical settings module: `src/siril/preprocessSettings.js`  
User-facing catalog: `docs/preprocess-settings.md`
