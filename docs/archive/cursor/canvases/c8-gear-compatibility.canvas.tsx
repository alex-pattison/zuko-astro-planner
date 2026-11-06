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
  Spacer,
  Stack,
  Stat,
  Table,
  Text,
  useHostTheme,
} from "cursor/canvas";

const GEAR_ROWS = [
  {
    item: "ASI294MM Pro (Bin2)",
    verdict: "Pass",
    tone: "success" as const,
    note: "4/3″ fits classic f/6.3 well; mild corner soft/vignette, flats OK",
  },
  {
    item: "EFW 8×31mm (20 mm)",
    verdict: "Pass",
    tone: "success" as const,
    note: "Fits ZWO 55 mm remainder after SCT T-adapter; same hub as today",
  },
  {
    item: "Astrodon 5nm + Baader Hβ 31mm",
    verdict: "Pass",
    tone: "success" as const,
    note: "f/6.3 is slow vs FRA@f/3.9 — less filter-edge vignette; 5nm fine at f/6.3",
  },
  {
    item: "ASI120MM Mini",
    verdict: "Pass",
    tone: "success" as const,
    note: "Correct partner for stock ZWO OAG (not OAG-L)",
  },
  {
    item: "SV165 30mm guide scope",
    verdict: "Skip on C8",
    tone: "neutral" as const,
    note: "Keep on FRA400; at ≥1280 mm use OAG to kill flexure",
  },
  {
    item: "ASIAIR Plus 256GB",
    verdict: "Pass",
    tone: "success" as const,
    note: "Starfront accepts ASIAIR; schedule + PA + OAG guiding OK",
  },
  {
    item: "Pegasus Powerbox Micro",
    verdict: "Pass",
    tone: "success" as const,
    note: "AC bricks at Starfront; keep Powerbox for dew/camera/mount rails",
  },
  {
    item: "FRA400 EAF motor",
    verdict: "Needs bracket",
    tone: "warning" as const,
    note: "Move motor to C8 with ZWO C8/C9.25 bracket; FRA needs its own later",
  },
  {
    item: "AM3N + TC40 (city)",
    verdict: "CW required",
    tone: "warning" as const,
    note: "~8.5–9.5 kg full train → under 13 kg CW limit; no-CW is marginal",
  },
  {
    item: "AM3N at Starfront",
    verdict: "Not ideal",
    tone: "warning" as const,
    note: "Starfront OK with AM3/AM5 hardware, but recommends GEM45/CEM70 for larger OTAs",
  },
];

const BUY_ROWS = [
  { item: "C8 OTA (classic XLT)", why: "2032 mm native / ~1280 mm @ f/6.3", est: "$950–1,400" },
  { item: "Celestron f/6.3 reducer 94175", why: "Not EdgeHD 0.7× — classic SCT only", est: "~$200" },
  { item: "SCT T-adapter (93633-A)", why: "50 mm of the 105 mm backfocus", est: "~$40" },
  { item: "ZWO OAG (standard 8×8)", why: "4/3″ + 31mm EFW; OAG-L unnecessary", est: "~$150" },
  { item: "ZWO EAF C8/C9.25 bracket", why: "Reuse FRA EAF motor on SCT knob", est: "~$45" },
  { item: "Corrector dew strap (+ shield)", why: "Texas humidity; shield grows swing radius", est: "~$40–120" },
  { item: "Starfront EQ (later)", why: "GEM45 / CEM70 class; avoid Celestron CGX/AVX", est: "$2k–3.5k+" },
];

const SCALE_ROWS = [
  {
    config: "FRA400 @ 280 mm (current reduced)",
    fl: "280",
    scale: "3.41″/px",
    fov: "~2.7° × 1.8°",
    role: "Widefield / city NB",
  },
  {
    config: "FRA400 @ 400 mm native",
    fl: "400",
    scale: "2.39″/px",
    fov: "~1.9° × 1.3°",
    role: "Wide galaxies / large nebulae",
  },
  {
    config: "C8 + f/6.3",
    fl: "~1280",
    scale: "0.75″/px",
    fov: "~0.86° × 0.58°",
    role: "Primary DSO / Starfront",
  },
  {
    config: "C8 native f/10",
    fl: "2032",
    scale: "0.47″/px",
    fov: "~0.54° × 0.37°",
    role: "Planetary / tiny galaxies",
  },
];

