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

const biasRows = [
  ["Stacking", "Average + rejection", "stack … rej 3 3", "Match"],
  ["Rejection", "Winsorized sigma", "rej type omitted → Winsorized default", "Match"],
  ["Sigma low/high", "(typical 3/3)", "3 3 hard-coded", "Match"],
  ["Weighting", "None", "no -weight=", "Match"],
  ["Normalization", "None (masters)", "-nonorm", "Match"],
];

const flatRows = [
  ["Use bias", "Checked", "calibrate flat -bias=…", "Match"],
  ["Stacking", "Average + rejection", "stack pp_flat rej 3 3", "Match"],
  ["Rejection", "Winsorized", "default Winsorized", "Match"],
  ["Normalization", "Multiplicative", "-norm=mul", "Match"],
];

const colorRows = [
  ["Cosmetic correction", "On (estimate)", "calibrate light … -cc=dark", "Match"],
  ["CFA data", "Unchecked (mono)", "no -cfa", "Match (mono)"],
  ["Debayer before save", "Unchecked (mono)", "no -debayer", "Match (mono)"],
  ["Equalize CFA", "Unchecked (mono)", "no -equalize_cfa", "Match (mono)"],
];

const regRows = [
  ["Two-pass registration", "Enable", "register pp_light (no -2pass)", "Gap"],
  ["Real pixel size", "Disabled", "Siril Preference — not in scripts", "Outside scripts"],
];

const stackRows = [
  ["Stacking", "Average + rejection", "stack … rej 3 3", "Match"],
  ["Normalization", "Additive with scaling", "-norm=addscale", "Match"],
  ["Rejection", "Winsorized if >20 images", "Always Winsorized 3 3", "Partial"],
  ["Output", "—", "-output_norm -32b + mirrorx -bottomup", "Zuko extras"],
];

const scriptInventory = [
  ["Calibrate (PP1)", "buildCalibrateScript", "bias/dark/flat masters + calibrate lights → pp_light"],
  ["Library master", "buildLibraryMasterScript", "Dark/Bias Library stack → master.fit"],
  ["Register", "buildRegisterScript", "Aggregate pp_light → r_pp_light"],
  ["Stack", "buildStackScript", "included lights → working/result_<Filter>.fit"],
  ["Reference", "Mono_Preprocessing.ssf", "Same defaults (bundled Siril 1.4 mono template)"],
];

export default function PreprocessingSettingsAudit() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 980 }}>
      <Stack gap={8}>
        <H1>Preprocessing settings — recommended vs Zuko</H1>
        <Text tone="secondary">
          Branch preprocessing-settings · source: src/siril/preprocess.js script
          builders + Siril CLI (rej default = Winsorized)
        </Text>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat value="Mostly match" label="Bias / flat / mono calibrate" tone="success" />
        <Stat value="1 gap" label="Register lacks -2pass" tone="warning" />
        <Stat value="Hard-coded" label="No UI dropdowns yet" tone="info" />
      </Grid>

      <Callout tone="info" title="A) Are your settings used?">
        Yes for almost everything that lives in the generated .ssf scripts. Zuko
        copies Siril’s Mono_Preprocessing 1.4 defaults into calibrate / register /
        stack. The main miss is two-pass registration. Frame-count logic for
        rejection (&gt;20 → Winsorized) is not implemented — we always Winsorize.
        “Real pixel size” is a Siril app preference, not a script flag.
      </Callout>

      <Callout tone="neutral" title="B) Options list / defaults today">
        There is no settings catalog or dropdown. Defaults are baked into four
        string templates in preprocess.js. The only runtime toggle today is Stack’s
        “Re-register before stacking” checkbox. Rejection type is never named
        explicitly — Siril treats bare “rej 3 3” as Winsorized σ=3/3.
      </Callout>

      <H2>Master bias (dark flat) / library bias</H2>
      <Table
        headers={["Setting", "You want", "Zuko now", "Status"]}
        rows={biasRows}
      />
      <Text tone="secondary" size="small">
        Same pattern for master dark: stack dark rej 3 3 -nonorm
      </Text>

      <H2>Master flat</H2>
      <Table
        headers={["Setting", "You want", "Zuko now", "Status"]}
        rows={flatRows}
      />

      <H2>Color / light calibrate (mono)</H2>
      <Table
        headers={["Setting", "You want", "Zuko now", "Status"]}
        rows={colorRows}
      />

      <H2>Image registration</H2>
      <Table
        headers={["Setting", "You want", "Zuko now", "Status"]}
        rows={regRows}
      />

      <H2>Image stacking</H2>
      <Table
        headers={["Setting", "You want", "Zuko now", "Status"]}
        rows={stackRows}
      />

      <Divider />

      <H2>Where scripts live</H2>
      <Table headers={["Stage", "Builder", "Role"]} rows={scriptInventory} />

      <H3>Siril CLI surface (what a future dropdown can expose)</H3>
      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill size="sm">stack</Pill>}>
            Rejection / norm / weight
          </CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text>Method: sum | min | max | med | rej</Text>
              <Text>
                Rejection: none | percentile | sigma | median | winsorized |
                linear | generalized | mad
              </Text>
              <Text>Norm: nonorm | add | mul | addscale | mulscale</Text>
              <Text>Weight: none | noise | wfwhm | nbstars | nbstack</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill size="sm">register / calibrate</Pill>}>
            Align + cosmetic
          </CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text>register [-2pass] then seqapplyreg for two-pass</Text>
              <Text>calibrate -cc=dark [siglo sighi] or -cc=bpm</Text>
              <Text>CFA flags only if OSC: -cfa -debayer -equalize_cfa</Text>
              <Text tone="secondary">
                Pixel-size / “Image information” → Siril Preferences (set …), not
                per-job script today
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <H3>Suggested presets for this branch</H3>
      <Stack gap={6}>
        <Text>
          1. Preset “Mono 1.4 (current)” — keep today’s scripts exactly.
        </Text>
        <Text>
          2. Preset “Mono recommended” — add register -2pass + seqapplyreg; stack
          Winsorized only when N≥20 else median or sigma; keep bias/flat as-is.
        </Text>
        <Text>
          3. Advanced dropdowns per stage later (rejection type, σ, norm, weight,
          cosmetic on/off).
        </Text>
      </Stack>
    </Stack>
  );
}
