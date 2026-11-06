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
  Row,
  Stack,
  Stat,
  Table,
  Text,
  TodoListCard,
} from "cursor/canvas";

const v03Active = [
  { id: "1", content: "Editable Filters catalog — shipped build 29", status: "completed" as const },
  { id: "23", content: "Filter mount + size (slots only on a wheel)", status: "pending" as const },
  { id: "2", content: "Dashboard JSON backup / restore", status: "pending" as const },
  { id: "3", content: "dataVersion + migrate-on-load", status: "pending" as const },
  { id: "4", content: "Startup loading skeleton", status: "pending" as const },
  { id: "6", content: "Surface gain / camera / rotator on nights & shoots", status: "pending" as const },
  { id: "8", content: "CAA Import + flip-aware folder match + no false flat-set warn (builds 26–32, 40)", status: "completed" as const },
  { id: "33", content: "Autorun Shooting→Filter retag (SII/OIII plan counts) — shipped build 40", status: "completed" as const },
  { id: "34", content: "Beta data root → H:\\Astrophotography — shipped build 41", status: "completed" as const },
  { id: "35", content: "Sky chart uses ESA DSS when CDS hangs — shipped build 42", status: "completed" as const },
  { id: "36", content: "Mono Recommended Winsorized from 10 frames — shipped build 42", status: "completed" as const },
  { id: "26", content: "Siril preprocessing settings — shipped build 33; popup/Last-run polish + Queechy restore (34)", status: "completed" as const },
  { id: "27", content: "CD for Siril clipboard + Plan Shoot tomorrow — shipped build 35", status: "completed" as const },
  { id: "29", content: "Cross-night flat-set picker + header chip/credits + Aladin bis — shipped build 36", status: "completed" as const },
  { id: "30", content: "Light-mode dusk-card contrast (ASTRO NIGHT readable) — shipped build 37", status: "completed" as const },
  { id: "31", content: "Rename to ZAP (header wordmark + Dev/Beta shortcuts) — shipped build 38", status: "completed" as const },
  { id: "32", content: "Red-mode ZAP logo — shipped build 39", status: "completed" as const },
  { id: "11", content: "Local crash / error log folder", status: "pending" as const },
  { id: "24", content: "Dark-flat library (filter + exp/gain/temp/bin)", status: "pending" as const },
];

const later = [
  { id: "5", content: "ASIAIR Plan CSV / coords export from Target Framer", status: "pending" as const },
  { id: "7", content: "Ingest move (or move-then-symlink)", status: "pending" as const },
  { id: "9", content: "Signed Windows Beta builds", status: "pending" as const },
  { id: "10", content: "Beta auto-update", status: "pending" as const },
  { id: "12", content: "First-run / empty-state guide", status: "pending" as const },
  { id: "14", content: "Imaging windows (alt + night + moon-by-filter)", status: "pending" as const },
  { id: "15", content: "Forecast ↔ project best next N nights", status: "pending" as const },
  { id: "16", content: "Site horizon profile", status: "pending" as const },
  { id: "17", content: "Mosaic panels", status: "pending" as const },
  { id: "13", content: "In-app culling UI (needs FITS thumbs)", status: "pending" as const },
  { id: "28", content: "Astrospheric v2 extra vars (opt-in dew/wind/smoke/ensemble — not default pull)", status: "pending" as const },
];