export default function C8GearCompatibility() {
  const theme = useHostTheme();

  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>C8 + your kit — compatibility check</H1>
        <Text tone="secondary">
          Classic C8 + f/6.3 reducer + OAG vs owned gear (dashboard inventory). City on AM3N;
          Starfront later on a proper EQ. Sources: Celestron backfocus docs, ZWO OAG/EFW spacing,
          Starfront remote checklist / FAQ (no CGX/AVX).
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="Pass" label="Camera / filters / wheel" tone="success" />
        <Stat value="Pass*" label="Guiding (OAG path)" tone="success" />
        <Stat value="Buy 5–6" label="Missing pieces" tone="warning" />
        <Stat value="~70%" label="Of AM3N 13 kg CW limit" tone="info" />
      </Grid>

      <Callout tone="info">
        Verdict: almost everything you already own moves onto a classic C8. Buy OTA + reducer +
        T-adapter + OAG + EAF SCT bracket. Keep FRA400 as the city widefield; ship the C8 kit + EQ
        to Starfront when ready.
      </Callout>

      <H2>Owned gear vs C8 train</H2>
      <Table
        headers={["Item", "Verdict", "Notes"]}
        rows={GEAR_ROWS.map((r) => [
          r.item,
          <Pill tone={r.tone} size="sm">
            {r.verdict}
          </Pill>,
          r.note,
        ])}
      />

      <H2>Optical train (must hit ~105 mm)</H2>
      <Text tone="secondary">
        Celestron: measure from rear metal face of f/6.3 reducer to sensor. SCT T-adapter ≈ 50 mm →
        remaining ≈ 55 mm (standard ZWO cooled stack).
      </Text>
      <Card>
        <CardHeader>Recommended stack (scope → sensor)</CardHeader>
        <CardBody>
          <Stack gap={6}>
            <Text weight="semibold">C8 rear cell → f/6.3 reducer → SCT T-adapter (50 mm)</Text>
            <Text>
              → spacer ~11–12 mm → ZWO OAG (16.5 mm) → EFW 8×31 (20 mm) → ASI294 (6.5 mm flange)
            </Text>
            <Text tone="secondary">
              50 + 11.5 + 16.5 + 20 + 6.5 ≈ 105 mm. Tune ± a few mm for star shape (many land ~108–110
              mm with filters). OAG replaces the usual 16.5 mm spacer — do not stack both.
            </Text>
          </Stack>
        </CardBody>
      </Card>

      <H2>Sampling & FOV (ASI294 Bin2, 4.63 µm)</H2>
      <Table
        headers={["Config", "FL (mm)", "Scale", "FOV (approx)", "Role"]}
        rows={SCALE_ROWS.map((r) => [r.config, r.fl, r.scale, r.fov, r.role])}
      />
      <Text tone="secondary" style={{ fontSize: 12 }}>
        Scale = 206.265 × 4.63 / FL. NYC seeing often 2–3″ — C8@f/6.3 is slightly oversampled but
        usable; Texas dark skies reward it. Native f/10 is planetary / crop territory for DSO.
      </Text>

      <Divider />

      <H2>Must buy (build-out path)</H2>
      <Table
        headers={["Item", "Why", "Ballpark"]}
        rows={BUY_ROWS.map((r) => [r.item, r.why, r.est])}
      />

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader>City phase (AM3N)</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>Full train ~8.5–9.5 kg → CW on AM3N (limit 13 kg).</Text>
              <Text>OAG + ASI120; park SV165 on FRA400.</Text>
              <Text>EAF: large AF step (~100–150), backlash so final move pushes mirror against gravity.</Text>
              <Text tone="secondary">Expect mirror flop / refocus after meridian flip.</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Starfront phase (EQ)</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>Ship: OTA + EQ + camera train + EAF + ASIAIR + Powerbox + cables + 30′ Cat6.</Text>
              <Text>Starfront rejects Celestron CGX/AVX. Prefer iOptron GEM45 / CEM70 class.</Text>
              <Text>AM5 possible; Starfront themselves point larger OTAs at GEM45/CEM70.</Text>
              <Text tone="secondary">Dew shield / flat panel increase swing radius — check pier wizard before booking.</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <H2>Risks (rank ordered)</H2>
      <Stack gap={10}>
        <Row gap={8} align="start">
          <Pill tone="warning" size="sm">
            High
          </Pill>
          <Text>
            SCT focus mechanics — mirror shift/flop. Remote-ready only after home nights prove EAF
            V-curves + post-flip refocus on ASIAIR.
          </Text>
        </Row>
        <Row gap={8} align="start">
          <Pill tone="warning" size="sm">
            Med
          </Pill>
          <Text>
            Classic f/6.3 is not EdgeHD-flat. On 4/3″ expect soft corners; mild crop often best.
            EdgeHD 8 + 0.7× is flatter but heavier/pricier (your earlier wishlist path).
          </Text>
        </Row>
        <Row gap={8} align="start">
          <Pill tone="neutral" size="sm">
            Med
          </Pill>
          <Text>
            One EAF between FRA and C8 — dual-scope nights need a second EAF or bracket swaps.
          </Text>
        </Row>
        <Row gap={8} align="start">
          <Pill tone="neutral" size="sm">
            Low
          </Pill>
          <Text>
            Collimation drifts in shipping — Starfront has tools; keep rear cell / visual-back access
            clear for their collimators.
          </Text>
        </Row>
      </Stack>

      <Spacer height={8} />
      <H3>Bottom line</H3>
      <Text>
        Compatibility is strong: camera, wheel, filters, guide cam, ASIAIR, and power all transfer.
        The C8 path is mostly buying the OTA optics chain + OAG + SCT EAF bracket, then a
        non-Celestron EQ when you go remote — not replacing your imaging core.
      </Text>
      <Text tone="secondary" style={{ fontSize: 12 }}>
        Inventory source: zuko-dashboard-data.json assets · research date Aug 2026
      </Text>
    </Stack>
  );
}
