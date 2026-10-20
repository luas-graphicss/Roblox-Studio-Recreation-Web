import { SHADOW_PAGE_TILE_SIZE, buildShadowPageGrid, pageKeysForUvRect } from "./llShadowPageGridCore.js";
import { FULL_MAP_UV_RECT, buildShadowPageOwners, projectWorldBoxToUvRect } from "./llShadowPageProjectionCore.js";

export const SHADOW_CACHE_PHASE_ID = "LL-F13";
export const STATIC_AFTER_CLEAN_PULSES = 2;
export const UNLIMITED_PAGE_RENDERS = 0;

export const DIRTY_REASON = Object.freeze({
  NEW_PAGE: "new-page",
  LIGHT_CONFIG: "light-config",
  CASTER: "caster",
  HEAL: "heal",
});

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function quantizedForKey(value) {
  return (Math.round(numberOr(value, 0) * 10000) / 10000).toFixed(4);
}


export function lightConfigKeyFor(light) {
  const source = light || {};
  const position = source.position || [0, 0, 0];
  const direction = source.direction || [0, -1, 0];
  return [
    String(source.kind === "spot" ? "spot" : "point"),
    quantizedForKey(position[0]), quantizedForKey(position[1]), quantizedForKey(position[2]),
    quantizedForKey(direction[0]), quantizedForKey(direction[1]), quantizedForKey(direction[2]),
    quantizedForKey(source.outerHalfAngleRad),
    quantizedForKey(source.range),
    quantizedForKey(source.near),
    String(Math.floor(numberOr(source.mapSize, 0))),
    source.castShadow === false ? "noshadow" : "shadow",
  ].join("|");
}

