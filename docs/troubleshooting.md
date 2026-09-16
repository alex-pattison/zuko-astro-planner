# Troubleshooting

Field notes from real sessions. Newest first.

Related: [preprocess settings](preprocess-settings.md) · [working notes](working-notes.md)

---

## Siril plate-solve shows 9.26 µm and fails (use 4.63)

**Seen:** Image → Plate Solver… on a Bin2 ASI294MM stack. Siril fills **pixel size 9.26**. Solve fails. Typing **4.63** succeeds.

**Example:** `E:\Astrophotography\Zuko\IC1396_260911\working\H_v1.0.2_RCAstro.fit`

| Header | Value |
|--------|--------|
| `NAXIS1 × NAXIS2` | 4144 × 2822 (Bin2 frame) |
| `XPIXSZ` / `YPIXSZ` | **4.63 µm** |
| `XBINNING` / `YBINNING` | **2** |
| `FOCALLEN` | 278 mm |
| `INSTRUME` | ZWO ASI294MM Pro |

**Cause:** On ASI294MM, “Bin2” is the normal 4144×2822 mode. The **effective** pixel is already **4.63 µm** (2.315 µm photosites hardware-binned). ASIAIR still writes `XBINNING=2` plus `XPIXSZ=4.63`.

Siril preference **Update pixel size of binned images** (`core.binning_update`, default on in the GUI) then does `4.63 × 2 = 9.26`. That is a second multiply. Scale becomes ~6.8″/px instead of the rig’s **3.41″/px** (Reducer + Bin2 · 280 mm). Plate-solve looks for the wrong FOV (~7.8° instead of **3.91° × 2.66°**).

This is **not** the other bug (header already 9.26, Siril doubling to 18.52). Here the header is 4.63; Siril invents 9.26.

**Fix (interactive Siril):**

1. Preferences → FITS / astrometry: **uncheck** “Update pixel size of binned images”.
2. In Plate Solver, set **pixel size 4.63 µm** and **focal length ~278–280 mm**.
3. Do not leave 9.26 even if Siril suggests it.

**Fix (ZAP scripts):** Stack / Register checkbox **Update pixel size of binned images** stays **unchecked** (`set core.binning_update=false`). That does not change the GUI preference if you opened Siril yourself — uncheck it in Siril too.

**Sanity check:** Reducer + Bin2 FOV in ZAP is `3.91°×2.66°` at `3.41″/px` using 4.63 µm on 4144 pixels. If pixel size is 9.26, both numbers double and the solve fights you.
