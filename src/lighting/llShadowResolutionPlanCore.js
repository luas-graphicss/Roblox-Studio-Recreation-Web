import { SA_MAX_SLOTS, saResFor, saStepRes } from "./shadowAtlasCore.js";
import {
  MAX_SHADOW_RESOLUTION,
  SHADOW_RESOLUTION_LADDER,
  clampResolutionToCeiling,
  ladderIndexOf,
  ladderStepForPixels,
  ladderStepsBetween,
  measureLightScreenFootprint,
  resolutionForFootprint,
  resolveView,
} from "./llShadowScreenSizeCore.js";
import { rankByShadowPriority, recencyWeight } from "./llShadowPriorityCore.js";

export const PLAN_PHASE_ID = "LL-F12";

export const SHADOW_RESOLUTION_MODE = Object.freeze({
  RANK: "rank",
  SCREEN_COVERAGE: "screenCoverage",
});


export const HYSTERESIS_MARGIN = 0.15;


export const MIN_PAGE_INFLUENCE_RADIUS = 0.5;

export const PAGE_REFUSAL = Object.freeze({
  lightDisabled: "light-disabled",
  shadowsDisabled: "shadows-disabled",
  rangeTooSmall: "range-too-small",
  noScreenCoverage: "no-screen-coverage",
  outOfPageBudget: "out-of-page-budget",
});

const ELIGIBLE = Object.freeze({ eligible: true, refusal: null });
const LAST_LADDER_INDEX = SHADOW_RESOLUTION_LADDER.length - 1;

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveOr(value, fallback) {
  return Math.max(finiteOr(value, fallback === undefined ? 0 : fallback), 0);
}

function refuse(refusal) {
  return Object.freeze({ eligible: false, refusal });
}

function readMap(map, key, fallback) {
  if (map && typeof map.get === "function") {
    const stored = map.get(key);
    return stored === undefined ? fallback : stored;
  }
  const plain = asObject(map);
  return plain[key] === undefined ? fallback : plain[key];
}


export function defaultPageEligibility(light) {
  const source = asObject(light);
  if (source.enabled === false) return refuse(PAGE_REFUSAL.lightDisabled);
  if (source.shadowsRequested !== true) return refuse(PAGE_REFUSAL.shadowsDisabled);
  if (!(positiveOr(source.influenceRadius) > MIN_PAGE_INFLUENCE_RADIUS)) return refuse(PAGE_REFUSAL.rangeTooSmall);
  return ELIGIBLE;
}


export function stepResolutionWithHysteresis(input) {
  const request = asObject(input);
  const wantedResolution = ladderStepForPixels(request.wantedResolution);
  const desiredPixels = positiveOr(request.desiredPixels);
  const margin = Math.min(Math.max(finiteOr(request.margin, HYSTERESIS_MARGIN), 0), 0.9);
  const previousResolution = request.previousResolution;
  const previousIndex = ladderIndexOf(previousResolution);

  if (previousIndex === -1) {
    return Object.freeze({ resolution: wantedResolution, direction: "new", accepted: true });
  }
  const previous = SHADOW_RESOLUTION_LADDER[previousIndex];
  const wantedIndex = ladderIndexOf(wantedResolution);
  if (wantedIndex === previousIndex) {
    return Object.freeze({ resolution: previous, direction: "hold", accepted: true });
  }
  if (wantedIndex > previousIndex) {
    const nextStep = SHADOW_RESOLUTION_LADDER[Math.min(previousIndex + 1, LAST_LADDER_INDEX)];
    const accepted = desiredPixels >= nextStep * (1 + margin);
    return Object.freeze({
      resolution: accepted ? saStepRes(previous, wantedResolution) : previous,
      direction: accepted ? "up" : "deadZone",
      accepted,
    });
  }
  const accepted = previous * (1 - margin) >= desiredPixels;
  return Object.freeze({
    resolution: accepted ? saStepRes(previous, wantedResolution) : previous,
    direction: accepted ? "down" : "deadZone",
    accepted,
  });
}

function summarize(entries, ceilingResolution, mode, pageBudget) {
  const byResolution = {};
  let upgrades = 0;
  let downgrades = 0;
  let held = 0;
  let maxLadderSteps = 0;
  entries.forEach((entry) => {
    const key = String(entry.resolution);
    byResolution[key] = (byResolution[key] || 0) + 1;
    if (entry.direction === "up") upgrades += 1;
    if (entry.direction === "down") downgrades += 1;
    if (entry.direction === "hold" || entry.direction === "deadZone") held += 1;
    maxLadderSteps = Math.max(maxLadderSteps, entry.ladderSteps);
  });
  return Object.freeze({
    mode,
    pages: entries.length,
    pageBudget,
    ceilingResolution,
    byResolution,
    upgrades,
    downgrades,
    held,
    maxLadderSteps,
    changedPages: upgrades + downgrades,
  });
}


