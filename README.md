# Zuko Astro Planner

Desktop astrophotography planner and rig dashboard for Alex's imaging setup.

Baseline UI comes from the existing standalone HTML/Electron dashboard (`rig-dashboard-v6` lineage). This repo is a new project — not a fork.

## Setup

1. Install [Node.js LTS](https://nodejs.org) if needed.
2. From this folder:
   ```
   npm install
   ```

## Run

```
npm start
```

`Ctrl+Shift+I` opens DevTools. `Ctrl+R` reloads.

## Migrate browser localStorage (one-time)

If you still have data in a browser tab of the old dashboard:

1. In the browser console:
   ```js
   copy(JSON.stringify({
     main: localStorage.getItem('astro-rig-v6'),
     hideprices: localStorage.getItem('astro-rig-hideprices'),
     checklist: localStorage.getItem('astro-rig-checklist')
   }))
   ```
2. In the app DevTools console:
   ```js
   const d = /* paste clipboard JSON here */;
   localStorage.setItem('astro-rig-v6', d.main);
   localStorage.setItem('astro-rig-hideprices', d.hideprices);
   localStorage.setItem('astro-rig-checklist', d.checklist);
   location.reload();
   ```

## Build installer (optional)

```
npm run dist:win
```

Output lands in `dist/`.

## Reference material

Upstream clones for later inspiration live under `reference/` (gitignored — not committed to this repo):

- [SiriLic](https://gitlab.com/free-astro/sirilic) — Siril Interactive Companion (GPL-3.0). Local path: `reference/sirilic`
- [Siril](https://github.com/gnthibault/siril) — image processing app Zuko will build/execute plans against. Local path: `reference/siril`
