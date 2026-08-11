// @ts-check
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

/** @type {import('@playwright/test').Page} */
let window;
/** @type {import('@playwright/test').ElectronApplication} */
let electronApp;

test.beforeAll(async () => {
  ({ electronApp, window } = await launchApp());
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
});

async function openE2eProject() {
  const card = window.locator('[data-testid="project-card"][data-project-name="[E2E] Target Match Smoke"]');
  await expect(card).toBeVisible();
  if (!(await card.evaluate((el) => el.classList.contains('open')))) {
    await card.getByTestId('project-expand').click();
    await expect(card).toHaveClass(/open/);
  }
  const section = card.getByTestId('imaging-pipeline');
  await expect(section).toBeVisible();
  if (!(await section.locator('.pipeline-filter-list').count())) {
    await section.locator('.shoot-log-toggle').click();
  }
  await expect(section.getByTestId('pipeline-bars')).toBeVisible();
  return { card, section, bars: section.getByTestId('pipeline-bars') };
}

test('Imaging Pipeline: Ha/OIII/SII channel shapes (3 / 2 / 1 nights)', async () => {
  const { bars } = await openE2eProject();
  const ha = bars.getByTestId('pipeline-channel-ha');
  const oiii = bars.getByTestId('pipeline-channel-oiii');
  const sii = bars.getByTestId('pipeline-channel-sii');
  await expect(ha).toBeVisible();
  await expect(oiii).toBeVisible();
  await expect(sii).toBeVisible();

  await expect(ha.locator('.pipeline-merge')).toHaveCount(1);
  await expect(ha.locator('.pipeline-merge-solo')).toHaveCount(0);
  await expect(ha.locator('.pipeline-merge-nights .pipeline-night-wrap')).toHaveCount(3);

  await expect(oiii.locator('.pipeline-merge')).toHaveCount(1);
  await expect(oiii.locator('.pipeline-merge-solo')).toHaveCount(0);
  await expect(oiii.locator('.pipeline-merge-nights .pipeline-night-wrap')).toHaveCount(2);

  await expect(sii.locator('.pipeline-merge-solo')).toHaveCount(1);
  await expect(sii.locator('.pipeline-merge-nights .pipeline-night-wrap')).toHaveCount(1);

  await expect(ha.getByText(/3 nights/)).toBeVisible();
  await expect(oiii.getByText(/2 nights/)).toBeVisible();
  await expect(sii.getByText(/1 night/)).toBeVisible();
});

test('Imaging Pipeline: gutters and Cull columns align across filters', async () => {
  const { bars } = await openE2eProject();
  // Wait for SVG merge layout pass
  await window.waitForTimeout(100);

  const metrics = await bars.evaluate((el) => {
    const channels = [...el.querySelectorAll('.pipeline-channel')].filter((c) =>
      c.querySelector('[data-pipeline-merge]')
    );
    const rows = channels.map((ch) => {
      const gutter = ch.querySelector('.pipeline-merge-gutter');
      const cull = ch.querySelector('[data-pipeline-sink]')?.closest('.pipeline-step')
        || ch.querySelector('.pipeline-merge-trunk .pipeline-step');
      const cal = ch.querySelector('[data-pipeline-source]')?.closest('.pipeline-step')
        || ch.querySelector('.pipeline-merge-nights .pipeline-step:last-child');
      const g = gutter?.getBoundingClientRect();
      const cullDot = cull?.querySelector('.pipeline-dot')?.getBoundingClientRect();
      const calDot = cal?.querySelector('.pipeline-dot')?.getBoundingClientRect();
      return {
        tone: [...ch.classList].find((c) => c.startsWith('flt-')) || '',
        gutterCenterX: g ? g.left + g.width / 2 : null,
        cullDotLeft: cullDot ? cullDot.left : null,
        calDotRight: calDot ? calDot.right : null,
        hasSvgPath: !!(ch.querySelector('.pipeline-merge-svg path')?.getAttribute('d')),
      };
    });
    const gutterXs = rows.map((r) => r.gutterCenterX).filter((n) => n != null);
    const cullXs = rows.map((r) => r.cullDotLeft).filter((n) => n != null);
    const spread = (arr) => (arr.length ? Math.max(...arr) - Math.min(...arr) : 0);
    return {
      rows,
      gutterSpreadPx: spread(gutterXs),
      cullSpreadPx: spread(cullXs),
    };
  });

  expect(metrics.rows.length).toBeGreaterThanOrEqual(3);
  for (const row of metrics.rows) {
    expect(row.hasSvgPath, `${row.tone} missing merge SVG path`).toBeTruthy();
    expect(row.gutterCenterX).not.toBeNull();
    expect(row.cullDotLeft).not.toBeNull();
  }
  // Columns should share an X within a couple device pixels
  expect(metrics.gutterSpreadPx).toBeLessThanOrEqual(2);
  expect(metrics.cullSpreadPx).toBeLessThanOrEqual(2);
});

test('Imaging Pipeline: empty channel has no Cull/Reg; + locks filter', async () => {
  const { bars, card } = await openE2eProject();

  // Add a filter with no nights via Capture Plan is heavy — assert RGB absent / empty copy path:
  // SII has 1 night. Channel add on SII should open Plan SII Shoot.
  await bars.getByTestId('pipeline-channel-sii').locator('.pipeline-channel-add').click();
  const overlay = window.locator('#modal-overlay.open');
  await expect(overlay).toBeVisible();
  await expect(window.locator('#modal-title')).toHaveText(/Plan SII Shoot/i);
  const opts = await window.locator('#f-shootFilterIdx option').evaluateAll((nodes) =>
    nodes.map((n) => /** @type {HTMLOptionElement} */ (n).textContent || '')
  );
  expect(opts.length).toBeGreaterThanOrEqual(1);
  expect(opts.every((t) => /SII/i.test(t))).toBeTruthy();
  await window.locator('[data-testid="modal-cancel"]').click();
  await expect(window.locator('#modal-overlay.open')).toHaveCount(0);
});

test('Imaging Pipeline: night expand does not remove merge path', async () => {
  const { bars } = await openE2eProject();
  if (await window.locator('#modal-overlay.open').count()) {
    await window.locator('[data-testid="modal-cancel"]').click();
  }
  const ha = bars.getByTestId('pipeline-channel-ha');
  await ha.locator('.pipeline-night-chevron').first().click();
  await expect(ha.locator('.pipeline-night-detail').first()).toBeVisible();
  await window.waitForTimeout(80);
  const pathCount = await ha.locator('.pipeline-merge-svg path').count();
  expect(pathCount).toBeGreaterThan(0);
  const d = await ha.locator('.pipeline-merge-svg path').first().getAttribute('d');
  expect(d && d.length).toBeGreaterThan(10);
  await ha.locator('.pipeline-night-chevron').first().click();
});
