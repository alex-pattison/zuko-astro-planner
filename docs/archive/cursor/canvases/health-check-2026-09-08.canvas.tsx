import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
} from "cursor/canvas";

const checkedAt = "2026-09-08 17:44 EDT";

export default function HealthCheck20260908() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 980 }}>
      <Stack gap={8}>
        <Row gap={10} align="center">
          <H1>Zuko health check</H1>
          <Pill active size="sm">
            Ready to reopen
          </Pill>
        </Row>
        <Text tone="secondary">
          Live probe of every network source in docs/external-data.md, plus
          local disks, Siril, Dev/Beta data, and the unit QA suite. Checked{" "}
          {checkedAt} from this machine after ~two weeks idle (last ship: build
          36 on 2026-08-25).
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="14 / 15" label="External endpoints OK" tone="success" />
        <Stat value="99,885" label="Astrospheric credits left" tone="info" />
        <Stat value="15 / 17" label="Unit suites passed" tone="warning" />
        <Stat value="1.4.4" label="Siril CLI on disk" />
      </Grid>

      <Callout tone="success" title="External weather and sky are up">
        Astrospheric v2 forecast and Moon both returned live (not cache).
        Open-Meteo forecast, astronomy calendar, and geocoding are fine.
        Aladin DSS (bis), Sesame, SIMBAD, Nominatim, Google Fonts, Clear
        Outside, and AstroBin thumbs all answered. Forecast pull billed 15
        credits; Moon billed 10. About 6,659 pulls remain until the 1 Oct UTC
        reset.
      </Callout>

      <H2>External APIs</H2>
      <Text tone="secondary" size="small">
        Source: live HTTP from this PC · {checkedAt} · lat/lon NYC 10002
        (40.7157, −73.986)
      </Text>
      <Table
        striped
        stickyHeader
        headers={["Service", "Role", "Result", "Latency"]}
        columnAlign={["left", "left", "left", "right"]}
        rowTone={[
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "danger",
          "success",
          "success",
        ]}
        rows={[
          ["Astrospheric GetForecastData", "Sky Forecast (primary)", "Live · RAG amber · 12 hours", "1.1 s"],
          ["Astrospheric Moon", "Moon card illumination / phases", "Live · 10 credits", "0.1 s"],
          ["Open-Meteo forecast", "Temp / precip / cloud fallback", "48 hourly rows", "0.5 s"],
          ["Open-Meteo astronomy", "Rise / set calendar", "16 daily rows", "0.1 s"],
          ["Open-Meteo geocoding", "Place-name search", "Queechy → 3 hits", "1.8 s"],
          ["Nominatim", "Reverse geocode", "New York", "0.2 s"],
          ["Clear Outside PNG", "Forecast strip (2-decimal coords)", "image/png 52 KB", "0.4 s"],
          ["Astrospheric.com", "Outbound link", "HTTP 200", "0.1 s"],
          ["Aladin HiPS bis", "Target Framer DSS (app default)", "properties OK", "0.4 s"],
          ["Aladin HiPS primary", "CDS alasky (was US hang)", "Now HTTP 200 — no longer hangs", "0.5 s"],
          ["Sesame / CDS", "Target name → RA/Dec (primary)", "M31 resolved", "1.4 s"],
          ["SIMBAD TAP", "Target metadata", "M 31 coords", "0.4 s"],
          ["MAST /api/v0.1/resolve", "Target name fallback", "HTTP 404 — URL retired", "0.2 s"],
          ["Google Fonts", "UI type", "Inter + Space Mono CSS", "0.1 s"],
          ["AstroBin thumb", "Optional project images", "JPEG 200", "0.5 s"],
        ]}
      />

      <Callout tone="warning" title="MAST name-resolve fallback is dead">
        Target lookup still works because CDS Sesame is the first resolver and
        it succeeded. The MAST URL in index.html
        (mast.stsci.edu/api/v0.1/resolve) now 404s. The current MAST invoke API
        (POST /api/v0/invoke, service Mast.Name.Lookup) still returns M31. Only
        matters if Sesame is down.
      </Callout>

      <H2>Local disks and tools</H2>
      <Table
        striped
        headers={["Path", "Channel", "Status"]}
        rowTone={[
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "success",
          "info",
        ]}
        rows={[
          ["F:\\zuko_dev\\Projects", "Dev imaging", "Mounted"],
          ["F:\\zuko_dev\\Dark Library", "Dev darks", "Mounted"],
          ["F:\\zuko_dev\\ASIAIR-flat-picker", "Dev ASIAIR source", "Mounted (last used 25 Aug)"],
          ["repo data/zuko-dashboard-data.json", "Dev dashboard", "Valid JSON · 3 projects after QA reset"],
          ["H:\\Photography\\Astrophotography\\Dashboard", "Beta dashboard", "Valid · 5 projects · saved today 16:37"],
          ["H:\\…\\Zuko + Dark Library", "Beta imaging", "Mounted"],
          ["Desktop ASIAIRDUMP_260825", "Beta ASIAIR source", "Present"],
          ["C:\\Program Files\\Siril\\bin\\siril-cli.exe", "Pipeline", "siril 1.4.4"],
          ["vendor/moon-cycle (708 webp)", "Moon disc", "Complete, local, no CDN"],
          ["vendor/aladin-lite.js", "Target Framer", "Present (v3.8.2 bundle)"],
          ["AppData …\\zuko-astro-planner", "Installed Beta", "0.3.0 build 36 · 25 Aug"],
        ]}
      />

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader>Runtime</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>App: 0.3.0 · zukoBuild 36 on branch beta-release</Text>
              <Text>Electron 31.7.7 (declared ^31) — this is what npm start uses</Text>
              <Text>System Node v24.18.0 / npm 11.16.0 — scripts only; Electron bundles its own Node 20</Text>
              <Text>Last git commit: 6cb6cc7 · 25 Aug 2026 · Ship cross-night flat-set picker</Text>
              <Text tone="secondary">
                Dev dashboard appMeta still said build 35 before tonight’s QA
                reset. Installed Beta matches 36.
              </Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Unit QA</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>
                15 of 17 suites passed, including sky/Open-Meteo astronomy,
                forecast credits, Siril register/stack smoke, preprocess
                settings, and live ASIAIR dump scans.
              </Text>
              <Text>
                Failed (same assertion twice): qa-asiair-ingest and
                qa-target-match-deep — loggedHrs for Veil OIII is 2.7 vs expected
                2.75 (one 180 s frame / rounding). Not a network issue.
              </Text>
              <Text tone="secondary">
                The unit runner restored Dev dashboard and removed leftover
                [TEST] projects (flat-set picker, ingest QA, target-match QA).
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Divider />
      <Text tone="secondary" size="small">
        Astrospheric caches in repo data/ were refreshed by this probe (forecast
        + moon). Beta JSON was not written. Primary Aladin CDS host
        (alasky.cds.unistra.fr) answered in 0.5 s; the app still correctly uses
        the alaskybis mirror.
      </Text>
    </Stack>
  );
}
