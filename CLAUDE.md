# ZAP

Alex's desktop astrophotography planner (Electron). **Zuko** is the mono rig; **ZAP** is this app. Never call the rig ZAP.

From 6 Nov 2026, Claude Code owns ZAP code and Claude (cloud) owns ZAP planning. Cursor handed both over and is not used any more. Sign your changes *(Claude Code, date)*.

## Read first

1. `H:\Astro Pigeon\agent\SESSION.md`, then `DECISIONS.md`, then `MAP.md`. These are the shared rules for every agent.
2. `H:\Astro Pigeon\agent\handoff\cursor-final.md`: ZAP state, git, open work and next steps as of 6 Nov 2026.
3. `docs/backlog.md` (the only backlog) and `docs/working-notes.md` (dated build log, newest first).

## Rules for this repo

Until 6 Nov 2026 these lived in `.cursor/rules/`. This file is now the canonical copy. The `.mdc` files are kept only because older log entries point at them.

**No Beta without an express ask in that turn.** Without one, do not:
- run `npm run dist:win:beta` or `npm run dist:win:beta:build-only`;
- silent-install or overwrite the installed Beta app;
- `git push` to `beta-release` or run any other Beta promote flow;
- edit live Beta data in `H:\Astrophotography\Dashboard`, unless Alex asked you to fix or restore Beta data.

If Alex asked you to edit the Beta dashboard JSON:
- Copy the current file into `Dashboard\backups\` first.
- Never write `projects: []` over a non-empty file.
- Prefer rebuilding pipeline status from the Siril trees on disk over inventing shoot rows.
- Close ZAP Beta before writing, or the open window saves its own copy over yours.

"Save" or "commit" means commit only; don't also build or install Beta. "Build beta", "ship beta" or "dist beta" is permission for that one ship. Allowed without a Beta ask: Dev work (`npm start`, this repo's `data/`), and commits on `main` when Alex asked to commit.

**Don't kill or relaunch Electron** (Dev or ZAP Beta) unless Alex asks. After a change to `main.js`, `preload.js`, IPC, ingest or Siril code, or the UI, tell him to restart Dev himself (or reload the window if that is enough). Never chain a kill and relaunch while he is testing. A Dev window opened before a data change can save its old copy back over `data/zuko-dashboard-data.json`.

**On every ship** (a `zukoBuild` or `version` bump, a merge or push to `main` or `beta-release`, or `npm run dist:win:beta`):
1. Mark the shipped items in `docs/backlog.md`, and keep its "Current" and "Next headline" lines up to date.
2. Add a log entry at the top of `docs/working-notes.md`.

The Cursor backlog canvas was retired on 6 Nov 2026, so there is nothing else to update.

**Standing decisions** go in `H:\Astro Pigeon\agent\DECISIONS.md` (format in `SESSION.md`). A ZAP-only rule also goes in this file. Don't start a second decisions log.

## Data pools

Dev and Beta never share data.

| Channel | App data | Imaging files |
|---|---|---|
| Dev (`npm start`) | `data/zuko-dashboard-data.json` in this repo | `F:\Astrophotography Dev\zuko_dev\` (`Projects\`, `Dark Library\`) |
| Beta (installed ZAP Beta) | `H:\Astrophotography\Dashboard\` | `H:\Astrophotography\Zuko\` |

`F:\zuko_dev` no longer exists; the app, scripts, README and Dev data were repointed to `F:\Astrophotography Dev\zuko_dev` on 6 Nov 2026 *(Claude Code, 6 Nov 2026)*. Dev and QA must never fall back to a Beta path on `H:`. `F:\GitHub\zuko-astro-planner` is retired; this checkout is the only one to run. Never read `.env` or `Dashboard\.env` into chat.

## Commands

- `npm start`: run Dev.
- `npm run test:unit`: unit QA (`scripts/run-unit-qa.js`). `npm run test:e2e`: Playwright Electron E2E, which uses `ZUKO_DATA_DIR` and never the live data. `npm test` runs both.
- `npm run dist:win:beta`: build the NSIS installer and silent-install Beta. Only on an express ask.

## Ship flow (only when Alex asks to ship)

1. Bump `zukoBuild` in `package.json`, and `version` if the line changes.
2. Run the unit QA that covers the change.
3. Update `docs/backlog.md` and `docs/working-notes.md`.
4. Commit on `main` with one plain sentence, for example `Ship ESA sky-chart fallback and Winsorized stacking from 10 frames as build 42.` Merge `main` into `beta-release` and push both to `origin`.
5. Close ZAP Beta, run `npm run dist:win:beta`, and check that the header shows the new build.

## Git

- `origin` is `https://github.com/alex-pattison/zuko-astro-planner.git`. `main` is the trunk; `beta-release` is the branch Beta is built from.
- Never commit `.env`, `data/_cache_recover/` or the `data/zuko-dashboard-data.pre-*.json` safety copies. All are git-ignored and stay on disk.
- Don't pop `stash@{0}` ("dev-json-before-veil-flatten", Aug 2026).
- Older Cursor canvases and plans are archived, read-only, in `docs/archive/cursor/`.
