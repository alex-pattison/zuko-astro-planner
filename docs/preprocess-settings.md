# Siril preprocessing settings

Zuko generates Siril `.ssf` scripts for Calibrate → Register → Stack. Settings live on the dashboard JSON as `preprocessSettings` and are chosen in **Settings → Siril preprocessing**. The Stack confirm dialog also has a sampling checkbox.

Canonical code: [`src/siril/preprocessSettings.js`](../src/siril/preprocessSettings.js)  
Builders: [`src/siril/preprocess.js`](../src/siril/preprocess.js)  
Sample permutations: [`scripts/fixtures/preprocess-settings.json`](../scripts/fixtures/preprocess-settings.json)  
QA: `node scripts/qa-preprocess-settings.js`

## Stage presets

Each of **Master bias/dark**, **Master flat**, **Calibrate lights**, **Register**, and **Stack** has:

| Preset | Meaning |
|--------|---------|
| **Default** | Today’s Mono 1.4 hard-coded scripts (no 2-pass; `rej 3 3` Winsorized-by-omission). |
| **Mono Recommended** | Your mono recipe: 2-pass register + `seqapplyreg`; stack uses median when N&lt;20 and Winsorized rejection when N≥20. |
| **Custom** | Unlocks per-flag dropdowns for that stage only. |

Suggested presets on each job dialog: **SHO / Hβ → Mono Recommended**, **LRGB → Default** (Custom is left alone if you set it).

## Sampling / plate solving (Stack dialog)

**Update pixel size of binned images** (Siril `core.binning_update` / “real pixel size”):

| State | Behavior |
|-------|----------|
| **Unchecked (default)** | `set core.binning_update=false` — treat FITS `XPIXSZ` as already effective (binned). Correct for ASIAIR Bin2. |
| **Checked** | `set core.binning_update=true` — multiply header µm by `XBINNING`. |

This line is written into **Register** and **Stack** scripts (and Calibrate) so registered `r_pp_light_*` and `working/result_*.fit` keep correct sampling for plate solving. The Stack confirm checkbox is the interactive control; its value is also stored as `preprocessSettings.binningUpdate`.

## Mono Recommended detail

| Stage | Effect |
|-------|--------|
| Bias / flat / calibrate | Same as Default (avg+rejection, mul flats, cosmetic from dark). |
| Register | `register pp_light -2pass` then `seqapplyreg pp_light`. |
| Stack | If frame count &lt; 20 → `med`; else `rej 3 3` (Winsorized) with `-norm=addscale -output_norm -32b`. |

## Custom flags (per stage)

### Bias / dark / stack-like

- **Method:** `rej` (average+rejection), `med`, `sum`
- **Rejection:** winsorized (Siril default), median, sigma, none, …
- **Norm:** none / mul / addscale / add
- **Weight:** none / noise / wfwhm / nbstars

### Flat

- Same stack flags, plus **Use bias** (`calibrate flat -bias=…` on/off)

### Calibrate lights

- **Cosmetic** on (`-cc=dark`) / off

### Register

- **Two-pass** on/off

## Persistence

```json
{
  "preprocessSettings": {
    "bias": { "preset": "default", "custom": { } },
    "flat": { "preset": "default", "custom": { } },
    "calibrate": { "preset": "default", "custom": { } },
    "register": { "preset": "monoRecommended", "custom": { "twoPass": true } },
    "stack": { "preset": "monoRecommended", "custom": { } },
    "binningUpdate": false
  }
}
```

`registerMeta` / `stackMeta` stamp `binningUpdate` and `settingsPreset` after a successful run.
