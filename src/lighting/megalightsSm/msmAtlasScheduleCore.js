import { MSM_ATLAS_PAGE_ACTION } from "./msmGridDirtyCore.js";
import { getMsmTierPolicy } from "./msmTierPolicy.js";

export const MSM_ATLAS_SCHEDULE_PHASE_ID = "MSM-F17";


export const MSM_PAGE_ORDER_KEYS = Object.freeze(["dirtiness", "importance", "age", "cursor"]);


export const MSM_PAGE_DIRTINESS = Object.freeze({
  CLEAN: 0,
  INVALIDATED: 1,
  NEVER_RENDERED: 2,
});


export const MSM_PAGE_PICK_REASON = Object.freeze({
  NEVER_RENDERED: "never-rendered",
  INVALIDATED: "invalidated",
  OVERDUE: "overdue",
});


export const MSM_SCHEDULE_SKIP_REASON = Object.freeze({
  NONE: "none",
  MSM_ASLEEP: "msm-asleep",
  NO_BUDGET: "no-budget",
  FROZEN: "frozen",
  NOTHING_PENDING: "nothing-pending",
});


export const MSM_PAGE_NEVER_RENDERED_FRAME = -1;


export function msmAtlasPagesPerFrameFor(tier) {
  const policy = getMsmTierPolicy(tier);
  return policy ? policy.atlasPagesPerFrame : 0;
}

function normalizedPageKey(value) {
  if (value === null || value === undefined) return null;
  const pageKey = String(value).trim();
  return pageKey.length >= 1 ? pageKey : null;
}

function normalizedLightId(value) {
  if (value === null || value === undefined) return null;
  const lightId = String(value).trim();
  return lightId.length >= 1 ? lightId : null;
}

function finiteNumberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveIntegerOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.floor(parsed);
  return rounded >= 1 ? rounded : null;
}

function largerOf(first, second) {
  return second > first ? second : first;
}


function readAtlasPageSection(plan) {
  if (!plan || typeof plan !== "object") return null;
  if (plan.atlasPage && typeof plan.atlasPage === "object") return plan.atlasPage;
  if (typeof plan.action === "string") return plan;
  return null;
}

function pageOverdueRank(page) {
  return page.overdue ? 1 : 0;
}

function compareByAgeThenCursor(first, second) {
  const ageOrder = first.pendingSinceFrame - second.pendingSinceFrame;
  if (ageOrder !== 0) return ageOrder;
  return first.rotatedRank - second.rotatedRank;
}


function comparePendingPages(first, second) {
  const overdueOrder = pageOverdueRank(second) - pageOverdueRank(first);
  if (overdueOrder !== 0) return overdueOrder;
  if (first.overdue) return compareByAgeThenCursor(first, second);

  const dirtinessOrder = second.dirtiness - first.dirtiness;
  if (dirtinessOrder !== 0) return dirtinessOrder;

  const importanceOrder = second.importance - first.importance;
  if (importanceOrder !== 0) return importanceOrder;

  return compareByAgeThenCursor(first, second);
}

function pickReasonFor(page) {
  if (page.overdue) return MSM_PAGE_PICK_REASON.OVERDUE;
  if (page.dirtiness === MSM_PAGE_DIRTINESS.NEVER_RENDERED) return MSM_PAGE_PICK_REASON.NEVER_RENDERED;
  return MSM_PAGE_PICK_REASON.INVALIDATED;
}


