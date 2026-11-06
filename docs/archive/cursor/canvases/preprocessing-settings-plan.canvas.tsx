import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Stack,
  Stat,
  Table,
  Text,
} from "cursor/canvas";

const presetModel = [
  ["Default", "Today’s hard-coded Mono 1.4 scripts (no behavior change)"],
  ["Mono Recommended", "Your recipe: +2-pass register, Winsorized when N≥20, binning_update off for ASIAIR"],
  ["Other", "Unlocks per-flag dropdowns for that stage; each flag has (i) help"],
];

const stages = [
  ["Master bias / dark", "stack method, rejection, σ low/high, weight, norm"],
  ["Master flat", "use bias, stack method, rejection, σ, normalization"],
  ["Calibrate lights", "cosmetic on/off + estimate, CFA/debayer/equalize (OSC later)"],
  ["Register", "two-pass, transform type (advanced)"],
  ["Stack", "method, rejection, σ, normalization, weight, N-threshold rule"],
  ["Sampling (result)", "core.binning_update + optional XPIXSZ/FOCALLEN write"],
];

const flagHelp = [
  [
    "stack … rej",
    "Average stacking with pixel rejection",
    "Default for deep-sky lights and masters when you have enough frames",
  ],
  [
    "Rejection: winsorized",
    "Clips outliers then re-estimates σ (robust vs cosmic rays / satellites)",
    "Best general choice for N≳15–20 lights; Siril default if type omitted",
  ],
  [
    "Rejection: median / sigma / none",
    "Median = very robust but softer; sigma = classic; none = no clip",
    "Median for small N (<10–15); none only for perfect data / sum stacks",
  ],
  [
    "-norm=mul",
    "Multiplicative normalization (flats)",
    "Standard for master flats after bias subtraction",
  ],
  [
    "-norm=addscale",
    "Additive + scale (lights)",
    "Siril’s usual light-stack default; matches Mono 1.4",
  ],
  [
    "-weight=",
    "Per-frame weights (noise / wfwhm / nbstars / nbstack)",
    "Leave none unless you curated quality; can bias the stack",
  ],
  [
    "-cc=dark",
    "Cosmetic correction from master dark (hot/cold)",
    "On for mono lights when you have a good master dark",
  ],
  [
    "register -2pass + seqapplyreg",
    "Pick best reference by quality, then apply transforms",
    "Recommended for multi-night Aggregate; slower but stabler",
  ],
  [
    "core.binning_update",
    "If true, multiply FITS pixel size by XBINNING",
    "Off when ASIAIR already wrote effective (binned) µm — your case",
  ],
];

export default function PreprocessingSettingsPlan() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 980 }}>
      <Stack gap={8}>
        <H1>Preprocessing Settings — plan</H1>
        <Text tone="secondary">
          Branch `preprocessing-settings` · Settings → Siril preprocessing (Default / Mono Recommended / Custom) · Stack sampling checkbox · docs/preprocess-settings.md
        </Text>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat value="Yes" label="Preset path is right" tone="success" />
        <Stat value="Yes" label="binning_update is scriptable" tone="success" />
        <Stat value="(i)" label="Per-flag help popovers" tone="info" />
      </Grid>

      <Callout tone="success" title="Implemented on preprocessing-settings">
        Per pipeline step: dropdown Default | Mono Recommended | Custom. Custom
        expands the Siril flags for that step only. Stack confirm has the
        binning / real-pixel-size checkbox (default unchecked). Persist on
        dashboard settings; stamp binningUpdate + settingsPreset on registerMeta /
        stackMeta.
      </Callout>

      <H2>UX model</H2>
      <Table headers={["Preset", "Meaning"]} rows={presetModel} />
      <Table headers={["Stage card", "Other unlocks"]} rows={stages} />

      <H3>Info buttons</H3>
      <Text>
        Each control gets a small (i). Click → popover with: what the flag does
        (1–2 sentences) + when to use each option. Same pattern for the preset
        itself (“what Mono Recommended changes vs Default”).
      </Text>

      <Divider />

      <H2>Research cheat-sheet (for (i) copy)</H2>
      <Table
        headers={["Flag / setting", "What it does", "Recommended use"]}
        rows={flagHelp}
      />

      <H2>Real pixel size — can Zuko change it?</H2>
      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="success" size="sm">Yes</Pill>}>
            Preference (session)
          </CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text>
                Siril setting <Text weight="semibold">core.binning_update</Text>{" "}
                = “Update pixel size of binned images” / Real pixel size.
              </Text>
              <Text>
                Scriptable:{" "}
                <Text weight="semibold">set core.binning_update=false</Text> at
                the start of calibrate/register/stack (and restore if we want to
                be polite).
              </Text>
              <Text tone="secondary">
                false = header µm already includes binning (typical ASIAIR Bin2).
                true = multiply by XBINNING.
              </Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="info" size="sm">Also</Pill>}>
            Final stacked FITS
          </CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text>
                After stack, we can write sampling into the result with{" "}
                <Text weight="semibold">update_key</Text> (XPIXSZ / YPIXSZ /
                FOCALLEN / XBINNING) from project imaging config — so the file
                itself carries correct scale even if someone opens it elsewhere.
              </Text>
              <Text tone="secondary">
                Preference affects Siril’s interpretation during the run; header
                write makes the product durable.
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Callout tone="info" title="Suggested build order">
        1) Settings schema + Default vs Mono Recommended (2-pass, binning_update,
        N≥20 Winsorized). 2) (i) help catalog. 3) Other dropdowns per stage. 4)
        Optional update_key on result_*.fit from imaging config.
      </Callout>
    </Stack>
  );
}
