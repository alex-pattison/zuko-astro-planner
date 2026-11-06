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

const presets = [
  ["Default", "Mono 1.4 scripts as shipped (no 2-pass)"],
  ["Mono Recommended", "2-pass register; stack median if N<20 else Winsorized rej"],
  ["Custom", "Per-flag dropdowns for that stage only"],
];

const stages = [
  ["Master bias / dark", "method, rejection, σ, norm, weight"],
  ["Master flat", "use bias + stack flags"],
  ["Calibrate lights", "cosmetic from dark on/off"],
  ["Register", "two-pass on/off"],
  ["Stack", "method, rejection, norm, weight + N rule (mono)"],
];

const binning = [
  ["Unchecked (default)", "set core.binning_update=false", "ASIAIR Bin2 — plate solve OK"],
  ["Checked", "set core.binning_update=true", "Header µm is physical; multiply by binning"],
];

const customFlags = [
  ["Method", "rej / med / sum", "rej for deep-sky lights & masters"],
  ["Rejection", "winsorized / median / sigma / none…", "Winsorized when N≳20"],
  ["Norm", "none / mul / addscale / add", "mul flats; addscale lights"],
  ["Weight", "none / noise / wfwhm / nbstars", "Leave none unless curated"],
  ["Two-pass", "off / on", "On for multi-night Aggregate"],
  ["Cosmetic", "on (dark) / off", "On for mono with master dark"],
  ["Use bias", "on / off", "On for normal flat workflow"],
];

const qaCases = [
  ["default-*", "Mono 1.4 shape + binning false"],
  ["*-binning-on", "core.binning_update=true"],
  ["mono-register-2pass", "-2pass + seqapplyreg"],
  ["mono-stack-few/many", "med vs rej by N"],
  ["custom-*", "sigma / no-bias / no-cc / weight / med"],
  ["mixed-presets", "Custom register + mono stack"],
];

export default function PreprocessSettingsCatalog() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 980 }}>
      <Stack gap={8}>
        <H1>Preprocessing settings catalog</H1>
        <Text tone="secondary">
          Default · Mono Recommended · Custom · Stack sampling checkbox
        </Text>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat value="5" label="Stage cards" />
        <Stat value="3" label="Presets each" />
        <Stat value="15" label="Fixture cases" />
      </Grid>

      <Callout tone="info" title="Where to find it">
        Settings → Siril preprocessing for presets. Stack confirm → “Update pixel
        size of binned images” (default unchecked) with (i) help. Docs:
        docs/preprocess-settings.md · QA:
        staging/preprocess-settings-sample/fixtures.json
      </Callout>

      <H2>Presets</H2>
      <Table headers={["Preset", "Meaning"]} rows={presets} />

      <H2>Stages</H2>
      <Table headers={["Stage", "Custom unlocks"]} rows={stages} />

      <H2>Sampling (plate solving)</H2>
      <Table headers={["Checkbox", "Script line", "When"]} rows={binning} />
      <Text tone="secondary">
        Applied on Register and Stack scripts so r_pp_light_* and result_*.fit keep
        correct arcsec/px.
      </Text>

      <Divider />

      <H2>Custom flags + (i) guidance</H2>
      <Table headers={["Flag", "Options", "Recommended"]} rows={customFlags} />

      <H2>Sample QA coverage</H2>
      <Table headers={["Case group", "Asserts"]} rows={qaCases} />

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="success" size="sm">Default off</Pill>}>
            Binning update
          </CardHeader>
          <CardBody>
            <Text>
              Unchecked = ASIAIR-safe. Matches Siril preference “Update pixel size
              of binned images” / Real pixel size.
            </Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="info" size="sm">Custom</Pill>}>
            Renamed from Other
          </CardHeader>
          <CardBody>
            <Text>
              Label is Custom everywhere (Settings + docs). Expands only the
              current stage’s flags.
            </Text>
          </CardBody>
        </Card>
      </Grid>

      <H3>Run</H3>
      <Text tone="secondary">node scripts/qa-preprocess-settings.js</Text>
    </Stack>
  );
}
