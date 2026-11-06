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

const shipped = [
  ["Parser", "Autorun_Log / Plan_Log + PHD2_GuideLog (skip _CHN)"],
  ["Import panel", "Plan, plate∠ vs CAA, planned lights, AF EAF, guide RMS"],
  ["Persist", "ingestMeta.sessionLog + shoot/session-logs/ copies + digest JSON"],
  ["Warnings", "CAA mismatch, light shortfall, filter-change fail, poor guide"],
  ["Calibrate / Cull", "Guide quality row + cull tip from session logs"],
  ["QA / backfill", "qa-asiair-session-logs.js · backfill-session-logs.js"],
];

const validated = [
  ["Aug 3 Veilq3v2", "∠206.5° vs CAA 211° ✓ · 20 Ha planned · AF 8300 · guide fair ~1.6″"],
  ["Jul 28 morning", "Filter change → R failed (caught) · calendar-night match"],
  ["Jul 25 pause", "Wait + manual stop · guide poor on short PHD2"],
  ["Jul 20 PHD2", "68 star-lost · fair RMS after excluding settle frames"],
];

export default function AsiairLogsExplore() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>ASIAIR session logs — implemented</H1>
        <Text tone="secondary">
          Branch explore/asiair-logs · not yet a Beta build ship
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="Done" label="Parsers + Import UI" tone="success" />
        <Stat value="~1.6″" label="Aug 3 guide RMS (fair)" />
        <Stat value="2" label="Dev shoots backfilled" />
        <Stat value="Plan-ready" label="Plan_Log_* accepted" tone="info" />
      </Grid>

      <Callout tone="success" title="What landed tonight">
        Session logs harden Import and the pipeline without blocking on missing
        log/. When log/ is present, Zuko cross-checks plate-solve angle against
        Target Framer CAA, compares Autorun planned lights to the dump, surfaces
        filter-wheel failures, and carries guide quality into Calibrate / Cull.
        Raw logs are copied beside each staged shoot.
      </Callout>

      <H2>Capabilities</H2>
      <Table headers={["Area", "Behavior"]} rows={shipped} />

      <H2>Validated on Desktop asiaIRDUMP</H2>
      <Table headers={["Sample", "Result"]} rows={validated} />

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="success" size="sm">Keep</Pill>}>
            Per-shoot archive
          </CardHeader>
          <CardBody>
            <Text>
              After Import: {"{Shoot}/session-logs/*.txt"} plus
              session-digest.json. Survives dump unplug; backs QA and future
              timeline UI.
            </Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="info" size="sm">Later</Pill>}>
            When you bring a Plan log
          </CardHeader>
          <CardBody>
            <Text>
              Same line format is already parsed (Plan_Log_* or Autorun with Plan
              Start). Drop it in log/ and re-Import / backfill — no schema change
              expected.
            </Text>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H3>How to try in Dev</H3>
      <Stack gap={6}>
        <Text>1. Point ASIAIR source at a dump that has log/ (or your Desktop asiaIRDUMP).</Text>
        <Text>2. Reload Electron → Import a night — session log panel under chips.</Text>
        <Text>3. Expand night detail / open Calibrate — guide badge when present.</Text>
        <Text tone="secondary">
          Backfill already ran for Veil 260725 SII + 260803 Ha against the Desktop dump.
        </Text>
      </Stack>
    </Stack>
  );
}
