import { SA_RES_LADDER, saResFor, saStepRes } from "./shadowAtlasCore.js";
import { pageBudgetForTier } from "./llShadowGateCore.js";
import {
  CUBE_FACE_COUNT,
  POINT_CUBE_MAX_LIGHTS,
  cubeFacePageKey,
  isCubeFaceMetaRowInRange,
  metaRowForCubeFace,
} from "./llPointShadowCore.js";


export const POINT_MIN_RANGE_FOR_PAGES = 0.75;


export const POINT_REDRAW_LIGHTS_PER_FRAME = 1;


export const POINT_PAGE_REFUSAL = Object.freeze({
  disabled: "disabled",
  shadowsOff: "shadowsOff",
  rangeTooSmall: "rangeTooSmall",
  outOfMetaRows: "outOfMetaRows",
  outOfPageBudget: "outOfPageBudget",
});

function stepLadderDownOnce(resolution) {
  const index = SA_RES_LADDER.indexOf(resolution);
  if (index <= 0) return SA_RES_LADDER[0];
  return SA_RES_LADDER[index - 1];
}


export function cubeFaceResolutionFor(lightRank, atlasLightCount) {
  return stepLadderDownOnce(saResFor(lightRank, atlasLightCount));
}


export function cubeLightBudgetForTier(tier) {
  const pages = Math.max(0, Number(pageBudgetForTier(tier)) || 0);
  return Math.min(Math.floor(pages / CUBE_FACE_COUNT), POINT_CUBE_MAX_LIGHTS);
}

function squaredDistance(a, b) {
  const ax = Number(a && a[0]) || 0;
  const ay = Number(a && a[1]) || 0;
  const az = Number(a && a[2]) || 0;
  const bx = Number(b && b[0]) || 0;
  const by = Number(b && b[1]) || 0;
  const bz = Number(b && b[2]) || 0;
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}


export function cubeLightFingerprint(light, resolution) {
  const position = (light && light.worldPosition) || [0, 0, 0];
  const round = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
  return [
    round(position[0]),
    round(position[1]),
    round(position[2]),
    round(light && light.range),
    Math.floor(Number(resolution) || 0),
  ].join("|");
}

function refusalFor(light) {
  if (light && light.enabled === false) return POINT_PAGE_REFUSAL.disabled;
  if (!light || light.castsShadow === false) return POINT_PAGE_REFUSAL.shadowsOff;
  if ((Number(light.range) || 0) < POINT_MIN_RANGE_FOR_PAGES) return POINT_PAGE_REFUSAL.rangeTooSmall;
  return null;
}


export function planPointCubePages(input) {
  const options = input || {};
  const lights = Array.isArray(options.pointLights) ? options.pointLights : [];
  const cameraPosition = options.cameraPosition || [0, 0, 0];
  const previousResolutions = options.previousResolutions || {};
  const previousFingerprints = options.previousFingerprints || {};
  const freshLightKeys = Array.isArray(options.freshLightKeys) ? options.freshLightKeys : [];
  const redrawLightsPerFrame = Math.max(
    0,
    Math.floor(
      options.redrawLightsPerFrame === undefined
        ? POINT_REDRAW_LIGHTS_PER_FRAME
        : Number(options.redrawLightsPerFrame) || 0
    )
  );
  const lightBudget = cubeLightBudgetForTier(options.tier);

  const ordered = lights.slice().sort((a, b) => (Number(a.rendererIndex) || 0) - (Number(b.rendererIndex) || 0));
  const accepted = [];
  const refusals = [];

  for (let i = 0; i < ordered.length; i++) {
    const light = ordered[i];
    const rendererIndex = Math.floor(Number(light.rendererIndex) || 0);
    const reason = refusalFor(light);
    if (reason) {
      refusals.push({ key: light.key, rendererIndex: rendererIndex, reason: reason });
      continue;
    }
    if (!isCubeFaceMetaRowInRange(rendererIndex)) {
      refusals.push({ key: light.key, rendererIndex: rendererIndex, reason: POINT_PAGE_REFUSAL.outOfMetaRows });
      continue;
    }
    if (accepted.length >= lightBudget) {
      refusals.push({ key: light.key, rendererIndex: rendererIndex, reason: POINT_PAGE_REFUSAL.outOfPageBudget });
      continue;
    }
    accepted.push({
      key: light.key,
      rendererIndex: rendererIndex,
      worldPosition: light.worldPosition,
      range: Number(light.range) || 0,
      distanceSquared: squaredDistance(light.worldPosition, cameraPosition),
    });
  }


  const byDistance = accepted.slice().sort((a, b) => a.distanceSquared - b.distanceSquared);
  for (let rank = 0; rank < byDistance.length; rank++) {
    const entry = byDistance[rank];
    const wanted = cubeFaceResolutionFor(rank, byDistance.length);
    const previous = Number(previousResolutions[entry.key]) || 0;
    entry.rank = rank;
    entry.resolution = previous > 0 ? saStepRes(previous, wanted) : wanted;
    entry.fingerprint = cubeLightFingerprint(entry, entry.resolution);
    entry.stale = previousFingerprints[entry.key] !== entry.fingerprint || freshLightKeys.indexOf(entry.key) < 0;
  }

  const staleLights = byDistance.filter((entry) => entry.stale);
  const redrawLightKeys = staleLights.slice(0, redrawLightsPerFrame).map((entry) => entry.key);


  const validLightKeys = byDistance
    .filter((entry) => !entry.stale || redrawLightKeys.indexOf(entry.key) >= 0)
    .map((entry) => entry.key);

  const requests = [];
  const pages = [];
  for (let i = 0; i < accepted.length; i++) {
    const entry = accepted[i];
    for (let faceIndex = 0; faceIndex < CUBE_FACE_COUNT; faceIndex++) {
      const id = cubeFacePageKey(entry.key, faceIndex);
      requests.push({ id: id, rank: entry.rank, res: entry.resolution });
      pages.push({
        id: id,
        lightKey: entry.key,
        faceIndex: faceIndex,
        rendererIndex: entry.rendererIndex,
        metaRow: metaRowForCubeFace(entry.rendererIndex, faceIndex),
        res: entry.resolution,
        needsRender: redrawLightKeys.indexOf(entry.key) >= 0,
      });
    }
  }


  let atlasLightCount = 0;
  for (let i = 0; i < accepted.length; i++) {
    atlasLightCount = Math.max(atlasLightCount, accepted[i].rendererIndex + 1);
  }

  return {
    atlasLightCount: atlasLightCount,
    lightBudget: lightBudget,
    lights: byDistance,
    pages: pages,
    requests: requests,
    refusals: refusals,
    redrawLightKeys: redrawLightKeys,
    validLightKeys: validLightKeys,
    stats: {
      pointLights: lights.length,
      atlased: accepted.length,
      refused: refusals.length,
      pageCount: pages.length,
      redrawLights: redrawLightKeys.length,
      pageRendersThisFrame: redrawLightKeys.length * CUBE_FACE_COUNT,
      legacyCubemapsSaved: validLightKeys.length,
    },
  };
}
