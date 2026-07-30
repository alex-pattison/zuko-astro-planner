// @ts-check
const path = require('path');
const { spawnSync } = require('child_process');
const playwright = require('@playwright/test');
const electron = playwright._electron;

const ROOT = path.resolve(__dirname, '..');
const E2E_DATA = path.join(ROOT, 'staging', 'e2e-data');
const E2E_PROJECTS = path.join(ROOT, 'staging', 'e2e-projects');

function seedE2eData() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'seed-e2e-data.js')], {
    cwd: ROOT,
    env: { ...process.env, ZUKO_DATA_DIR: E2E_DATA },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`seed-e2e-data failed: ${r.stderr || r.stdout}`);
  }
}

/**
 * @returns {Promise<{ electronApp: import('@playwright/test').ElectronApplication, window: import('@playwright/test').Page }>}
 */
async function launchApp() {
  seedE2eData();
  const electronApp = await electron.launch({
    cwd: ROOT,
    args: ['.'],
    env: {
      ...process.env,
      ZUKO_DATA_DIR: E2E_DATA,
      ZUKO_PROJECTS_DIR: E2E_PROJECTS,
    },
  });
  const window = await electronApp.firstWindow();
  await window.waitForSelector('#rig-name-el', { timeout: 30_000 });
  return { electronApp, window };
}

module.exports = { launchApp, E2E_DATA, ROOT, electron };