export function createLocalShadowCache(options) {
  const settings = options || {};
  const tileSize = Math.max(1, Math.floor(numberOr(settings.tileSize, SHADOW_PAGE_TILE_SIZE)));
  const staticAfterCleanPulses = Math.max(1, Math.floor(numberOr(settings.staticAfterCleanPulses, STATIC_AFTER_CLEAN_PULSES)));
  const defaultMaxPageRenders = Math.max(0, Math.floor(numberOr(settings.maxPageRendersPerPulse, UNLIMITED_PAGE_RENDERS)));

  const lightsByKey = new Map();
  const pagesByKey = new Map();
  const totals = {
    pulses: 0,
    plannedPageRenders: 0,
    pageBaseline: 0,
    deferredPages: 0,
    pagesRefreshedByLightMap: 0,
    benchLightRenders: 0,
    lightBaseline: 0,
    heals: 0,
  };
  let pulseCount = 0;
  let rotationCursor = 0;
  let lastPlan = null;

  function createPageState(page) {
    return {
      pageKey: page.pageKey,
      lightKey: page.lightKey,
      faceIndex: page.faceIndex,
      pageIndex: page.pageIndex,
      uvRect: page.uvRect,
      dirty: true,
      dirtyReason: DIRTY_REASON.NEW_PAGE,
      everRendered: false,
      renderCount: 0,
      lastRenderPulse: -1,
      lastDirtyPulse: pulseCount,
      cleanPulses: 0,
      isStatic: false,
    };
  }

  function dropLight(lightKey) {
    const entry = lightsByKey.get(lightKey);
    if (!entry) return;
    entry.pageKeys.forEach((pageKey) => pagesByKey.delete(pageKey));
    lightsByKey.delete(lightKey);
  }

  function rebuildLight(lightKey, descriptor, configKey) {
    dropLight(lightKey);
    const owners = buildShadowPageOwners(Object.assign({}, descriptor, { key: lightKey }));
    const gridsByFace = owners.map((owner) =>
      buildShadowPageGrid({ lightKey: lightKey, faceIndex: owner.faceIndex, mapSize: descriptor.mapSize, tileSize: tileSize }),
    );
    const pageKeys = [];
    gridsByFace.forEach((grid) => {
      grid.pages.forEach((page) => {
        pagesByKey.set(page.pageKey, createPageState(page));
        pageKeys.push(page.pageKey);
      });
    });
    lightsByKey.set(lightKey, {
      descriptor: descriptor,
      configKey: configKey,
      owners: owners,
      gridsByFace: gridsByFace,
      pageKeys: pageKeys,
    });
  }

  function syncLights(lightDescriptors) {
    const list = Array.isArray(lightDescriptors) ? lightDescriptors : [];
    const seenKeys = new Set();
    const rebuiltLights = [];
    list.forEach((descriptor) => {
      if (!descriptor || descriptor.key === undefined) return;
      const lightKey = String(descriptor.key);
      seenKeys.add(lightKey);
      const configKey = lightConfigKeyFor(descriptor);
      const known = lightsByKey.get(lightKey);
      if (!known || known.configKey !== configKey) {
        rebuildLight(lightKey, descriptor, configKey);
        rebuiltLights.push(lightKey);
        return;
      }
      known.descriptor = descriptor;
    });
    const removedLights = [];
    lightsByKey.forEach((entry, lightKey) => {
      if (!seenKeys.has(lightKey)) removedLights.push(lightKey);
    });
    removedLights.forEach(dropLight);
    return {
      lightCount: lightsByKey.size,
      pageCount: pagesByKey.size,
      rebuiltLights: rebuiltLights,
      removedLights: removedLights,
    };
  }

  function markPageDirty(pageKey, reason) {
    const page = pagesByKey.get(pageKey);
    if (!page) return false;
    if (!page.dirty) {
      page.dirty = true;
      page.dirtyReason = reason || DIRTY_REASON.CASTER;
      page.lastDirtyPulse = pulseCount;
      page.cleanPulses = 0;
      page.isStatic = false;
    }
    return true;
  }

  function markPageRendered(pageKey) {
    const page = pagesByKey.get(pageKey);
    if (!page) return false;
    page.dirty = false;
    page.dirtyReason = null;
    page.everRendered = true;
    page.renderCount++;
    page.lastRenderPulse = pulseCount;
    page.cleanPulses = 0;
    page.isStatic = false;
    return true;
  }


  function invalidateAll(reason) {
    pagesByKey.forEach((page) => {
      page.dirty = true;
      page.dirtyReason = reason || DIRTY_REASON.HEAL;
      page.lastDirtyPulse = pulseCount;
      page.cleanPulses = 0;
      page.isStatic = false;
    });
    totals.heals++;
    return pagesByKey.size;
  }

  function pageKeysForWorldBox(worldBox) {
    const touched = [];
    lightsByKey.forEach((entry) => {
      entry.owners.forEach((owner, faceSlot) => {
        const projection = projectWorldBoxToUvRect(owner, worldBox);
        if (!projection.visible) return;
        const uvRect = owner.conservativeFullMap ? FULL_MAP_UV_RECT : projection.uvRect;
        pageKeysForUvRect(entry.gridsByFace[faceSlot], uvRect).forEach((pageKey) => touched.push(pageKey));
      });
    });
    return touched;
  }

  function pagesTouchedByWorldBox(worldBox) {
    return Array.from(new Set(pageKeysForWorldBox(worldBox))).sort();
  }

  function markWorldBoxesDirty(worldBoxes, reason) {
    const list = Array.isArray(worldBoxes) ? worldBoxes : [];
    const dirtied = new Set();
    list.forEach((worldBox) => {
      pageKeysForWorldBox(worldBox).forEach((pageKey) => {
        if (markPageDirty(pageKey, reason)) dirtied.add(pageKey);
      });
    });
    return Array.from(dirtied);
  }

  function dirtyPageKeys() {
    const keys = [];
    pagesByKey.forEach((page, pageKey) => {
      if (page.dirty) keys.push(pageKey);
    });
    return keys;
  }


  function splitByBudget(dirtyKeys, budget) {
    if (!(budget > 0) || budget >= dirtyKeys.length) return { authorized: dirtyKeys.slice(), deferred: [] };
    const start = rotationCursor % dirtyKeys.length;
    const authorized = [];
    for (let offset = 0; budget > offset; offset++) authorized.push(dirtyKeys[(start + offset) % dirtyKeys.length]);
    const authorizedKeys = new Set(authorized);
    rotationCursor = (start + budget) % dirtyKeys.length;
    return { authorized: authorized, deferred: dirtyKeys.filter((pageKey) => !authorizedKeys.has(pageKey)) };
  }

  function perLightSummary(authorizedKeys) {
    const summary = {};
    lightsByKey.forEach((entry, lightKey) => {
      summary[lightKey] = { pages: entry.pageKeys.length, faces: entry.owners.length, renders: 0, dirty: 0 };
    });
    pagesByKey.forEach((page) => {
      const row = summary[page.lightKey];
      if (!row) return;
      if (page.dirty) row.dirty++;
    });
    authorizedKeys.forEach((pageKey) => {
      const page = pagesByKey.get(pageKey);
      if (page && summary[page.lightKey]) summary[page.lightKey].renders++;
    });
    return summary;
  }

  function planPulse(input) {
    const request = input || {};
    pulseCount++;
    totals.pulses++;
    const healed = !!request.invalidateAll;
    if (healed) invalidateAll(request.reason || DIRTY_REASON.HEAL);
    const casterDirtiedPages = markWorldBoxesDirty(request.dirtyBoxes, DIRTY_REASON.CASTER);
    const dirtyKeys = dirtyPageKeys();
    const budget = Math.max(0, Math.floor(numberOr(request.maxPageRenders, defaultMaxPageRenders)));
    const split = splitByBudget(dirtyKeys, budget);
    const authorizedKeys = new Set(split.authorized);
    const lightsToRender = [];
    split.authorized.forEach((pageKey) => {
      const page = pagesByKey.get(pageKey);
      if (page && !(lightsToRender.indexOf(page.lightKey) >= 0)) lightsToRender.push(page.lightKey);
    });
    const summary = perLightSummary(split.authorized);
    split.authorized.forEach(markPageRendered);

    let staticPages = 0;
    let dynamicPages = 0;
    let dirtyPagesLeft = 0;
    pagesByKey.forEach((page) => {
      if (page.dirty) {
        dirtyPagesLeft++;
        return;
      }
      if (!authorizedKeys.has(page.pageKey)) page.cleanPulses++;
      page.isStatic = page.everRendered && page.cleanPulses >= staticAfterCleanPulses;
      if (page.isStatic) staticPages++;
      else dynamicPages++;
    });

    const totalPages = pagesByKey.size;
    const plannedPageRenders = split.authorized.length;
    const savedPages = Math.max(0, totalPages - plannedPageRenders);
    totals.plannedPageRenders += plannedPageRenders;
    totals.pageBaseline += totalPages;
    totals.deferredPages += split.deferred.length;
    totals.lightBaseline += lightsByKey.size;

    lastPlan = {
      pulse: pulseCount,
      healed: healed,
      reason: healed ? String(request.reason || DIRTY_REASON.HEAL) : null,
      lightCount: lightsByKey.size,
      totalPages: totalPages,
      dirtyPageCount: dirtyKeys.length,
      casterDirtiedPages: casterDirtiedPages.length,
      pageRenders: split.authorized,
      deferredPages: split.deferred,
      lightsToRender: lightsToRender,
      staticPages: staticPages,
      dynamicPages: dynamicPages,
      dirtyPagesLeft: dirtyPagesLeft,
      savedPages: savedPages,


      reductionRatio: totalPages > 0 ? savedPages / totalPages : 1,
      perLight: summary,
    };
    return lastPlan;
  }


  function markLightMapRendered(lightKey) {
    const entry = lightsByKey.get(String(lightKey));
    if (!entry) return 0;
    let refreshed = 0;
    entry.pageKeys.forEach((pageKey) => {
      const page = pagesByKey.get(pageKey);
      if (!page || !page.dirty) return;
      markPageRendered(pageKey);
      refreshed++;
    });
    totals.pagesRefreshedByLightMap += refreshed;
    totals.benchLightRenders++;
    return refreshed;
  }

  function stats() {
    let staticPages = 0;
    let dirtyPages = 0;
    pagesByKey.forEach((page) => {
      if (page.isStatic) staticPages++;
      if (page.dirty) dirtyPages++;
    });
    return {
      fase: SHADOW_CACHE_PHASE_ID,
      pulses: totals.pulses,
      lightCount: lightsByKey.size,
      totalPages: pagesByKey.size,
      staticPages: staticPages,
      dirtyPages: dirtyPages,
      plannedPageRenders: totals.plannedPageRenders,
      pageBaseline: totals.pageBaseline,
      pageReductionRatio: totals.pageBaseline > 0 ? 1 - totals.plannedPageRenders / totals.pageBaseline : 0,
      benchLightRenders: totals.benchLightRenders,
      lightBaseline: totals.lightBaseline,
      lightReductionRatio: totals.lightBaseline > 0 ? 1 - totals.benchLightRenders / totals.lightBaseline : 0,
      pagesRefreshedByLightMap: totals.pagesRefreshedByLightMap,
      deferredPages: totals.deferredPages,
      heals: totals.heals,
      tileSize: tileSize,
    };
  }

  function pageReport(limit) {
    const maxRows = Math.max(1, Math.floor(numberOr(limit, 40)));
    const rows = [];
    pagesByKey.forEach((page) => {
      if (rows.length >= maxRows) return;
      rows.push({
        pageKey: page.pageKey,
        lightKey: page.lightKey,
        faceIndex: page.faceIndex,
        pageIndex: page.pageIndex,
        dirty: page.dirty,
        estatica: page.isStatic,
        renders: page.renderCount,
        ultimoRender: page.lastRenderPulse,
      });
    });
    return rows;
  }

  function reset() {
    pagesByKey.clear();
    lightsByKey.clear();
    pulseCount = 0;
    rotationCursor = 0;
    lastPlan = null;
    Object.keys(totals).forEach((field) => {
      totals[field] = 0;
    });
    return true;
  }

  return {
    syncLights: syncLights,
    planPulse: planPulse,
    invalidateAll: invalidateAll,
    markLightMapRendered: markLightMapRendered,
    pagesTouchedByWorldBox: pagesTouchedByWorldBox,
    pageState: (pageKey) => pagesByKey.get(String(pageKey)) || null,
    pageKeysOfLight: (lightKey) => {
      const entry = lightsByKey.get(String(lightKey));
      return entry ? entry.pageKeys.slice() : [];
    },
    lightKeys: () => Array.from(lightsByKey.keys()),
    lastPlan: () => lastPlan,
    pageReport: pageReport,
    stats: stats,
    reset: reset,
  };
}
