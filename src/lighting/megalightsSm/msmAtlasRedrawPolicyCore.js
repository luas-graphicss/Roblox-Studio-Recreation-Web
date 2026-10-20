import {
  MSM_PAGE_FINGERPRINT_UNKNOWN,
  isUsableSceneRevision,
} from "./msmAtlasPageFingerprintCore.js";
import { resolveMsmAtlasPerfOptions } from "./msmAtlasPerfOptions.js";
import { createAtlasPageScheduler } from "./msmAtlasScheduleCore.js";

export const MSM_ATLAS_REDRAW_PHASE_ID = "MSM-O1";


export const MSM_ATLAS_REDRAW_SKIP_REASON = Object.freeze({
  NONE: "none",
  CACHE_OFF: "cache-off",
  NO_PAGES: "no-pages",
  UNKNOWN_SCENE_REVISION: "unknown-scene-revision",
});


export const MSM_ATLAS_PAGE_REDRAW_REASON = Object.freeze({
  NONE: "",
  NEVER_DRAWN: "never-drawn",
  CONTENT_CHANGED: "content-changed",
  UNKNOWN_CONTENT: "unknown-content",
  ATLAS_RECREATED: "atlas-recreated",
  AFTER_STAND_DOWN: "after-stand-down",
  WATCHDOG: "watchdog",
});


export const MSM_ATLAS_PAGE_NEVER_DRAWN_FRAME = -1;


export const MSM_ATLAS_REDRAW_MAX_SKIPPED_FRAMES = 60;

function positiveIntegerOr(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  return rounded >= 1 ? rounded : fallback;
}

function normalizedPageId(value) {
  if (value === null || value === undefined) return null;
  const pageId = String(value).trim();
  return pageId.length >= 1 ? pageId : null;
}

function usableFingerprint(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return MSM_PAGE_FINGERPRINT_UNKNOWN;
  const rounded = Math.round(value);
  return rounded === MSM_PAGE_FINGERPRINT_UNKNOWN ? MSM_PAGE_FINGERPRINT_UNKNOWN : rounded;
}


