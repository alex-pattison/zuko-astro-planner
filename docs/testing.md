# Testing strategy

Honest baseline: prior QA covered **Node unit/integration** for ASIAIR ingest and RA/Dec target-match helpers. It did **not** click every button in the Electron UI.

This repo follows the Electron testing pyramid ([Electron automated testing](https://www.electronjs.org/docs/latest/tutorial/automated-testing), industry guidance: many fast unit tests, fewer IPC/integration tests, a thin E2E cap of critical flows).

## Layers

| Layer | What | How | When |
|-------|------|-----|------|
| Unit / integration | Pure ingest logic, bands, ignore scopes, shoot-log helpers | `npm run test:unit` → `scripts/qa-*.js` | Every change to `src/ingest/**` |
| E2E (Playwright Electron) | Real window + IPC + renderer for P0 journeys | `npm run test:e2e` | Before release / after UI wiring changes |
| Manual P2+ | Low-risk or dialog-heavy controls | Checklist below | Spot-check release |

**Do not** try to E2E every one of ~75 `<button>`s. Prefer `data-testid` on P0 controls and risk-rank the rest.

## Isolation

E2E sets:

- `ZUKO_DATA_DIR` → `staging/e2e-data/` (never H: live dashboard)
- `ZUKO_PROJECTS_DIR` → `staging/e2e-projects/`

Seed with `node scripts/seed-e2e-data.js`. For Review source coverage, also build `staging/asiair-test-target-match/` via `node scripts/build-target-match-fixture.js`.

## P0 journeys (automated)

1. App shell loads (brand, version)
2. Theme toggle
3. New Project modal open/cancel
4. Seeded project card renders
5. Review source opens/closes (when ASIAIR fixture present)

## P1 (unit/integration — already covered)

- Target-match bands, confirm gate, ROTATOR, ignore folder vs row scope
- Stage / invent / dark matching permutations (`qa-asiair-ingest`, `qa-target-match-*`)

## P2 manual smoke (not every release)

Inventory: `node scripts/inventory-ui-controls.js`

Spot-check when touching that area:

- [ ] Location search / Use my location
- [ ] Action items CRUD
- [ ] Assets add/edit/filter/price toggle
- [ ] Framer lock, set center, clear saved target
- [ ] Per-shoot Ingest + restage overwrite dialog
- [ ] Confirm reject panel: exclude / ignore / create shoot / new project / assign
- [ ] AstroBin link add/remove
- [ ] Sync chip / open data folder (Electron)

## Selectors

Prefer `data-testid` over CSS class chains. Re-run inventory after UI changes to see coverage gaps (`with data-testid` count).

## Commands

```bash
npm test              # unit + e2e
npm run test:unit     # Node QA scripts only
npm run test:e2e      # Playwright Electron
npm run test:inventory
```
