/**
 * Pure helpers for ASIAIR target-match project ops (shared by UI + QA).
 * Browser: window.ZukoTargetMatch
 * Node: module.exports
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZukoTargetMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeFilterName(name) {
    if (name == null || name === '') return null;
    const s = String(name).trim();
    const map = {
      h: 'Ha', ha: 'Ha', halpha: 'Ha',
      o: 'OIII', o3: 'OIII', oiii: 'OIII',
      s: 'SII', s2: 'SII', sii: 'SII',
      hb: 'Hb', hbeta: 'Hb',
      l: 'L', lum: 'L', luminance: 'L',
      r: 'R', red: 'R',
      g: 'G', green: 'G',
      b: 'B', blue: 'B',
    };
    const key = s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return map[key] || s;
  }

  function filterWavelengthKey(name) {
    const n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (n === 'ha' || n === 'h' || n === 'halpha') return 'ha';
    if (n === 'oiii' || n === 'o3' || n === 'o') return 'oiii';
    if (n === 'sii' || n === 's2' || n === 's') return 'sii';
    if (n === 'hb' || n === 'hbeta') return 'hb';
    return n;
  }

  function yymmddFromNightYmd(ymd) {
    const s = String(ymd || '');
    if (s.length === 8) return s.slice(2);
    return s;
  }

  function shootNightYmd(sh) {
    let d = String((sh && sh.date) || '').replace(/[^0-9]/g, '');
    if (d.length === 6) d = (parseInt(d.slice(0, 2), 10) >= 70 ? '19' : '20') + d;
    return d.length === 8 ? d : null;
  }

  function hasShootLogForFilterNight(project, filterName, nightYmd) {
    if (!project || !filterName || !nightYmd) return false;
    const want = filterWavelengthKey(filterName);
    return (project.shoots || []).some((sh) => {
      if (shootNightYmd(sh) !== nightYmd) return false;
      const ft = project.filterTargets && project.filterTargets[sh.filterIndex];
      if (!ft || !ft.filter) return false;
      return filterWavelengthKey(ft.filter) === want;
    });
  }

  function recomputeProjectFilterHours(project) {
    if (!project) return;
    for (const ft of project.filterTargets || []) ft.loggedHrs = 0;
    for (const sh of project.shoots || []) {
      if (!sh.complete) continue;
      const ft = project.filterTargets && project.filterTargets[sh.filterIndex];
      if (!ft) continue;
      ft.loggedHrs = Math.round(((Number(ft.loggedHrs) || 0) + (Number(sh.hours) || 0)) * 1000) / 1000;
    }
  }

  function ensureIgnoredAsiairFolders(project) {
    if (!project.ignoredAsiairFolders || !Array.isArray(project.ignoredAsiairFolders)) {
      project.ignoredAsiairFolders = [];
    }
    return project.ignoredAsiairFolders;
  }

  function isWholeFolderIgnoreEntry(x) {
    return x && x.folder && (x.night == null || x.night === '') && (x.filter == null || x.filter === '');
  }

  function isRowIgnoreEntry(x) {
    return x && x.folder && x.night && x.filter;
  }

  /** Whole-folder ignore only (target-confirm “don’t ask again”). */
  function isAsiairFolderIgnored(project, folder) {
    if (!folder) return false;
    return ensureIgnoredAsiairFolders(project).some(
      (x) => isWholeFolderIgnoreEntry(x) && String(x.folder) === String(folder)
    );
  }

  /** Source-review row: ignored if whole folder ignored OR this night+filter+folder. */
  function isAsiairSourceRowIgnored(project, row) {
    if (!project || !row || !row.folder) return false;
    const folder = String(row.folder);
    const night = row.night != null ? String(row.night) : '';
    const filter = normalizeFilterName(row.filter) || '';
    return ensureIgnoredAsiairFolders(project).some((x) => {
      if (!x || String(x.folder) !== folder) return false;
      if (isWholeFolderIgnoreEntry(x)) return true;
      if (!isRowIgnoreEntry(x)) return false;
      return String(x.night) === night && normalizeFilterName(x.filter) === filter;
    });
  }

  /** Whole-folder ignore (confirm flow). Does not remove existing row-level ignores. */
  function ignoreAsiairFolder(project, folderRow, note) {
    const list = ensureIgnoredAsiairFolders(project);
    const folder = folderRow && folderRow.folder;
    if (!folder) return;
    if (list.some((x) => isWholeFolderIgnoreEntry(x) && x.folder === folder)) return;
    list.push({
      folder,
      name: (folderRow && folderRow.name) || folder,
      night: null,
      filter: null,
      medianRa: folderRow && folderRow.medianRa,
      medianDec: folderRow && folderRow.medianDec,
      ignoredAt: new Date().toISOString(),
      note: note || null,
    });
  }

  /** Source-review: ignore one date+filter+folder group only. */
  function ignoreAsiairSourceRow(project, row, note) {
    const list = ensureIgnoredAsiairFolders(project);
    const folder = row && row.folder;
    const night = row && row.night != null ? String(row.night) : null;
    const filter = row && normalizeFilterName(row.filter);
    if (!folder || !night || !filter) return;
    if (isAsiairSourceRowIgnored(project, { folder, night, filter })) return;
    list.push({
      folder,
      name: (row && row.name) || folder,
      night,
      filter,
      ignoredAt: new Date().toISOString(),
      note: note || null,
    });
  }

  /**
   * Unignore a source-review row.
   * If ignored via whole-folder entry, removes that whole-folder ignore.
   * Otherwise removes the matching night+filter row entry.
   */
  function unignoreAsiairSourceRow(project, row) {
    const list = ensureIgnoredAsiairFolders(project);
    const folder = row && row.folder;
    if (!folder) return;
    const night = row && row.night != null ? String(row.night) : null;
    const filter = row && normalizeFilterName(row.filter);
    const wholeIdx = list.findIndex((x) => isWholeFolderIgnoreEntry(x) && x.folder === folder);
    if (wholeIdx >= 0) {
      list.splice(wholeIdx, 1);
      return;
    }
    const rowIdx = list.findIndex(
      (x) => isRowIgnoreEntry(x)
        && x.folder === folder
        && String(x.night) === String(night)
        && normalizeFilterName(x.filter) === filter
    );
    if (rowIdx >= 0) list.splice(rowIdx, 1);
  }

  function ensureBoundAsiairFolders(project) {
    if (!project.asiairBoundFolders || !Array.isArray(project.asiairBoundFolders)) {
      project.asiairBoundFolders = [];
    }
    return project.asiairBoundFolders;
  }

  function bindAsiairFolder(project, folder) {
    if (!folder) return;
    const list = ensureBoundAsiairFolders(project);
    if (!list.includes(folder)) list.push(folder);
  }

  function isAsiairFolderBound(project, folder) {
    if (!folder || !project) return false;
    return ensureBoundAsiairFolders(project).includes(folder);
  }

  /** Filters present in a light list (normalized unique). */
  function filtersFromLights(lights) {
    const set = new Set();
    for (const L of lights || []) {
      const f = normalizeFilterName(L.filter);
      if (f) set.add(f);
    }
    return [...set];
  }

  /**
   * Create Captured shoot log rows from lights (grouped by night + filter).
   * Only adds filterTargets for filters that appear in lights when addMissingFilters.
   */
  function createShootLogsFromLights(project, lights, opts = {}) {
    const created = [];
    const skipped = [];
    const byKey = new Map();
    for (const L of lights || []) {
      const night = L.night || (L.date ? String(L.date) : null);
      const filter = normalizeFilterName(L.filter) || 'Unknown';
      if (!night) continue;
      const key = `${night}|${filter}`;
      if (!byKey.has(key)) byKey.set(key, { night, filter, lights: [] });
      byKey.get(key).lights.push(L);
    }
    for (const group of byKey.values()) {
      let filterIndex = (project.filterTargets || []).findIndex(
        (ft) => normalizeFilterName(ft.filter) === group.filter
      );
      if (filterIndex < 0) {
        if (opts.addMissingFilters) {
          project.filterTargets = project.filterTargets || [];
          project.filterTargets.push({
            filter: group.filter,
            location: '—',
            bortle: '',
            targetHrs: 0,
            loggedHrs: 0,
          });
          filterIndex = project.filterTargets.length - 1;
        } else {
          skipped.push(`${group.filter} ${group.night} (filter not in project)`);
          continue;
        }
      }
      if (hasShootLogForFilterNight(project, group.filter, group.night)) {
        skipped.push(`${group.filter} ${group.night} (already in log)`);
        continue;
      }
      const exp = group.lights[0] && group.lights[0].exposureSec;
      const hrs = exp != null
        ? Math.round(((group.lights.length * Number(exp)) / 3600) * 1000) / 1000
        : 0;
      project.shoots = project.shoots || [];
      project.shoots.push({
        date: yymmddFromNightYmd(group.night),
        filterIndex,
        hours: hrs,
        complete: true,
        creditedHours: hrs,
        sourcePath: null,
        ingestPath: null,
        ingestMeta: null,
        fromAsiairFolder: opts.folder || null,
      });
      created.push({ filter: group.filter, night: group.night, hours: hrs, lights: group.lights.length });
    }
    if (created.length) recomputeProjectFilterHours(project);
    return { created, skipped };
  }

  /**
   * Build a new project from an ASIAIR Light/<folder> pointing.
   * - filterTargets only from lights present (not parent presets)
   * - savedTarget + framerRotation from folder medians / ROTATOR
   * - asiairBoundFolders so shared dumps don't re-prompt confirm
   */
  function buildNewProjectFromFolder(sourceProject, folderRow, lights, opts = {}) {
    const name = (folderRow && (folderRow.name || folderRow.folder)) || 'ASIAIR target';
    const folder = folderRow && folderRow.folder;
    const folderLights = (lights || []).filter(
      (L) => (L.targetFolder || L.target) === folder
    );
    const filters = filtersFromLights(folderLights);
    const neu = {
      name,
      target: name,
      frameMode: (sourceProject && sourceProject.frameMode) || '',
      projectDir: (sourceProject && sourceProject.projectDir) || '',
      centerCoords: folderRow && folderRow.medianRa != null
        ? `RA ${Number(folderRow.medianRa).toFixed(4)}°  Dec ${Number(folderRow.medianDec).toFixed(4)}°`
        : '',
      anchorStar: '',
      rotation: folderRow && folderRow.medianRotatorDeg != null
        ? `${Math.round(Number(folderRow.medianRotatorDeg))}° (from ASIAIR ROTATOR)`
        : '',
      status: 'active',
      notes: opts.notes || `Created from ASIAIR folder “${folder}”.`,
      filterTargets: filters.map((f) => ({
        filter: f,
        location: '—',
        bortle: '',
        targetHrs: 0,
        loggedHrs: 0,
      })),
      checklist: [],
      shoots: [],
      astrobinLinks: [],
      savedTarget: (folderRow && folderRow.medianRa != null && folderRow.medianDec != null)
        ? { name, ra: Number(folderRow.medianRa), dec: Number(folderRow.medianDec) }
        : null,
      framerMode: (sourceProject && sourceProject.framerMode) || 'reducer',
      framerRotation: folderRow && folderRow.medianRotatorDeg != null
        ? Math.round(Number(folderRow.medianRotatorDeg))
        : ((sourceProject && sourceProject.framerRotation) || 0),
      ignoredAsiairFolders: [],
      asiairBoundFolders: folder ? [folder] : [],
    };
    createShootLogsFromLights(neu, folderLights, {
      folder,
      addMissingFilters: true,
    });
    return neu;
  }

  /**
   * Assign folder lights to an existing project; bind folder so confirm is skipped later.
   */
  function assignFolderToProject(dest, folderRow, lights, opts = {}) {
    const folder = folderRow && folderRow.folder;
    const folderLights = (lights || []).filter(
      (L) => (L.targetFolder || L.target) === folder
    );
    if (!dest.savedTarget && folderRow && folderRow.medianRa != null) {
      dest.savedTarget = {
        name: (folderRow.name || folderRow.folder),
        ra: Number(folderRow.medianRa),
        dec: Number(folderRow.medianDec),
      };
    }
    if (folderRow && folderRow.medianRotatorDeg != null && (dest.framerRotation == null || dest.framerRotation === 0)) {
      dest.framerRotation = Math.round(Number(folderRow.medianRotatorDeg));
    }
    if (opts.projectDir && !dest.projectDir) dest.projectDir = opts.projectDir;
    bindAsiairFolder(dest, folder);
    ensureIgnoredAsiairFolders(dest);
    dest.ignoredAsiairFolders = dest.ignoredAsiairFolders.filter((x) => x.folder !== folder);
    return createShootLogsFromLights(dest, folderLights, {
      folder,
      addMissingFilters: true,
    });
  }

  /**
   * Resolve includes when project has asiairBoundFolders — skip confirm for sibling dump folders.
   */
  function resolveBoundIncludes(project, targets) {
    const bound = ensureBoundAsiairFolders(project);
    if (!bound.length) return null;
    const set = new Set(bound);
    const includes = (targets || []).filter((t) => set.has(t.folder)).map((t) => t.folder);
    if (!includes.length) return { includes: [], reason: 'bound_missing' };
    return { includes, reason: 'bound_folder' };
  }

  /** Actual ≥ target → green (ok). Under → yellow. */
  function integrationTone(actualHrs, plannedHrs) {
    const planned = Number(plannedHrs) || 0;
    if (!planned || actualHrs == null || !Number.isFinite(Number(actualHrs))) return 'na';
    const actual = Number(actualHrs);
    const tol = Math.max(0.05, planned * 0.05);
    if (actual + tol >= planned) return 'ok'; // at or over target = green
    return 'under';
  }

  return {
    normalizeFilterName,
    filterWavelengthKey,
    yymmddFromNightYmd,
    shootNightYmd,
    hasShootLogForFilterNight,
    recomputeProjectFilterHours,
    ensureIgnoredAsiairFolders,
    isAsiairFolderIgnored,
    isAsiairSourceRowIgnored,
    ignoreAsiairFolder,
    ignoreAsiairSourceRow,
    unignoreAsiairSourceRow,
    ensureBoundAsiairFolders,
    bindAsiairFolder,
    isAsiairFolderBound,
    filtersFromLights,
    createShootLogsFromLights,
    buildNewProjectFromFolder,
    assignFolderToProject,
    resolveBoundIncludes,
    integrationTone,
  };
});
