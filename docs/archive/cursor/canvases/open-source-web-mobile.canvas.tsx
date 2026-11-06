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
} from "cursor/canvas";

export default function OpenSourceWebMobile() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>Zuko as a product other people use</H1>
        <Text tone="secondary">
          Snapshot vs this checkout (0.3.0 / build 29). Sources: package.json,
          main.js path constants, docs/external-data.md, docs/backlog.md,
          Electron security checklist, Astrospheric/Open-Meteo/Nominatim/CDS
          usage constraints.
        </Text>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat value="Desktop OSS" label="Possible after a sanitizing pass" tone="info" />
        <Stat value="Website" label="Planner slice only — not ingest/Siril" tone="warning" />
        <Stat value="Phone app" label="Companion later, not a port" tone="warning" />
      </Grid>

      <Callout tone="warning" title="Do not flip the GitHub repo public today">
        License is UNLICENSED and private. Tracked JSON and scripts/defaultAssets.js
        hold home site, purchase prices, and Windows paths under H: and F:. That
        is personal data, not a starter template.
      </Callout>

      <H2>What each surface can actually run</H2>
      <Table
        headers={["Capability", "This Electron app", "Web host", "Mobile"]}
        rows={[
          [
            "Sky forecast / moon / sun",
            "Yes (Astrospheric key in .env)",
            "Yes, if the key stays on a server",
            "Yes, as a companion",
          ],
          [
            "Target Framer (Aladin)",
            "Yes",
            "Mostly — survey tiles are already HTTP",
            "Awkward (small screen, WebView)",
          ],
          [
            "ASIAIR ingest + FITS copy",
            "Yes (Node fs)",
            "No — browsers cannot walk USB dumps",
            "No (no Siril tree on phone)",
          ],
          [
            "Siril cull / register / stack",
            "Yes (siril-cli.exe)",
            "No",
            "No",
          ],
          [
            "Dark library on disk",
            "Yes",
            "No (unless you invent cloud storage)",
            "No",
          ],
          [
            "Capture Plan / Filters catalog",
            "Yes",
            "Yes, if data is in the cloud",
            "Read-only is realistic",
          ],
        ]}
      />
      <Text tone="tertiary" size="small">
        Source: process split in main.js / src/ingest / src/siril vs Chromium
        renderer limits. Web and mobile have no Node filesystem or child_process.
      </Text>

      <H2>Open-sourcing the desktop app</H2>
      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader>Must fix before public</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>
                Pick a license (MIT is usual; GPL if you want copyleft). There is
                no LICENSE file today.
              </Text>
              <Text>
                Stop shipping live dashboard JSON and rig-asset prices. Seed an
                empty or fictional example instead.
              </Text>
              <Text>
                Replace hardcoded H:\ / F:\ / C:\Users\alexp paths with first-run
                Settings (ASIAIR dump, projects root, dark library, data folder).
              </Text>
              <Text>
                Each user brings their own Astrospheric Pro key. Do not proxy
                yours — credits are per pull (~65 forecast, 10 moon).
              </Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Then it is still a Windows ASIAIR+Siril tool</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>
                siril-cli.exe, PowerShell geolocate, and NSIS Beta install are
                Windows. Mac/Linux Electron builds would be extra work, not a
                checkbox.
              </Text>
              <Text>
                Unsigned installers hit SmartScreen (backlog #9). Support load
                jumps the moment strangers have different wheels, sites, and
                ASIAIR layouts.
              </Text>
              <Text>
                Nominatim, Sesame/SIMBAD, and Aladin tiles expect a real
                User-Agent and light traffic. Fine for you; not fine as an
                anonymous public hammer.
              </Text>
              <Text tone="secondary">
                First-run empty state is still backlog #12 — a public app without
                it looks broken.
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <H2>Website</H2>
      <Callout tone="info" title="This is a new product, not a host of index.html">
        Electron’s value here is disk + Siril. A browser cannot import an ASIAIR
        dump or run the pipeline. Hosting the current file would also leak the
        Astrospheric key if you tried to call the API from the page.
      </Callout>
      <Stack gap={8}>
        <Text>
          Realistic web slice: forecast, moon, project list, maybe Aladin
          framing. That needs a small backend (keep API keys server-side),
          accounts, and CORS-legal calls. Open-Meteo is the free path;
          Astrospheric at other people’s volume is a cost and ToS problem.
        </Text>
        <Text>
          Google Fonts and CDS tiles already go to the network from the
          renderer. A public site also needs a privacy note (location, IP)
          that a single-user desktop app mostly skips.
        </Text>
      </Stack>

      <H2>Mobile</H2>
      <Text>
        Matches the existing backlog item: a companion for forecast / “go
        image” / project hours — not a rewrite of ingest. Wrapping the 18k-line
        HTML in Capacitor would still not give you Siril or FITS folders.
        Push alerts need a server and make Astrospheric credits worse (every
        phone refresh).
      </Text>

      <Divider />

      <H3>Least-regret order if you ever want others to use it</H3>
      <Row gap={8} style={{ flexWrap: "wrap" }}>
        <Pill tone="info">1. Sanitize + Settings paths</Pill>
        <Pill>2. LICENSE + example data</Pill>
        <Pill>3. Signed Windows Beta</Pill>
        <Pill tone="neutral">4. Optional forecast companion</Pill>
        <Pill tone="neutral">5. Skip full web pipeline</Pill>
      </Row>
      <Text tone="tertiary" size="small">
        Out of scope (already in docs/backlog.md): replacing ASIAIR/NINA as
        capture, full planetarium, cloud multi-user until backup (#2) exists.
      </Text>
    </Stack>
  );
}
