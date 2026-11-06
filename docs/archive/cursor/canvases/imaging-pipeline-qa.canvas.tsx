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
  Spacer,
  Stack,
  Stat,
  Table,
  Text,
} from 'cursor/canvas';

const e2eRows = [
  {
    test: 'Ha/OIII/SII channel shapes (3 / 2 / 1 nights)',
    result: 'Pass',
    tone: 'success' as const,
    notes: 'Multi vs solo class counts match seed',
  },
  {
    test: 'Gutters + Cull columns align across filters',
    result: 'Pass',
    tone: 'success' as const,
    notes: 'gutterSpread ≤2px, cullSpread ≤2px',
  },
  {
    test: 'Channel + locks shoot modal to filter',
    result: 'Pass',
    tone: 'success' as const,
    notes: 'Title Plan SII Shoot; options all SII',
  },
  {
    test: 'Night expand keeps merge SVG path',
    result: 'Pass',
    tone: 'success' as const,
    notes: 'Chevron expand; path still present',
  },
  {
    test: 'Smoke: Capture Plan / Imaging Pipeline labels',
    result: 'Pass',
    tone: 'success' as const,
    notes: 'e2e/smoke.spec.js',
  },
  {
    test: 'Smoke: pipeline fits without horizontal scroll',
    result: 'Pass',
    tone: 'success' as const,
    notes: 'scrollWidth ≤ clientWidth+1',
  },
];

const staticRows = [
  { check: 'Fixed --pipeline-trunk-w / --pipeline-gutter-w', result: 'Pass' },
  { check: 'pipeline-merge-solo bridges single-night gutter', result: 'Pass' },
  { check: 'Spine X = gutter center (cross-filter)', result: 'Pass' },
  { check: 'addShootForChannel locks Capture Plan options', result: 'Pass' },
  { check: 'Empty channel omits Cull/Reg', result: 'Pass' },
  { check: 'ZUKO_USER_DATA_DIR isolates E2E from Dev', result: 'Pass' },
  { check: 'Rollup = N nights · captured/planned', result: 'Pass' },
];

const residual = [
  {
    id: 'R1',
    severity: 'Low',
    area: 'E2E seed',
    detail:
      'staging/e2e-data seed now has Ha×3 / OIII×2 / SII×1. Live Dev JSON was not overwritten.',
  },
  {
    id: 'R2',
    severity: 'Low',
    area: 'Visual',
    detail:
      'Done-track green vs merge gray is intentional; confirm contrast on dark theme if you use it.',
  },
  {
    id: 'R3',
    severity: 'Info',
    area: 'Manual',
    detail:
      'Worth a quick Dev reload glance: expand a Ha night and confirm the spine stays in the gutter (not through detail text).',
  },
];

export default function ImagingPipelineQaCanvas() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 960 }}>
      <Stack gap={8}>
        <H1>Imaging Pipeline QA</H1>
        <Text tone="secondary">
          Full pass on layout alignment, merge connectors, filter-locked +, and E2E isolation.
          Source: Playwright e2e/pipeline-qa + smoke · static index.html/main.js checks ·{' '}
          {new Date().toISOString().slice(0, 10)}
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="6/6" label="E2E tests" tone="success" />
        <Stat value="7/7" label="Static checks" tone="success" />
        <Stat value="≤2px" label="Gutter / Cull X spread" tone="success" />
        <Stat value="0" label="Blockers" tone="success" />
      </Grid>

      <Callout tone="success" title="Verdict">
        Imaging Pipeline QA is green. Shared rails|gutter|trunk grid keeps Cull columns and merge
        spines aligned across 3-, 2-, and 1-night filters. E2E can run while Dev is open via
        ZUKO_USER_DATA_DIR.
      </Callout>

      <Card>
        <CardHeader trailing={<Pill tone="success" active>All pass</Pill>}>
          Automated E2E
        </CardHeader>
        <CardBody>
          <Table
            headers={['Test', 'Result', 'Notes']}
            rows={e2eRows.map((r) => [r.test, r.result, r.notes])}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Static / contract checks</CardHeader>
        <CardBody>
          <Table
            headers={['Check', 'Result']}
            rows={staticRows.map((r) => [r.check, r.result])}
          />
        </CardBody>
      </Card>

      <H2>Harness changes made for QA</H2>
      <Stack gap={8}>
        <Text>
          <Text weight="semibold">e2e/helpers.js</Text> — isolated staging/e2e-userdata via
          ZUKO_USER_DATA_DIR + --user-data-dir
        </Text>
        <Text>
          <Text weight="semibold">main.js</Text> — honor ZUKO_USER_DATA_DIR before channel profile
        </Text>
        <Text>
          <Text weight="semibold">scripts/seed-e2e-data.js</Text> — Ha×3, OIII×2, SII×1 for alignment
          coverage
        </Text>
        <Text>
          <Text weight="semibold">e2e/pipeline-qa.spec.js</Text> — new focused suite
        </Text>
      </Stack>

      <Divider />

      <H2>Residual notes</H2>
      <Table
        headers={['ID', 'Severity', 'Area', 'Detail']}
        rows={residual.map((r) => [r.id, r.severity, r.area, r.detail])}
      />

      <Spacer />
      <Row gap={8}>
        <Text tone="secondary" size="small">
          Live Dev dashboard JSON was not reset. Reload Dev to pick up UI changes.
        </Text>
      </Row>
    </Stack>
  );
}
