# Siril reference (1.4)

Lean snapshot of stock scripts from the installed app — **not** a full Siril source tree.

| | |
|---|---|
| **Installed app** | Siril **1.4.4** (`C:\Program Files\Siril\`) |
| **Scripts source** | `C:\Program Files\Siril\scripts\` (copied here) |
| **Upstream** | [siril.org](https://siril.org) · [gitlab.com/free-astro/siril](https://gitlab.com/free-astro/siril) |

## Scripts

| File | Use |
|------|-----|
| `Mono_Preprocessing.ssf` | Mono camera preprocess (baseline for Zuko) |
| `OSC_Preprocessing.ssf` | OSC preprocess |
| `OSC_Preprocessing_BayerDrizzle.ssf` | OSC + Bayer drizzle |
| `OSC_Extract_Ha.ssf` | Extract Ha from OSC |
| `OSC_Extract_HaOIII.ssf` | Extract Ha/OIII from OSC |
| `RGB_Composition.ssf` | RGB compose |

`Mono_Preprocessing` v1.4 expects `biases/` `flats/` `darks/` `lights/` in the working directory, writes masters to `masters/`, intermediates to `process/`, and saves `result_$FILTER_$LIVETIME` at the shoot root.

## Refresh

After upgrading Siril, re-copy:

```powershell
Copy-Item "C:\Program Files\Siril\scripts\*.ssf" "reference\siril\scripts\" -Force
```

Update the version line in this README to match **DisplayVersion** from Apps & Features / registry.