export default function ZukoBacklogPlanning() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>ZAP backlog — 0.3.0</H1>
        <Text tone="secondary">
          Canonical file: docs/backlog.md. 0.2.0 is locked. Active line is 0.3.0
          (build 42). Refresh this canvas on every zukoBuild or version ship.
        </Text>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat value="0.2.0" label="Locked through build 23" tone="success" />
        <Stat value="0.3.0" label="Active — filter mount + size next" tone="info" />
        <Stat value="build 42" label="Current package / Dev line" />
      </Grid>

      <Callout tone="success" title="Shipped since this canvas was first drawn">
        0.2.0 locked (reorder, imaging config, ASIAIR filename parse, moon altitude,
        pipeline). 0.3.0 opened. CAA/ROTATOR pipeline + camera-up flip + local NASA
        moon stills (builds 26–28). Editable Filters catalog (build 29). Import
        CAA ±10°/180° flip + progress % (30). Staged lightCount + dashboard
        save backups / refuse empty-projects wipe (31). Register display-name
        vs tone-key gate for Ha/OIII/SII (build 32). Siril preprocessing presets
        on Calibrate/Register/Stack + ASIAIR-safe binning (build 33). Popup
        scroll-lock so merge lines stay put + readable Last run + Veil Queechy
        capture-plan restore (build 34). CD for Siril clipboard helpers + Plan
        Shoot Yesterday/Today/Tomorrow (build 35). Cross-night flat-set picker,
        live Astrospheric credit ticker, header shoot-chip refresh, Aladin
        alaskybis DSS (build 36). Light-mode dusk cards (ASTRO NIGHT) readable
        (build 37). Rename to ZAP — header wordmark, ZAP Dev / ZAP Beta
        shortcuts (build 38). Red-mode ZAP logo (build 39). Import CAA flip-aware
        folder match + Autorun Shooting→Filter retag so SII/OIII plan counts
        stay honest; default flat-set note no longer yellow (build 40). Beta
        data/weather root moved to H:\Astrophotography (build 41). Sky chart
        falls through to ESA DSS when CDS hangs, and Mono Recommended uses
        Winsorized rejection from 10 frames (build 42).
      </Callout>

      <H2>0.3.0 — active</H2>
      <TodoListCard todos={v03Active} defaultExpanded />

      <H2>Version cut</H2>
      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="success" size="sm">Done</Pill>}>
            0.2.0 feature-complete
          </CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text>Ingest, calib, pipeline, forecast, framer daily-driver</Text>
              <Text>Project reorder, imaging config, moon altitude on hours</Text>
              <Text tone="secondary">Backup / dataVersion / auto-update slipped to 0.3 / later</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="info" size="sm">Now</Pill>}>
            0.3.0 headline
          </CardHeader>
          <CardBody>
            <Stack gap={6}>
              <Text weight="semibold">#23 Filter mount + size (slots only on a wheel)</Text>
              <Text>Then backup + dataVersion, startup skeleton, gain/CAA on nights, crash logs</Text>
              <Text tone="secondary">#1 Filters (29); #8 Import CAA + Register tone gate (32). Planning intelligence stays in Backlog.</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <H2>Backlog (not 0.3 cut)</H2>
      <TodoListCard todos={later} />

      <H2>Best-practice app gaps</H2>
      <Table
        headers={["Practice", "Why", "Line"]}
        rows={[
          ["JSON backup / restore", "Dev resets & QA wipe data", "0.3 #2"],
          ["Schema versioning", "Data shape keeps evolving", "0.3 #3"],
          ["Startup skeleton", "Blank shell on launch", "0.3 #4"],
          ["Crash logs (local)", "No Sentry yet", "0.3 #11"],
          ["Signed Beta + auto-update", "SmartScreen / don’t chase installers", "Backlog #9/#10"],
          ["Opt-in telemetry", "Skip until multi-user", "Later"],
          ["Cloud sync / accounts", "Out of scope", "No"],
        ]}
      />

      <Divider />

      <H3>Forum / competitive signals still worth stealing</H3>
      <Stack gap={8}>
        <Row gap={8} style={{ flexWrap: "wrap" }}>
          <Pill size="sm">ASIAIR CSV plan import</Pill>
          <Pill size="sm">Flats when rotation changes</Pill>
          <Pill size="sm">Moon vs filter windows</Pill>
          <Pill size="sm">Imaging opportunity blocks</Pill>
          <Pill size="sm">Horizon obstruction</Pill>
          <Pill size="sm">Session quality history</Pill>
        </Row>
        <Text tone="secondary" size="small">
          Source: docs/backlog.md. README Dev/Beta paths and dist:win:beta install
          flow are current; moon stills are local (external-data.md).
        </Text>
        <Text tone="tertiary" size="small">
          Explicitly out of scope: replacing ASIAIR/NINA capture, full planetarium, cloud multi-user.
        </Text>
      </Stack>
    </Stack>
  );
}
