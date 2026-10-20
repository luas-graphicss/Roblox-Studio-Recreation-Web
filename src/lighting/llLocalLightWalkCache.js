import { collectLocalLightsAndRectAreaLightsInRenderOrder } from "./llLocalLightTableCore.js";


let windowScene = null;


let windowWalk = null;


let windowLocalLights = null;

let performedWalkCount = 0;
let reusedWalkCount = 0;
let invalidationCount = 0;
let lastInvalidationReason = "";

function isOpenWindowOf(scene) {
  return windowScene !== null && windowScene === scene;
}


function walkScene(scene) {
  performedWalkCount += 1;
  return collectLocalLightsAndRectAreaLightsInRenderOrder(scene);
}


function windowWalkOf(scene) {
  if (windowWalk !== null) {
    reusedWalkCount += 1;
    return windowWalk;
  }
  windowWalk = walkScene(scene);
  windowLocalLights = {
    pointLights: windowWalk.pointLights,
    spotLights: windowWalk.spotLights,
  };
  return windowWalk;
}


export function beginLocalLightWalkFrame(scene) {
  windowScene = scene || null;
  windowWalk = null;
  windowLocalLights = null;
  return windowScene !== null;
}


export function invalidateLocalLightWalk(reason) {
  if (windowScene !== null || windowWalk !== null) invalidationCount += 1;
  lastInvalidationReason = String(reason || "unspecified");
  windowWalk = null;
  windowLocalLights = null;
  return true;
}


export function localLightsInRenderOrder(scene) {
  if (!isOpenWindowOf(scene)) {
    const walked = walkScene(scene);
    return { pointLights: walked.pointLights, spotLights: walked.spotLights };
  }
  windowWalkOf(scene);
  return windowLocalLights;
}


export function rectAreaLightsInRenderOrder(scene) {
  if (!isOpenWindowOf(scene)) return walkScene(scene).rectAreaLights;
  return windowWalkOf(scene).rectAreaLights;
}


export function localLightWalkStats() {
  return {
    walks: performedWalkCount,
    reusedWalks: reusedWalkCount,
    invalidations: invalidationCount,
    lastInvalidationReason,
    windowOpen: windowScene !== null,
    windowHasFreshWalk: windowWalk !== null,
  };
}


export function resetLocalLightWalkCache() {
  windowScene = null;
  windowWalk = null;
  windowLocalLights = null;
  performedWalkCount = 0;
  reusedWalkCount = 0;
  invalidationCount = 0;
  lastInvalidationReason = "";
  return true;
}