export function createAtlasPageScheduler(options) {
  const settings = options || {};
  const tier = typeof settings.tier === "string" ? settings.tier.trim().toLowerCase() : "";
  const tierPagesPerFrame = msmAtlasPagesPerFrameFor(tier);
  const coverageDeadlineOverride = positiveIntegerOrNull(settings.coverageDeadlineFrames);

  const pagesByKey = new Map();
  const registrationOrder = [];

  let budgetOverride = null;
  let frameCount = 0;
  let cursorPageKey = null;
  let freezeRequested = false;

  const totals = {
    frames: 0,
    renders: 0,
    frozenFrames: 0,
    idleFrames: 0,
    budgetLimitedFrames: 0,
    invalidations: 0,
    rejectedPageKeys: 0,
    rejectedPlans: 0,
    refusedBudgetOverrides: 0,
    addedPages: 0,
    removedPages: 0,
    worstGapFrames: 0,
    worstWaitFrames: 0,
  };


  function pagesPerFrame() {
    if (budgetOverride === null) return tierPagesPerFrame;
    return tierPagesPerFrame > budgetOverride ? budgetOverride : tierPagesPerFrame;
  }

  function coverageDeadlineFrames() {
    if (coverageDeadlineOverride !== null) return coverageDeadlineOverride;
    return largerOf(1, registrationOrder.length);
  }


  function overduePromotionThreshold() {
    return largerOf(1, coverageDeadlineFrames() - 1);
  }

  function createPageRecord(pageKey, lightId, importance) {
    return {
      pageKey: pageKey,
      lightId: lightId,
      importance: importance,
      dirtiness: MSM_PAGE_DIRTINESS.NEVER_RENDERED,
      registeredFrame: frameCount,
      pendingSinceFrame: frameCount,
      lastRenderedFrame: MSM_PAGE_NEVER_RENDERED_FRAME,
      renderCount: 0,
      lastGapFrames: 0,
      worstGapFrames: 0,
      worstWaitFrames: 0,
      ringPosition: 0,
      rotatedRank: 0,
      overdue: false,
    };
  }

  function markPagePending(page, dirtiness) {
    if (page.dirtiness === MSM_PAGE_DIRTINESS.CLEAN) page.pendingSinceFrame = frameCount;
    if (dirtiness > page.dirtiness) page.dirtiness = dirtiness;
  }


  function syncPages(pageDescriptors) {
    const descriptors = Array.isArray(pageDescriptors) ? pageDescriptors : [];
    const seenPageKeys = new Set();
    const summary = { registered: 0, added: 0, removed: 0, updated: 0, rejected: 0 };

    descriptors.forEach((descriptor) => {
      const source = descriptor || {};
      const pageKey = normalizedPageKey(source.pageKey);
      if (pageKey === null) {
        summary.rejected++;
        totals.rejectedPageKeys++;
        return;
      }
      if (seenPageKeys.has(pageKey)) {
        summary.rejected++;
        totals.rejectedPageKeys++;
        return;
      }
      seenPageKeys.add(pageKey);

      const lightId = normalizedLightId(source.lightId);
      const importance = finiteNumberOr(source.importance, 0);
      const knownPage = pagesByKey.get(pageKey);

      if (knownPage) {
        knownPage.lightId = lightId;
        knownPage.importance = importance;
        summary.updated++;
        return;
      }

      pagesByKey.set(pageKey, createPageRecord(pageKey, lightId, importance));
      registrationOrder.push(pageKey);
      summary.added++;
      totals.addedPages++;
    });

    for (let index = registrationOrder.length - 1; index >= 0; index--) {
      const pageKey = registrationOrder[index];
      if (seenPageKeys.has(pageKey)) continue;
      registrationOrder.splice(index, 1);
      pagesByKey.delete(pageKey);
      summary.removed++;
      totals.removedPages++;
    }

    summary.registered = registrationOrder.length;
    return summary;
  }

  function invalidatePageKeys(pageKeys, report) {
    if (!Array.isArray(pageKeys)) return;
    pageKeys.forEach((value) => {
      const pageKey = normalizedPageKey(value);
      const page = pageKey === null ? null : pagesByKey.get(pageKey);
      if (!page) {
        report.rejectedPageKeys++;
        totals.rejectedPageKeys++;
        return;
      }
      markPagePending(page, MSM_PAGE_DIRTINESS.INVALIDATED);
      report.invalidated++;
      totals.invalidations++;
    });
  }

  function invalidatePagesOfLights(lightIds, report) {
    if (!Array.isArray(lightIds)) return;
    const wantedLightIds = new Set();
    lightIds.forEach((value) => {
      const lightId = normalizedLightId(value);
      if (lightId !== null) wantedLightIds.add(lightId);
    });
    if (wantedLightIds.size === 0) return;

    registrationOrder.forEach((pageKey) => {
      const page = pagesByKey.get(pageKey);
      if (!page || page.lightId === null) return;
      if (!wantedLightIds.has(page.lightId)) return;
      markPagePending(page, MSM_PAGE_DIRTINESS.INVALIDATED);
      report.invalidated++;
      totals.invalidations++;
    });
  }

  function invalidateEveryPage(report) {
    registrationOrder.forEach((pageKey) => {
      const page = pagesByKey.get(pageKey);
      if (!page) return;
      markPagePending(page, MSM_PAGE_DIRTINESS.INVALIDATED);
      report.invalidated++;
      totals.invalidations++;
    });
  }


  function applyDirtyPlan(plan) {
    const section = readAtlasPageSection(plan);
    const report = {
      action: section ? String(section.action) : "",
      invalidated: 0,
      rejectedPageKeys: 0,
      freezeRequested: false,
      replanAll: false,
      accepted: false,
    };

    if (plan && typeof plan === "object" && plan.frozen === true) {
      freezeRequested = true;
      report.freezeRequested = true;
    }

    if (!section) {
      totals.rejectedPlans++;
      return report;
    }

    const action = String(section.action);
    const replanAll = section.replanAll === true || action === MSM_ATLAS_PAGE_ACTION.REPLAN_ALL_PAGES;

    if (action === MSM_ATLAS_PAGE_ACTION.FREEZE) {
      freezeRequested = true;
      report.freezeRequested = true;
      report.accepted = true;
      return report;
    }

    if (action === MSM_ATLAS_PAGE_ACTION.NONE) {
      report.accepted = true;
      return report;
    }

    if (replanAll) {
      invalidateEveryPage(report);
      report.replanAll = true;
      report.accepted = true;
      return report;
    }

    if (action === MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_LIGHT) {
      invalidatePageKeys(section.pageKeys, report);
      invalidatePagesOfLights(section.lightIds, report);
      report.accepted = true;
      return report;
    }

    if (action === MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_BOX) {
      invalidatePageKeys(section.pageKeys, report);
      report.accepted = true;
      return report;
    }

    totals.rejectedPlans++;
    return report;
  }


  function invalidatePages(pageKeys) {
    const report = { invalidated: 0, rejectedPageKeys: 0 };
    invalidatePageKeys(pageKeys, report);
    return report;
  }

  function refreshRingPositions() {
    registrationOrder.forEach((pageKey, index) => {
      const page = pagesByKey.get(pageKey);
      if (page) page.ringPosition = index;
    });
  }


  function cursorPosition() {
    const ringLength = registrationOrder.length;
    if (ringLength === 0) return 0;
    const lastServedPosition = cursorPageKey === null ? -1 : registrationOrder.indexOf(cursorPageKey);
    if (lastServedPosition === -1) return 0;
    return (lastServedPosition + 1) % ringLength;
  }

  function collectPendingPages(plannedFrame) {
    const ringLength = registrationOrder.length;
    const startPosition = cursorPosition();
    const promotionThreshold = overduePromotionThreshold();
    const pending = [];

    registrationOrder.forEach((pageKey) => {
      const page = pagesByKey.get(pageKey);
      if (!page) return;
      if (!(page.dirtiness > MSM_PAGE_DIRTINESS.CLEAN)) return;
      const waitedFrames = plannedFrame - page.pendingSinceFrame;
      page.overdue = waitedFrames >= promotionThreshold;
      page.rotatedRank = ringLength >= 1 ? (page.ringPosition - startPosition + ringLength) % ringLength : 0;
      pending.push(page);
    });

    return pending;
  }

  function renderPage(page, plannedFrame) {
    const previousFrame = page.lastRenderedFrame >= 0 ? page.lastRenderedFrame : page.registeredFrame;
    const gapFrames = plannedFrame - previousFrame;
    const waitedFrames = plannedFrame - page.pendingSinceFrame;
    const reason = pickReasonFor(page);

    page.lastGapFrames = gapFrames;
    page.worstGapFrames = largerOf(page.worstGapFrames, gapFrames);
    page.worstWaitFrames = largerOf(page.worstWaitFrames, waitedFrames);
    page.lastRenderedFrame = plannedFrame;
    page.renderCount++;
    page.dirtiness = MSM_PAGE_DIRTINESS.CLEAN;
    page.overdue = false;

    totals.renders++;
    totals.worstGapFrames = largerOf(totals.worstGapFrames, gapFrames);
    totals.worstWaitFrames = largerOf(totals.worstWaitFrames, waitedFrames);
    cursorPageKey = page.pageKey;

    return Object.freeze({
      pageKey: page.pageKey,
      lightId: page.lightId,
      importance: page.importance,
      reason: reason,
      waitedFrames: waitedFrames,
      gapFrames: gapFrames,
      renderCount: page.renderCount,
    });
  }

  function pendingPageCount() {
    let count = 0;
    registrationOrder.forEach((pageKey) => {
      const page = pagesByKey.get(pageKey);
      if (page && page.dirtiness > MSM_PAGE_DIRTINESS.CLEAN) count++;
    });
    return count;
  }

  function frozenFramePlan(plannedFrame, budget, skipReason) {
    return Object.freeze({
      phase: MSM_ATLAS_SCHEDULE_PHASE_ID,
      tier: tier,
      frame: plannedFrame,
      budget: budget,
      pageKeys: Object.freeze([]),
      entries: Object.freeze([]),
      renderCount: 0,
      pageCount: registrationOrder.length,
      pendingBefore: pendingPageCount(),
      pendingAfter: pendingPageCount(),
      skipReason: skipReason,
      cursorPageKey: cursorPageKey,
    });
  }


  function planFrame(options) {
    const frameOptions = options || {};
    const budget = pagesPerFrame();
    const frozen = freezeRequested || frameOptions.frozen === true;

    frameCount++;
    totals.frames++;
    freezeRequested = false;

    const plannedFrame = frameCount;

    if (!(budget >= 1)) {
      const skipReason = tierPagesPerFrame >= 1 ? MSM_SCHEDULE_SKIP_REASON.NO_BUDGET : MSM_SCHEDULE_SKIP_REASON.MSM_ASLEEP;
      return frozenFramePlan(plannedFrame, budget, skipReason);
    }

    if (frozen) {
      totals.frozenFrames++;
      return frozenFramePlan(plannedFrame, budget, MSM_SCHEDULE_SKIP_REASON.FROZEN);
    }

    refreshRingPositions();
    const pending = collectPendingPages(plannedFrame);
    const pendingBefore = pending.length;

    if (pendingBefore === 0) {
      totals.idleFrames++;
      return frozenFramePlan(plannedFrame, budget, MSM_SCHEDULE_SKIP_REASON.NOTHING_PENDING);
    }

    pending.sort(comparePendingPages);

    const renderLimit = pendingBefore > budget ? budget : pendingBefore;
    if (pendingBefore > budget) totals.budgetLimitedFrames++;

    const entries = [];
    const pageKeys = [];
    for (let index = 0; renderLimit > index; index++) {
      const entry = renderPage(pending[index], plannedFrame);
      entries.push(entry);
      pageKeys.push(entry.pageKey);
    }

    return Object.freeze({
      phase: MSM_ATLAS_SCHEDULE_PHASE_ID,
      tier: tier,
      frame: plannedFrame,
      budget: budget,
      pageKeys: Object.freeze(pageKeys),
      entries: Object.freeze(entries),
      renderCount: entries.length,
      pageCount: registrationOrder.length,
      pendingBefore: pendingBefore,
      pendingAfter: pendingPageCount(),
      skipReason: MSM_SCHEDULE_SKIP_REASON.NONE,
      cursorPageKey: cursorPageKey,
    });
  }


  function setBudgetOverride(value) {
    if (value === null || value === undefined) {
      budgetOverride = null;
      return true;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      totals.refusedBudgetOverrides++;
      return false;
    }
    const wanted = Math.floor(parsed);
    if (!(wanted >= 0) || wanted > tierPagesPerFrame) {
      totals.refusedBudgetOverrides++;
      return false;
    }
    budgetOverride = wanted;
    return true;
  }


  function pages() {
    return registrationOrder.map((pageKey) => {
      const page = pagesByKey.get(pageKey);
      return {
        pageKey: page.pageKey,
        lightId: page.lightId,
        importance: page.importance,
        dirtiness: page.dirtiness,
        renderCount: page.renderCount,
        lastRenderedFrame: page.lastRenderedFrame,
        lastGapFrames: page.lastGapFrames,
        worstGapFrames: page.worstGapFrames,
        worstWaitFrames: page.worstWaitFrames,
      };
    });
  }

  function pendingPageKeys() {
    return registrationOrder.filter((pageKey) => {
      const page = pagesByKey.get(pageKey);
      return !!page && page.dirtiness > MSM_PAGE_DIRTINESS.CLEAN;
    });
  }


  function coverageReport() {
    const budget = pagesPerFrame();
    const pageCount = registrationOrder.length;
    const deadlineFrames = coverageDeadlineFrames();
    let pagesNeverRendered = 0;

    registrationOrder.forEach((pageKey) => {
      const page = pagesByKey.get(pageKey);
      if (page && page.renderCount === 0) pagesNeverRendered++;
    });

    return {
      phase: MSM_ATLAS_SCHEDULE_PHASE_ID,
      tier: tier,
      frames: totals.frames,
      pageCount: pageCount,
      pagesPerFrame: budget,
      coverageDeadlineFrames: deadlineFrames,
      naturalCoverageFrames: budget >= 1 ? Math.ceil(pageCount / budget) : 0,
      renders: totals.renders,
      worstGapFrames: totals.worstGapFrames,
      worstWaitFrames: totals.worstWaitFrames,
      pagesNeverRendered: pagesNeverRendered,
      pendingPageCount: pendingPageCount(),
      covered: pagesNeverRendered === 0 && deadlineFrames >= totals.worstGapFrames,
    };
  }

  function stats() {
    return {
      phase: MSM_ATLAS_SCHEDULE_PHASE_ID,
      tier: tier,
      tierPagesPerFrame: tierPagesPerFrame,
      pagesPerFrame: pagesPerFrame(),
      frames: totals.frames,
      renders: totals.renders,
      frozenFrames: totals.frozenFrames,
      idleFrames: totals.idleFrames,
      budgetLimitedFrames: totals.budgetLimitedFrames,
      invalidations: totals.invalidations,
      rejectedPageKeys: totals.rejectedPageKeys,
      rejectedPlans: totals.rejectedPlans,
      refusedBudgetOverrides: totals.refusedBudgetOverrides,
      addedPages: totals.addedPages,
      removedPages: totals.removedPages,
      pageCount: registrationOrder.length,
      pendingPageCount: pendingPageCount(),
      cursorPageKey: cursorPageKey,
    };
  }

  return {
    syncPages: syncPages,
    applyDirtyPlan: applyDirtyPlan,
    invalidatePages: invalidatePages,
    planFrame: planFrame,
    setBudgetOverride: setBudgetOverride,
    pagesPerFrame: pagesPerFrame,
    coverageDeadlineFrames: coverageDeadlineFrames,
    pages: pages,
    pendingPageKeys: pendingPageKeys,
    pendingPageCount: pendingPageCount,
    coverageReport: coverageReport,
    stats: stats,
  };
}
