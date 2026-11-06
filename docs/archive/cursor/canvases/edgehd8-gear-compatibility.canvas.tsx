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
} from "cursor/canvas";

const GEAR_ROWS = [
  {
    item: "ASI294MM Pro (Bin2, 23.2 mm diag)",
    verdict: "Strong pass",
    tone: "success" as const,
    note: "EdgeHD 8 + 0.7× image circle 26.7 mm — sensor fits with margin; flatter than classic f/6.3",
  },
  {
    item: "EFW 8×31mm (20 mm)",
    verdict: "Pass",
    tone: "success" as const,
    note: "Same 105 mm @ f/7 stack as classic reduced — OAG + EFW + 6.5 mm camera + spacers",
  },
  {
    item: "Astrodon 5nm / Baader Hβ 31mm",
    verdict: "Pass",
    tone: "success" as const,
    note: "f/7 is slow; 5nm fine. Less vignette pressure than FRA @ f/3.9",
  },
  {
    item: "ASI120MM Mini",
    verdict: "Pass",
    tone: "success" as const,
    note: "Stock ZWO OAG (8×8) is enough for 4/3″; OAG-L optional, not required",
  },
  {
    item: "SV165 guide scope",
    verdict: "Skip on Edge",
    tone: "neutral" as const,
    note: "Keep on FRA400; OAG at 1422–2032 mm",
  },
  {
    item: "ASIAIR + Powerbox",
    verdict: "Pass",
    tone: "success" as const,
    note: "Starfront-ready control/power path unchanged",
  },
  {
    item: "FRA EAF motor",
    verdict: "Needs SCT bracket",
    tone: "warning" as const,
    note: "ZWO C8/C9.25 bracket fits EdgeHD 8; same mirror-flop tuning as classic SCT",
  },
  {
    item: "AM3N (city)",
    verdict: "CW required",
    tone: "warning" as const,
    note: "OTA alone 6.35 kg; full train ~9–10.5 kg → under 13 kg CW, tighter than classic C8",
  },
  {
    item: "AM3N → Starfront",
    verdict: "Upgrade EQ",
    tone: "warning" as const,
    note: "Plan GEM45 / CEM70 class; Starfront rejects CGX/AVX; AM5 possible but they prefer heavier EQ for larger OTAs",
  },
];

const COMPARE_ROWS = [
  {
    facet: "Focal length (reduced)",
    classic: "~1280 mm f/6.3",
    edge: "1422 mm f/7",
  },
  {
    facet: "Scale @ ASI294 Bin2",
    classic: "0.75″/px",
    edge: "0.67″/px",
  },
  {
    facet: "FOV (approx)",
    classic: "~0.86° × 0.58°",
    edge: "~0.77° × 0.53°",
  },
  {
    facet: "Field / corners",
    classic: "Soft corners common; crop often",
    edge: "Designed flat; 0.7× keeps flat-field intent",
  },
  {
    facet: "Reducer image circle",
    classic: "Adequate for 4/3″, not APS-C-perfect",
    edge: "26.7 mm — sized for APS-C; 4/3″ comfortable",
  },
  {
    facet: "OTA weight",
    classic: "~5.7 kg",
    edge: "6.35 kg",
  },
  {
    facet: "Reducer",
    classic: "f/6.3 #94175 ~$200",
    edge: "0.7× #94242 ~$420 (Edge-only)",
  },
  {
    facet: "OTA street $",
    classic: "~$950–1,400",
    edge: "~$1,500–1,700 new",
  },
  {
    facet: "AM3N headroom",
    classic: "Easier (~8.5–9.5 kg full)",
    edge: "Tighter (~9–10.5 kg full)",
  },
];

const BUY_ROWS = [
  { item: "EdgeHD 8 OTA (CGE bar)", why: "2032 mm / 1422 mm @ 0.7×", est: "~$1,699" },
  { item: "Reducer 0.7× #94242", why: "Not interchangeable with classic f/6.3", est: "~$419" },
  { item: "EdgeHD 8 T-adapter #93644", why: "Short config with reducer → part of 105 mm", est: "~$50" },
  { item: "ZWO OAG (standard)", why: "4/3″ + 31mm EFW", est: "~$150" },
  { item: "ZWO EAF C8/C9.25 bracket", why: "Reuse FRA EAF on EdgeHD focus knob", est: "~$45" },
  { item: "Corrector dew + (optional) shield", why: "Texas humidity; shield = swing radius", est: "~$40–120" },
  { item: "Starfront EQ (later)", why: "GEM45 / CEM70 class — not CGX/AVX", est: "$2k–3.5k+" },
];

const SCALE_ROWS = [
  {
    config: "FRA400 @ 280 mm (now)",
    fl: "280",
    scale: "3.41″/px",
    fov: "~2.7° × 1.8°",
  },
  {
    config: "EdgeHD 8 + 0.7×",
    fl: "1422",
    scale: "0.67″/px",
    fov: "~0.77° × 0.53°",
  },
  {
    config: "EdgeHD 8 native f/10",
    fl: "2032",
    scale: "0.47″/px",
    fov: "~0.54° × 0.37°",
  },
  {
    config: "Classic C8 + f/6.3 (alt)",
    fl: "~1280",
    scale: "0.75″/px",
    fov: "~0.86° × 0.58°",
  },
];