export function createMsmAtlasRedrawPolicy(options) {
  const settings = options && typeof options === "object" ? options : {};
  const resolvedOptions = resolveMsmAtlasPerfOptions(settings.perf);
  const tier = typeof settings.tier === "string" ? settings.tier.trim().toLowerCase() : "";
  const maxSkippedFrames = positiveIntegerOr(
    settings.maxSkippedFrames,
    MSM_ATLAS_REDRAW_MAX_SKIPPED_FRAMES,
  );



  const pageScheduler =
    resolvedOptions.rotatedPageBudget === true
      ? createAtlasPageScheduler({
          tier: tier,
          coverageDeadlineFrames: settings.coverageDeadlineFrames,
        })
      : null;

  const recordsByPageId = new Map();
  const registrationOrder = [];


  const dirtyIds = Object.create(null);
  const redrawPolicy = { persistent: false, dirtyIds: dirtyIds };


  const namedPageIds = [];
  const dirtyPageIds = [];
  const schedulerDescriptors = [];
  const seenPageIds = new Set();
  const forgottenPageIds = [];

  const report = {
    phase: MSM_ATLAS_REDRAW_PHASE_ID,
    frame: 0,
    persistent: false,
    skipReason: MSM_ATLAS_REDRAW_SKIP_REASON.CACHE_OFF,
    pageCount: 0,
    dirtyPageCount: 0,
    namedPageCount: 0,
    keptPageCount: 0,
    waitingPageCount: 0,
    healed: false,
    watchdogRedraws: 0,
    forgottenPageCount: 0,
    addedPageCount: 0,
    rotationBudget: pageScheduler === null ? 0 : pageScheduler.pagesPerFrame(),
  };

  const totals = {
    frames: 0,
    activeFrames: 0,
    standDownFrames: 0,
    healFrames: 0,
    namedPages: 0,
    keptPages: 0,
    watchdogRedraws: 0,
    addedPages: 0,
    forgottenPages: 0,
  };

  let frameCount = 0;
  let healRequested = true;
  let healReason = MSM_ATLAS_PAGE_REDRAW_REASON.NEVER_DRAWN;
  let lastAtlasGeneration = null;

  function createPageRecord(pageId, lightId, importance) {
    return {
      pageId: pageId,
      lightId: lightId,
      importance: importance,
      drawnFingerprint: MSM_PAGE_FINGERPRINT_UNKNOWN,
      wantedFingerprint: MSM_PAGE_FINGERPRINT_UNKNOWN,
      lastDrawnFrame: MSM_ATLAS_PAGE_NEVER_DRAWN_FRAME,
      drawCount: 0,
      redrawReason: MSM_ATLAS_PAGE_REDRAW_REASON.NEVER_DRAWN,
      registeredFrame: frameCount,
    };
  }

  function schedulerDescriptorAt(index) {
    while (index >= schedulerDescriptors.length) {
      schedulerDescriptors.push({ pageKey: "", lightId: "", importance: 0 });
    }
    return schedulerDescriptors[index];
  }


  function clearPublishedNames() {
    for (let index = 0; namedPageIds.length > index; index += 1) {
      dirtyIds[namedPageIds[index]] = false;
    }
    namedPageIds.length = 0;
  }

  function requestHeal(reason) {
    healRequested = true;
    healReason = reason;
  }


  function standDown(skipReason) {
    clearPublishedNames();
    redrawPolicy.persistent = false;
    requestHeal(MSM_ATLAS_PAGE_REDRAW_REASON.AFTER_STAND_DOWN);
    totals.standDownFrames += 1;

    report.frame = frameCount;
    report.persistent = false;
    report.skipReason = skipReason;
    report.pageCount = registrationOrder.length;
    report.dirtyPageCount = registrationOrder.length;
    report.namedPageCount = 0;
    report.keptPageCount = 0;
    report.waitingPageCount = 0;
    report.healed = true;
    report.watchdogRedraws = 0;
    report.forgottenPageCount = 0;
    report.addedPageCount = 0;
    return report;
  }


  function syncPages(pageList) {
    let addedPageCount = 0;
    seenPageIds.clear();
    forgottenPageIds.length = 0;

    for (let index = 0; pageList.length > index; index += 1) {
      const source = pageList[index] || {};
      const pageId = normalizedPageId(source.pageId);
      if (pageId === null) continue;
      if (seenPageIds.has(pageId)) continue;
      seenPageIds.add(pageId);

      const lightId = source.lightId === null || source.lightId === undefined
        ? pageId
        : String(source.lightId);
      const importance = Number.isFinite(Number(source.importance)) ? Number(source.importance) : 0;
      const knownRecord = recordsByPageId.get(pageId);
      if (knownRecord) {
        knownRecord.lightId = lightId;
        knownRecord.importance = importance;
        continue;
      }

      recordsByPageId.set(pageId, createPageRecord(pageId, lightId, importance));
      registrationOrder.push(pageId);
      addedPageCount += 1;
      totals.addedPages += 1;
    }

    for (let index = registrationOrder.length - 1; index >= 0; index -= 1) {
      const pageId = registrationOrder[index];
      if (seenPageIds.has(pageId)) continue;
      registrationOrder.splice(index, 1);
      recordsByPageId.delete(pageId);
      forgottenPageIds.push(pageId);
      dirtyIds[pageId] = false;
      totals.forgottenPages += 1;
    }

    return addedPageCount;
  }


  function planFrame(input) {
    const request = input && typeof input === "object" ? input : {};
    frameCount += 1;
    totals.frames += 1;

    if (resolvedOptions.persistentPageCache !== true) {
      return standDown(MSM_ATLAS_REDRAW_SKIP_REASON.CACHE_OFF);
    }

    const pageList = Array.isArray(request.pages) ? request.pages : [];
    if (!(pageList.length >= 1)) {
      return standDown(MSM_ATLAS_REDRAW_SKIP_REASON.NO_PAGES);
    }


    if (!isUsableSceneRevision(request.sceneRevision)) {
      return standDown(MSM_ATLAS_REDRAW_SKIP_REASON.UNKNOWN_SCENE_REVISION);
    }

    const atlasGeneration = request.atlasGeneration === undefined ? null : request.atlasGeneration;
    if (atlasGeneration !== lastAtlasGeneration) {
      lastAtlasGeneration = atlasGeneration;
      requestHeal(MSM_ATLAS_PAGE_REDRAW_REASON.ATLAS_RECREATED);
    }

    const addedPageCount = syncPages(pageList);
    const healedThisFrame = healRequested;
    const healReasonThisFrame = healReason;
    healRequested = false;
    healReason = MSM_ATLAS_PAGE_REDRAW_REASON.NONE;
    if (healedThisFrame) totals.healFrames += 1;

    clearPublishedNames();
    dirtyPageIds.length = 0;
    let watchdogRedraws = 0;

    for (let index = 0; pageList.length > index; index += 1) {
      const source = pageList[index] || {};
      const pageId = normalizedPageId(source.pageId);
      if (pageId === null) continue;
      const record = recordsByPageId.get(pageId);
      if (!record) continue;

      const fingerprint = usableFingerprint(source.fingerprint);
      record.wantedFingerprint = fingerprint;

      let redrawReason = MSM_ATLAS_PAGE_REDRAW_REASON.NONE;
      if (fingerprint === MSM_PAGE_FINGERPRINT_UNKNOWN) {
        redrawReason = MSM_ATLAS_PAGE_REDRAW_REASON.UNKNOWN_CONTENT;
      } else if (record.lastDrawnFrame === MSM_ATLAS_PAGE_NEVER_DRAWN_FRAME) {
        redrawReason = MSM_ATLAS_PAGE_REDRAW_REASON.NEVER_DRAWN;
      } else if (healedThisFrame) {
        redrawReason = healReasonThisFrame;
      } else if (record.drawnFingerprint !== fingerprint) {
        redrawReason = MSM_ATLAS_PAGE_REDRAW_REASON.CONTENT_CHANGED;
      } else if (frameCount - record.lastDrawnFrame >= maxSkippedFrames) {
        redrawReason = MSM_ATLAS_PAGE_REDRAW_REASON.WATCHDOG;
        watchdogRedraws += 1;
      }

      record.redrawReason = redrawReason;
      if (redrawReason !== MSM_ATLAS_PAGE_REDRAW_REASON.NONE) dirtyPageIds.push(pageId);
    }

    const dirtyPageCount = dirtyPageIds.length;
    let waitingPageCount = 0;

    if (pageScheduler === null) {


      for (let index = 0; dirtyPageIds.length > index; index += 1) {
        namedPageIds.push(dirtyPageIds[index]);
      }
    } else {


      for (let index = 0; registrationOrder.length > index; index += 1) {
        const record = recordsByPageId.get(registrationOrder[index]);
        const descriptor = schedulerDescriptorAt(index);
        descriptor.pageKey = record.pageId;
        descriptor.lightId = record.lightId;
        descriptor.importance = record.importance;
      }
      schedulerDescriptors.length = registrationOrder.length;
      pageScheduler.syncPages(schedulerDescriptors);
      pageScheduler.invalidatePages(dirtyPageIds);

      const plan = pageScheduler.planFrame({ frozen: request.frozen === true });
      for (let index = 0; plan.pageKeys.length > index; index += 1) {
        const pageId = plan.pageKeys[index];

        if (dirtyPageIds.indexOf(pageId) >= 0) namedPageIds.push(pageId);
      }
      waitingPageCount = dirtyPageCount - namedPageIds.length;


    }

    for (let index = 0; namedPageIds.length > index; index += 1) {
      const pageId = namedPageIds[index];
      const record = recordsByPageId.get(pageId);
      dirtyIds[pageId] = true;
      if (!record) continue;
      record.drawnFingerprint = record.wantedFingerprint;
      record.lastDrawnFrame = frameCount;
      record.drawCount += 1;
    }

    redrawPolicy.persistent = true;
    totals.activeFrames += 1;
    totals.namedPages += namedPageIds.length;
    totals.keptPages += registrationOrder.length - namedPageIds.length;
    totals.watchdogRedraws += watchdogRedraws;

    report.frame = frameCount;
    report.persistent = true;
    report.skipReason = MSM_ATLAS_REDRAW_SKIP_REASON.NONE;
    report.pageCount = registrationOrder.length;
    report.dirtyPageCount = dirtyPageCount;
    report.namedPageCount = namedPageIds.length;
    report.keptPageCount = registrationOrder.length - namedPageIds.length;
    report.waitingPageCount = waitingPageCount >= 1 ? waitingPageCount : 0;
    report.healed = healedThisFrame;
    report.watchdogRedraws = watchdogRedraws;
    report.forgottenPageCount = forgottenPageIds.length;
    report.addedPageCount = addedPageCount;
    report.rotationBudget = pageScheduler === null ? 0 : pageScheduler.pagesPerFrame();
    return report;
  }


  function pages() {
    return registrationOrder.map((pageId) => {
      const record = recordsByPageId.get(pageId);
      return {
        pageId: record.pageId,
        lightId: record.lightId,
        importance: record.importance,
        drawCount: record.drawCount,
        lastDrawnFrame: record.lastDrawnFrame,
        redrawReason: record.redrawReason,
      };
    });
  }

  return {
    phaseId: MSM_ATLAS_REDRAW_PHASE_ID,
    options: resolvedOptions,
    tier: tier,

    textureUnits: 0,

    planFrame: planFrame,


    policy() {
      return redrawPolicy;
    },

    isPersistent() {
      return redrawPolicy.persistent === true;
    },


    invalidateEveryPage(reason) {
      requestHeal(typeof reason === "string" && reason.length >= 1 ? reason : MSM_ATLAS_PAGE_REDRAW_REASON.AFTER_STAND_DOWN);
      return true;
    },

    lastReport() {
      return report;
    },

    pages: pages,


    coverageReport() {
      return pageScheduler === null ? null : pageScheduler.coverageReport();
    },

    stats() {
      return {
        phase: MSM_ATLAS_REDRAW_PHASE_ID,
        tier: tier,
        options: resolvedOptions,
        maxSkippedFrames: maxSkippedFrames,
        frames: totals.frames,
        activeFrames: totals.activeFrames,
        standDownFrames: totals.standDownFrames,
        healFrames: totals.healFrames,
        namedPages: totals.namedPages,
        keptPages: totals.keptPages,
        watchdogRedraws: totals.watchdogRedraws,
        addedPages: totals.addedPages,
        forgottenPages: totals.forgottenPages,
        pageCount: registrationOrder.length,
        persistent: redrawPolicy.persistent,
        scheduler: pageScheduler === null ? null : pageScheduler.stats(),
      };
    },
  };
}
