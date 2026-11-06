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

export default function LaunchSirilFeasibility() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 920 }}>
      <Stack gap={8}>
        <H1>Launch Siril from Zuko — feasibility</H1>
        <Text tone="secondary">
          Branch: launch-siril-from-app · Target first: Cull modal → Aggregate
          folder · Later: project-level entry points
        </Text>
      </Stack>

      <Grid columns={3} gap={12}>
        <Stat value="Yes" label="A) Launch GUI" tone="success" />
        <Stat value="Yes*" label="B) Set working dir" tone="success" />
        <Stat value="Partial" label="Bring existing to front + change cwd" tone="warning" />
      </Grid>

      <Callout tone="info" title="Verdict">
        Feasible and a good fit for Cull. Cold-start with siril.exe -d
        AggregateDir (optional: also open r_pp_light_.seq) is reliable on your
        Siril 1.4.x install. Bring-to-front alone cannot change cwd of an
        already-open window — recommend prefer “open (or new) instance with -d”.
      </Callout>

      <H2>What Siril already supports</H2>
      <Table
        headers={["Capability", "How", "Notes"]}
        rows={[
          [
            "Launch GUI",
            "C:\\Program Files\\Siril\\bin\\siril.exe",
            "Confirmed present; --help lists GUI options",
          ],
          [
            "Set cwd at start",
            "siril.exe -d \"path\"",
            "Same flag on GUI and siril-cli; official man page",
          ],
          [
            "Open file/seq at start",
            "siril.exe [options] file",
            "Can pass Aggregate\\r_pp_light_.seq after -d",
          ],
          [
            "Change cwd later",
            "GUI Home button / cd command",
            "Only inside a running session — not via a second launch arg",
          ],
          [
            "Headless automation",
            "siril-cli -d … -s script.ssf",
            "What Zuko already uses for Calibrate/Register/Stack",
          ],
        ]}
      />

      <H2>Goal A — open or focus Siril</H2>
      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="success" size="sm">Easy</Pill>}>
            Launch if not running
          </CardHeader>
          <CardBody>
            <Text>
              spawn detached siril.exe from Electron main (same resolve path
              pattern as resolveSirilCli). Detached + unref so Zuko does not own
              the process lifetime.
            </Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="warning" size="sm">Caveat</Pill>}>
            Bring existing to front
          </CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>
                Siril allows multiple instances — no single-instance lock. A
                second launch does not focus the first window.
              </Text>
              <Text tone="secondary">
                Windows can EnumProcesses / FindWindow + SetForegroundWindow for
                “focus only,” but that leaves the old cwd. Focus + cwd change
                together needs a new instance (or pipes — overkill for Cull).
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <H2>Goal B — set working directory</H2>
      <Stack gap={12}>
        <Text>
          For Cull, cwd should be the filter Aggregate folder (already in
          _cullModalCtx.aggregateDir). Example:
        </Text>
        <Text weight="semibold">
          siril.exe -d &quot;…\\SII\\Aggregate&quot; &quot;…\\SII\\Aggregate\\r_pp_light_.seq&quot;
        </Text>
        <Table
          headers={["Strategy", "cwd set?", "UX", "Recommend"]}
          rows={[
            [
              "Always launch with -d (new instance OK)",
              "Yes",
              "May open a 2nd Siril if one is open",
              "Best default for Cull",
            ],
            [
              "If running → focus only",
              "No",
              "Wrong folder risk",
              "Avoid alone",
            ],
            [
              "If running → focus; else launch -d",
              "Only when closed",
              "Inconsistent",
              "Weak",
            ],
            [
              "If running → ask: focus / open new with Aggregate",
              "Yes when chosen",
              "One extra click",
              "Nice polish later",
            ],
            [
              "Named pipes send cd to GUI",
              "Maybe",
              "Pipe mode is headless; GUI control is fragile",
              "Skip for v1",
            ],
          ]}
        />
      </Stack>

      <H2>Fit with Zuko today</H2>
      <Table
        headers={["Area", "Status"]}
        rows={[
          [
            "siril-cli path",
            "Already resolved: Program Files\\Siril\\bin\\siril-cli.exe",
          ],
          [
            "GUI path",
            "Sibling siril.exe — add resolveSirilGui() next to resolveSirilCli()",
          ],
          [
            "Cull context",
            "aggregateDir already known in openCullModal / _cullModalCtx",
          ],
          [
            "IPC",
            "New handle e.g. zuko-siril-open-gui({ workDir, openFile? })",
          ],
          [
            "Automation conflict",
            "Headless jobs and GUI are separate processes — OK to run both; don’t send -s to the GUI button",
          ],
        ]}
      />

      <H2>Suggested v1 (Cull button)</H2>
      <Stack gap={8}>
        <Text weight="semibold">“Open in Siril”</Text>
        <Text>
          1. Resolve siril.exe · 2. spawn([`-d`, aggregateDir], optional seq
          path) · 3. detached · 4. toast on missing install / missing Aggregate
        </Text>
        <Text tone="secondary">
          Skip bring-to-front logic in v1 unless you dislike a second window.
          Later: project header button with projectDir or working/.
        </Text>
      </Stack>

      <Divider />
      <H3>Sources</H3>
      <Text tone="secondary">
        siril.org man page · local siril.exe --help (1.4.x) · Siril docs cwd ·
        discuss.pixls (multi-instance) · Zuko src/siril/preprocess.js
      </Text>
    </Stack>
  );
}
