import {
  SA_MAX_SLOTS,
  saAtlasSizeFor,
  saResFor,
  saStepRes,
} from "./shadowAtlasCore.js";

export const ATLAS_PHASE_ID = "LL-F10";
export const ATLAS_GATE_FLAG_ID = "ShadowAtlas";


export const ATLAS_TEXTURE_UNITS = 2;


export const ATLAS_PAGE_NEAR = 0.5;


export const ATLAS_PAGE_MAX_HALF_ANGLE = 1.53;


export const ATLAS_META_ROW_BASE = Object.freeze({ spotFrustum: 0, pointCubeFace: 64 });
export const ATLAS_META_ROWS_PER_KIND = 64;

export const PAGE_REFUSAL = Object.freeze({
  lightDisabled: "light-disabled",
  notAConeFrustum: "not-a-cone-frustum",
  shadowsDisabled: "shadows-disabled",
  rangeTooSmall: "range-too-small",
  outOfMetaRows: "out-of-meta-rows",
  outOfPageBudget: "out-of-page-budget",
});

export const GATE_REFUSAL = Object.freeze({
  noAtlasCapability: "no-atlas-capability",
  flagOff: "flag-off",
});


export function pageBudgetForTier(tier) {
  if (tier === "fraco") return 0;
  if (tier === "forte") return SA_MAX_SLOTS;
  return 32;
}


export function resolveAtlasGate(input) {
  const options = input || {};
  const mode = options.flagMode || "auto-off";
  const atlasSize = saAtlasSizeFor(options.maxTextureSize, options.allow8k === true);
  if (atlasSize <= 0) {
    return Object.freeze({ on: false, atlasSize: 0, mode, refusal: GATE_REFUSAL.noAtlasCapability });
  }
  if (options.flagOn !== true) {
    return Object.freeze({ on: false, atlasSize, mode, refusal: GATE_REFUSAL.flagOff });
  }
  return Object.freeze({ on: true, atlasSize, mode, refusal: null });
}


export function rendererLightSortKey(light) {
  if (!light) return 0;
  return (light.castShadow ? 2 : 0) + (light.hasMap ? 1 : 0);
}

export function orderLightsAsRendererDoes(lights) {
  const decorated = (Array.isArray(lights) ? lights : []).map((light, order) => ({ light, order }));
  decorated.sort((a, b) => rendererLightSortKey(b.light) - rendererLightSortKey(a.light) || a.order - b.order);
  return decorated.map((entry) => entry.light);
}

function isVisibleSpot(light) {
  return !!light && light.visible !== false && light.rendererType === "SpotLight";
}


export function indexSpotLights(lights) {
  const ordered = orderLightsAsRendererDoes(lights).filter(isVisibleSpot);
  const spots = [];
  let legacyShadowMapCount = 0;
  ordered.forEach((light, spotIndex) => {
    if (light.castShadow === true) legacyShadowMapCount++;
    spots.push(Object.assign({}, light, {
      spotIndex,
      metaRow: ATLAS_META_ROW_BASE.spotFrustum + spotIndex,
    }));
  });
  return { spots, legacyShadowMapCount };
}

export function metaRowForSpotIndex(spotIndex) {
  return ATLAS_META_ROW_BASE.spotFrustum + Math.max(0, Math.floor(Number(spotIndex) || 0));
}

function refuse(refusal) {
  return Object.freeze({ eligible: false, refusal });
}


export function classifyAtlasPage(light) {
  if (!light || light.visible === false) return refuse(PAGE_REFUSAL.lightDisabled);
  if (light.rendererType !== "SpotLight") return refuse(PAGE_REFUSAL.notAConeFrustum);
  if (light.shadowsRequested !== true) return refuse(PAGE_REFUSAL.shadowsDisabled);
  if (!(Number(light.range) > ATLAS_PAGE_NEAR)) return refuse(PAGE_REFUSAL.rangeTooSmall);
  const row = Number(light.metaRow);
  const lastRow = ATLAS_META_ROW_BASE.spotFrustum + ATLAS_META_ROWS_PER_KIND;
  if (!(row >= ATLAS_META_ROW_BASE.spotFrustum) || row >= lastRow) return refuse(PAGE_REFUSAL.outOfMetaRows);
  return Object.freeze({ eligible: true, refusal: null });
}

function squaredDistance(a, b) {
  if (!a || !b) return 0;
  const dx = (Number(a[0]) || 0) - (Number(b[0]) || 0);
  const dy = (Number(a[1]) || 0) - (Number(b[1]) || 0);
  const dz = (Number(a[2]) || 0) - (Number(b[2]) || 0);
  return dx * dx + dy * dy + dz * dz;
}


export function pagePriority(light, cameraPosition) {
  const brightness = Math.max(Number(light && light.brightness) || 0, 0);
  const range = Math.max(Number(light && light.range) || 0, 0.01);
  return (brightness * range) / (1 + squaredDistance(light && light.worldPosition, cameraPosition));
}


export function buildPageRequests(input) {
  const options = input || {};
  const spots = Array.isArray(options.spots) ? options.spots : [];
  const previousResolutions = options.previousResolutions || new Map();
  const eligible = [];
  const refused = [];
  spots.forEach((light) => {
    const verdict = classifyAtlasPage(light);
    if (verdict.eligible) eligible.push(light);
    else refused.push({ key: light && light.key, name: light && light.name, refusal: verdict.refusal });
  });
  const ranked = eligible
    .map((light) => ({ light, priority: pagePriority(light, options.cameraPosition) }))
    .sort((a, b) => b.priority - a.priority || a.light.spotIndex - b.light.spotIndex);
  const budget = Math.max(0, Math.min(Math.floor(Number(options.pageBudget) || 0), SA_MAX_SLOTS));
  const pageCount = Math.min(ranked.length, budget);
  const requests = [];
  ranked.forEach((entry, rank) => {
    if (rank >= budget) {
      refused.push({ key: entry.light.key, name: entry.light.name, refusal: PAGE_REFUSAL.outOfPageBudget });
      return;
    }
    const wanted = saResFor(rank, pageCount);
    const previous = previousResolutions.get(entry.light.key);
    requests.push({
      id: entry.light.key,
      rank,
      res: saStepRes(previous, wanted),
      light: entry.light,
    });
  });
  return { requests, refused, pageCount };
}

function round4(v) {
  return Math.round((Number(v) || 0) * 1e4) / 1e4;
}


export function pageFingerprint(light, res) {
  const p = (light && light.worldPosition) || [0, 0, 0];
  const d = (light && light.direction) || [0, -1, 0];
  return [
    round4(p[0]), round4(p[1]), round4(p[2]),
    round4(d[0]), round4(d[1]), round4(d[2]),
    round4(light && light.angleRad),
    round4(light && light.range),
    Math.floor(Number(res) || 0),
  ].join("|");
}

export function pagesNeedingRender(input) {
  const options = input || {};
  const placed = Array.isArray(options.placed) ? options.placed : [];
  const fingerprints = options.fingerprints || new Map();
  const previousFingerprints = options.previousFingerprints || new Map();
  const out = [];
  placed.forEach((page) => {
    if (!page) return;
    if (options.invalidateAll === true || page.isNew === true) {
      out.push(page);
      return;
    }
    if (fingerprints.get(page.id) !== previousFingerprints.get(page.id)) out.push(page);
  });
  return out;
}


export function countPagesByResolution(placed) {
  const out = {};
  (Array.isArray(placed) ? placed : []).forEach((page) => {
    if (!page) return;
    const key = String(page.res);
    out[key] = (out[key] || 0) + 1;
  });
  return out;
}