export function planShadowResolutions(input) {
  const request = asObject(input);
  const view = resolveView(request.view);
  const camera = asObject(request.camera);
  const planIndex = Math.max(Math.floor(finiteOr(request.planIndex, 0)), 0);
  const mode = request.mode === SHADOW_RESOLUTION_MODE.RANK ? SHADOW_RESOLUTION_MODE.RANK : SHADOW_RESOLUTION_MODE.SCREEN_COVERAGE;
  const isEligible = typeof request.isEligible === "function" ? request.isEligible : defaultPageEligibility;
  const ceilingResolution = clampResolutionToCeiling(
    MAX_SHADOW_RESOLUTION,
    request.ceilingResolution === undefined ? MAX_SHADOW_RESOLUTION : request.ceilingResolution
  );
  const pageBudget = Math.max(Math.min(Math.floor(finiteOr(request.pageBudget, SA_MAX_SLOTS)), SA_MAX_SLOTS), 0);
  const lights = Array.isArray(request.lights) ? request.lights : [];

  const refused = [];
  const candidates = [];
  lights.forEach((rawLight) => {
    const light = asObject(rawLight);
    const key = String(light.key === undefined ? light.name : light.key);
    const verdict = isEligible(light);
    if (!verdict || verdict.eligible !== true) {
      refused.push({ key, name: light.name, refusal: (verdict && verdict.refusal) || PAGE_REFUSAL.lightDisabled });
      return;
    }
    const footprint = measureLightScreenFootprint({ light, view, camera });
    if (!(footprint.coverage > 0)) {
      refused.push({ key, name: light.name, refusal: PAGE_REFUSAL.noScreenCoverage });
      return;
    }
    candidates.push({
      key,
      light,
      footprint,
      coverage: footprint.coverage,
      intensity: positiveOr(light.intensity),
      recency: recencyWeight({
        planIndex,
        lastVisiblePlanIndex: readMap(request.lastVisiblePlans, key, planIndex),
      }),
    });
  });

  const ranked = rankByShadowPriority(candidates);
  const entries = [];
  const requests = [];
  const pageCount = Math.min(ranked.length, pageBudget);

  ranked.forEach((item) => {
    const candidate = item.entry;
    if (item.rank >= pageBudget) {
      refused.push({ key: item.key, name: candidate.light.name, refusal: PAGE_REFUSAL.outOfPageBudget });
      return;
    }
    const previousResolution = readMap(request.previousResolutions, item.key, null);
    const sized = resolutionForFootprint(candidate.footprint, {
      texelsPerScreenPixel: request.texelsPerScreenPixel,
      ceilingResolution,
    });
    const desiredPixels = sized.desiredPixels;
    let wantedResolution;
    let stepped;
    if (mode === SHADOW_RESOLUTION_MODE.RANK) {


      wantedResolution = Math.min(saResFor(item.rank, pageCount), ceilingResolution);
      const resolution = ladderIndexOf(previousResolution) === -1 ? wantedResolution : saStepRes(previousResolution, wantedResolution);
      stepped = {
        resolution,
        direction: ladderIndexOf(previousResolution) === -1 ? "new" : resolution === previousResolution ? "hold" : resolution > previousResolution ? "up" : "down",
        accepted: true,
      };
    } else {
      wantedResolution = sized.resolution;
      stepped = stepResolutionWithHysteresis({ previousResolution, wantedResolution, desiredPixels });
    }
    const entry = {
      key: item.key,
      name: candidate.light.name,
      kind: candidate.light.kind,
      rank: item.rank,
      priority: item.priority,
      coverage: item.coverage,
      intensityWeight: item.intensityWeight,
      recency: item.recency,
      distance: candidate.footprint.distance,
      radiusPixels: candidate.footprint.radiusPixels,
      cameraInside: candidate.footprint.cameraInside,
      desiredPixels,
      wantedResolution,
      previousResolution: ladderIndexOf(previousResolution) === -1 ? null : previousResolution,
      resolution: stepped.resolution,
      direction: stepped.direction,
      ladderSteps: ladderStepsBetween(previousResolution, stepped.resolution),
    };
    entries.push(entry);
    requests.push({ id: entry.key, rank: entry.rank, res: entry.resolution });
  });

  return Object.freeze({
    mode,
    planIndex,
    view,
    ceilingResolution,
    pageBudget,
    pageCount,
    entries,
    requests,
    refused,
    summary: summarize(entries, ceilingResolution, mode, pageBudget),
  });
}


export function nextPlanState(plan) {
  const source = asObject(plan);
  const entries = Array.isArray(source.entries) ? source.entries : [];
  const previousResolutions = new Map();
  const lastVisiblePlans = new Map();
  entries.forEach((entry) => {
    previousResolutions.set(entry.key, entry.resolution);
    lastVisiblePlans.set(entry.key, source.planIndex);
  });
  return { previousResolutions, lastVisiblePlans };
}
