// @ts-check
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

test.describe.configure({ mode: 'serial' });

/** @type {import('@playwright/test').ElectronApplication} */
let electronApp;
/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  ({ electronApp, window } = await launchApp());
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
});

test('app shell loads with brand and version', async () => {
  await expect(window.locator('#rig-name-el')).toContainText(/Zuko/i);
  await expect(window.locator('#header-version')).not.toHaveText('v—');
  await expect(window.getByTestId('new-project')).toBeVisible();
});

test('theme toggles apply html data-theme', async () => {
  await window.getByTestId('theme-light').click();
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
  await window.getByTestId('theme-red').click();
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'red');
  await window.getByTestId('theme-dark').click();
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('New Project modal opens and cancels', async () => {
  await window.getByTestId('new-project').click();
  await expect(window.locator('#modal-overlay.open')).toBeVisible();
  await expect(window.locator('#modal-title')).toContainText(/project/i);
  await window.getByTestId('modal-cancel').click();
  await expect(window.locator('#modal-overlay.open')).toHaveCount(0);
});

test('seeded E2E project card is visible', async () => {
  const card = window.locator('[data-testid="project-card"][data-project-name="[E2E] Target Match Smoke"]');
  await expect(card).toBeVisible();
});

test('Review source opens overlay when projectDir is set', async () => {
  const card = window.locator('[data-testid="project-card"][data-project-name="[E2E] Target Match Smoke"]');
  if (!(await card.evaluate((el) => el.classList.contains('open')))) {
    await card.getByTestId('project-expand').click();
    await expect(card).toHaveClass(/open/);
  }
  const review = card.getByTestId('review-source');
  await expect(review).toBeVisible();
  const disabled = await review.isDisabled();
  test.skip(disabled, 'ASIAIR fixture missing — run node scripts/build-target-match-fixture.js');
  await review.click();
  await expect(window.locator('#source-review-overlay.open')).toBeVisible({ timeout: 60_000 });
  await expect(window.locator('#source-review-body tr')).not.toHaveCount(0);
  await window.getByTestId('source-review-close').click();
  await expect(window.locator('#source-review-overlay.open')).toHaveCount(0);
});

test('project sections use Capture Plan / Shoot Log / Preprocessing Pipeline labels', async () => {
  const card = window.locator('[data-testid="project-card"]').first();
  await expect(card).toBeVisible();
  if (!(await card.evaluate((el) => el.classList.contains('open')))) {
    await card.getByTestId('project-expand').click();
    await expect(card).toHaveClass(/open/);
  }
  await expect(card.getByText('Capture Plan', { exact: true }).first()).toBeVisible();
  await expect(card.getByText(/^Shoot Log/).first()).toBeVisible();
  await expect(card.locator('.pm-label', { hasText: 'Filter Targets' })).toHaveCount(0);
  await expect(card.locator('.pm-label', { hasText: '🌌' })).toHaveCount(0);
  const pipeline = card.getByTestId('pipeline-bars');
  if (await pipeline.count()) {
    await expect(card.getByText('Preprocessing Pipeline', { exact: true })).toBeVisible();
    await expect(pipeline.locator('.pipeline-filter-row').first()).toBeVisible();
  }
});

test('shoot log table fits without horizontal scroll', async () => {
  const card = window.locator('[data-testid="project-card"][data-project-name="[E2E] Target Match Smoke"]');
  if (!(await card.evaluate((el) => el.classList.contains('open')))) {
    await card.getByTestId('project-expand').click();
  }
  const table = card.locator('table.shoot-log-table');
  if (!(await table.count())) {
    await card.locator('.shoot-log-toggle').click();
  }
  await expect(table).toBeVisible();
  const metrics = await table.evaluate((el) => {
    const wrap = el.closest('.table-scroll');
    return {
      clientWidth: wrap ? wrap.clientWidth : el.clientWidth,
      scrollWidth: wrap ? wrap.scrollWidth : el.scrollWidth,
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
});