export default function EdgeHdGearCompatibility() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>EdgeHD 8 + your kit — compatibility</H1>
        <Text tone="secondary">
          Same owned gear as the C8 check, re-scored for EdgeHD 8 + dedicated 0.7× (#94242). City on
          AM3N with CW; Starfront later on a proper EQ. Matches your earlier wishlist path (OTA +
          94242 + OAG + EAF).
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="Pass" label="Camera / filters / wheel" tone="success" />
        <Stat value="Better" label="Field vs classic C8" tone="success" />
        <Stat value="Tighter" label="AM3N payload" tone="warning" />
        <Stat value="~$2.3k+" label="OTA + reducer ballpark" tone="info" />
      </Grid>

      <Callout tone="info">
        EdgeHD is the better long-term imaging choice for your 294 — especially if Starfront is the
        endgame. Your gear still transfers; you pay more and run closer to AM3N’s CW ceiling in the
        city phase.
      </Callout>

      <H2>Owned gear vs EdgeHD train</H2>
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

      <H2>Classic C8 vs EdgeHD 8 (for you)</H2>
      <Table
        headers={["Facet", "Classic C8 + f/6.3", "EdgeHD 8 + 0.7×"]}
        rows={COMPARE_ROWS.map((r) => [r.facet, r.classic, r.edge])}
      />

      <H2>Optical train @ f/7 (105 mm)</H2>
      <Card>
        <CardHeader>Recommended stack (reducer → sensor)</CardHeader>
        <CardBody>
          <Stack gap={6}>
            <Text weight="semibold">
              EdgeHD rear → 0.7× #94242 → EdgeHD T-adapter #93644 (short / extension removed)
            </Text>
            <Text>
              → spacer as needed → ZWO OAG (16.5) → EFW 8×31 (20) → ASI294 (6.5) ≈ remaining 55 mm
            </Text>
            <Text tone="secondary">
              Native f/10 needs 133.35 mm (same T-adapter with extension). Prefer slightly short vs
              long if you miss by 1–3 mm. Do not use classic #94175 f/6.3 on EdgeHD.
            </Text>
          </Stack>
        </CardBody>
      </Card>

      <H2>Sampling & FOV (ASI294 Bin2)</H2>
      <Table
        headers={["Config", "FL (mm)", "Scale", "FOV (approx)"]}
        rows={SCALE_ROWS.map((r) => [r.config, r.fl, r.scale, r.fov])}
      />
      <Text tone="secondary" style={{ fontSize: 12 }}>
        Edge @ f/7 is ~0.67″/px — between classic reduced C8 and native f/10. Good Starfront DSO
        scale; city nights still want shortish subs + solid guiding.
      </Text>

      <Divider />

      <H2>Must buy</H2>
      <Table
        headers={["Item", "Why", "Ballpark"]}
        rows={BUY_ROWS.map((r) => [r.item, r.why, r.est])}
      />

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader>City (AM3N)</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>Lean imaging ~9 kg; full EAF/dew/cables ~9.5–10.5 kg.</Text>
              <Text>Always use CW. Stay east-heavy; don’t chase the 8 kg no-CW rating.</Text>
              <Text tone="secondary">
                Heavier than classic C8 by ~0.7–1 kg OTA + heavier reducer — still legal on 13 kg,
                less forgiving of cable dangle / CW mistakes.
              </Text>
            </Stack>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Starfront (EQ)</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>Ship Edge kit + EQ + ASIAIR train; FRA stays NYC widefield.</Text>
              <Text>GEM45 / CEM70-class preferred for an 8″ Edge imaging load.</Text>
              <Text tone="secondary">
                Same SCT remote risks: mirror flop, cool-down, dew on corrector. Prove EAF at home
                first.
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <H2>Risks (Edge-specific)</H2>
      <Stack gap={10}>
        <Row gap={8} align="start">
          <Pill tone="warning" size="sm">
            High
          </Pill>
          <Text>
            Cost + AM3N margin — you’re buying the “right” OTA for imaging, but city mount is near
            its useful limit.
          </Text>
        </Row>
        <Row gap={8} align="start">
          <Pill tone="warning" size="sm">
            Med
          </Pill>
          <Text>
            Still an SCT: mirror shift, focus travel, collimation after shipping — EdgeHD does not
            remove those.
          </Text>
        </Row>
        <Row gap={8} align="start">
          <Pill tone="neutral" size="sm">
            Low
          </Pill>
          <Text>
            Wrong reducer — #94242 only. Classic f/6.3 on EdgeHD is a common expensive mistake.
          </Text>
        </Row>
      </Stack>

      <Spacer height={8} />
      <H3>Bottom line</H3>
      <Text>
        If Starfront + serious DSO is the goal, EdgeHD 8 + 0.7× is the better match for your 294
        than classic C8. Compatibility of owned gear is the same pass; the delta is money, flatter
        field, slightly longer reduced FL, and a tighter AM3N payload until the EQ arrives.
      </Text>
      <Text tone="secondary" style={{ fontSize: 12 }}>
        Inventory: zuko-dashboard-data.json · Celestron EdgeHD / 94242 docs · Starfront FAQ · Aug
        2026
      </Text>
    </Stack>
  );
}
