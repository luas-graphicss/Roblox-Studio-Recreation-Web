import { DEFAULT_DECAY_EXPONENT, blendFalloff, saturate } from "../llFalloffCore.js";
import { legacySpotConeAttenuation, spotConeAttenuation } from "../llSpotConeCore.js";
import { MSM_LIGHT_TYPE_CODE, isUsableMsmLightRecord } from "./msmLightRecordCore.js";
import { MSM_GRID_MAX_LISTS_PER_CELL } from "./msmWorldGridLayout.js";


export const MSM_IMPORTANCE_PHASE_ID = "MSM-F13";


export const MSM_COSINE_WRAP = 0.2;


export const MSM_MINIMUM_DISTANCE_TO_LIGHT = 0.0001;


export const MSM_FALLOFF_DECAY_EXPONENT = DEFAULT_DECAY_EXPONENT;


export const MSM_IRRADIANCE_QUANTIZATION_LEVELS = 255;


export const MSM_IRRADIANCE_QUANTIZATION_STEP = 1 / MSM_IRRADIANCE_QUANTIZATION_LEVELS;


export const MSM_MAX_LIGHTS_PER_CELL = MSM_GRID_MAX_LISTS_PER_CELL;


export const MSM_IMPORTANCE_THRESHOLD = MSM_IRRADIANCE_QUANTIZATION_STEP / 2 / MSM_MAX_LIGHTS_PER_CELL;


export const MSM_MIRROR_ERROR_BUDGET = 0.000001;


export const MSM_IMPORTANCE_REFUSAL = Object.freeze({
  UNUSABLE_RECORD: "unusableRecord",
  INVALID_SURFACE: "invalidSurface",
  BEHIND_SURFACE: "behindSurface",
  OUTSIDE_RANGE: "outsideRange",
  OUTSIDE_CONE: "outsideCone",
  DARK_LIGHT: "darkLight",
  BELOW_THRESHOLD: "belowThreshold",
});


export const MSM_HOUSE_ATTENUATION_DEFAULT = Object.freeze({
  falloffBlend: 0,
  spotConeBlend: 0,
  decayExponent: MSM_FALLOFF_DECAY_EXPONENT,
});


export const MSM_IMPORTANCE_RECORD_FIELDS = Object.freeze({
  everyLight: Object.freeze(["positionX", "positionY", "positionZ", "range", "luminance", "typeCode"]),
  spotOnly: Object.freeze(["directionX", "directionY", "directionZ", "cosOuter", "cosInner"]),
});


export const MSM_IMPORTANCE_MIRROR_ARGUMENT_ORDER = Object.freeze({
  msmWrappedCosine: Object.freeze({
    argumentNames: Object.freeze(["normalDotLight"]),
    glslCounterpart: "msmWrappedCosine",
    glslArgumentNames: Object.freeze(["normalDotLight"]),
    glslCallArguments: Object.freeze(["normalDotLight"]),
    argumentsThatAreUniformsInGlsl: Object.freeze([]),
    sameArgumentOrder: true,
    note: "The wrap of the plan opens the light past the terminator.",
  }),
  msmDistanceFalloff: Object.freeze({
    argumentNames: Object.freeze(["distanceToLight", "lightRange", "falloffBlend", "decayExponent"]),
    glslCounterpart: "getDistanceAttenuation",
    glslArgumentNames: Object.freeze(["lightDistance", "cutoffDistance", "decayExponent"]),
    glslCallArguments: Object.freeze(["distanceToLight", "lightRange", "MSM_FALLOFF_DECAY_EXPONENT"]),
    argumentsThatAreUniformsInGlsl: Object.freeze(["falloffBlend"]),
    sameArgumentOrder: true,
    note: "House curve patched by LL-F2; the blend is a uniform on the GPU.",
  }),
  msmSpotConeAttenuation: Object.freeze({
    argumentNames: Object.freeze(["axisCosine", "cosInner", "cosOuter", "spotConeBlend"]),
    glslCounterpart: "getSpotAttenuation",
    glslArgumentNames: Object.freeze(["coneCosine", "penumbraCosine", "angleCosine"]),
    glslCallArguments: Object.freeze(["cosOuter", "cosInner", "axisCosine"]),
    argumentsThatAreUniformsInGlsl: Object.freeze(["spotConeBlend"]),
    sameArgumentOrder: false,
    note: "REVERSED: the house takes (cosOuter, cosInner, axisCosine). Copying the JS order into the shader would silently invert the cone.",
  }),
  msmImportanceWeightFromTerms: Object.freeze({
    argumentNames: Object.freeze(["lightLuminance", "distanceFalloff", "wrappedCosine", "coneAttenuation"]),
    glslCounterpart: "msmImportanceWeightFromTerms",
    glslArgumentNames: Object.freeze(["lightLuminance", "distanceFalloff", "wrappedCosine", "coneAttenuation"]),
    glslCallArguments: Object.freeze(["lightLuminance", "distanceFalloff", "wrappedCosine", "coneAttenuation"]),
    argumentsThatAreUniformsInGlsl: Object.freeze([]),
    sameArgumentOrder: true,
    note: "The product of the plan, written once for both sides.",
  }),
  msmImportanceIsAboveThreshold: Object.freeze({
    argumentNames: Object.freeze(["importanceWeight"]),
    glslCounterpart: "msmImportanceIsAboveThreshold",
    glslArgumentNames: Object.freeze(["importanceWeight"]),
    glslCallArguments: Object.freeze(["importanceWeight"]),
    argumentsThatAreUniformsInGlsl: Object.freeze([]),
    sameArgumentOrder: true,
    note: "The quality decision of the phase, on both sides of the mirror.",
  }),
  msmImportanceFromScalars: Object.freeze({
    argumentNames: Object.freeze([
      "distanceToLight",
      "normalDotLight",
      "axisCosine",
      "lightRange",
      "lightLuminance",
      "cosInner",
      "cosOuter",
      "isSpotLight",
      "falloffBlend",
      "spotConeBlend",
      "decayExponent",
    ]),
    glslCounterpart: "msmImportanceFromScalars",
    glslArgumentNames: Object.freeze([
      "distanceToLight",
      "normalDotLight",
      "axisCosine",
      "lightRange",
      "lightLuminance",
      "cosInner",
      "cosOuter",
      "isSpotLight",
    ]),
    glslCallArguments: Object.freeze([
      "distanceToLight",
      "dot( surfaceNormal, directionToLight )",
      "-dot( directionToLight, lightDirection )",
      "lightRange",
      "lightLuminance",
      "cosInner",
      "cosOuter",
      "isSpotLight",
    ]),
    argumentsThatAreUniformsInGlsl: Object.freeze(["falloffBlend", "spotConeBlend", "decayExponent"]),
    sameArgumentOrder: true,
    note: "Every decision of the phase. JS returns a record and the GPU returns the weight; a refused sample is zero on both sides.",
  }),
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteVector(vector) {
  return Boolean(vector) && isFiniteNumber(vector.x) && isFiniteNumber(vector.y) && isFiniteNumber(vector.z);
}

function emptyTerms() {
  return {
    distanceToLight: 0,
    normalDotLight: 0,
    axisCosine: 0,
    lightLuminance: 0,
    wrappedCosine: 0,
    distanceFalloff: 0,
    coneAttenuation: 0,
  };
}


function refusedSample(refusal, rawWeight, terms) {
  return { accepted: false, weight: 0, rawWeight, refusal, terms };
}


export function resolveHouseAttenuation(houseAttenuation) {
  const injected = houseAttenuation && typeof houseAttenuation === "object" ? houseAttenuation : null;
  if (!injected) return { ...MSM_HOUSE_ATTENUATION_DEFAULT, source: "default" };
  return {
    falloffBlend: isFiniteNumber(injected.falloffBlend) ? injected.falloffBlend : MSM_HOUSE_ATTENUATION_DEFAULT.falloffBlend,
    spotConeBlend: isFiniteNumber(injected.spotConeBlend) ? injected.spotConeBlend : MSM_HOUSE_ATTENUATION_DEFAULT.spotConeBlend,
    decayExponent: isFiniteNumber(injected.decayExponent) ? injected.decayExponent : MSM_HOUSE_ATTENUATION_DEFAULT.decayExponent,
    source: "injected",
  };
}


export function msmWrappedCosine(normalDotLight) {
  return saturate(normalDotLight + MSM_COSINE_WRAP);
}


export function msmDistanceFalloff(distanceToLight, lightRange, falloffBlend, decayExponent) {
  return blendFalloff(distanceToLight, lightRange, falloffBlend, decayExponent);
}











export function msmSpotConeAttenuation(axisCosine, cosInner, cosOuter, spotConeBlend) {
  const legacyAttenuation = legacySpotConeAttenuation(axisCosine, cosOuter, cosInner);
  const blendAmount = saturate(spotConeBlend);
  if (blendAmount <= 0) return legacyAttenuation;
  const unrealAttenuation = spotConeAttenuation(axisCosine, cosInner, cosOuter);
  if (blendAmount >= 1) return unrealAttenuation;
  return legacyAttenuation + (unrealAttenuation - legacyAttenuation) * blendAmount;
}


export function msmImportanceWeightFromTerms(lightLuminance, distanceFalloff, wrappedCosine, coneAttenuation) {
  return lightLuminance * distanceFalloff * wrappedCosine * coneAttenuation;
}


export function msmImportanceIsAboveThreshold(importanceWeight) {
  return importanceWeight >= MSM_IMPORTANCE_THRESHOLD;
}


export function msmImportanceFromScalars(
  distanceToLight,
  normalDotLight,
  axisCosine,
  lightRange,
  lightLuminance,
  cosInner,
  cosOuter,
  isSpotLight,
  falloffBlend,
  spotConeBlend,
  decayExponent,
) {
  const terms = emptyTerms();
  terms.distanceToLight = distanceToLight;
  terms.normalDotLight = normalDotLight;
  terms.axisCosine = axisCosine;
  terms.lightLuminance = lightLuminance;

  terms.wrappedCosine = msmWrappedCosine(normalDotLight);
  if (terms.wrappedCosine <= 0) return refusedSample(MSM_IMPORTANCE_REFUSAL.BEHIND_SURFACE, 0, terms);

  terms.distanceFalloff = msmDistanceFalloff(distanceToLight, lightRange, falloffBlend, decayExponent);
  if (terms.distanceFalloff <= 0) return refusedSample(MSM_IMPORTANCE_REFUSAL.OUTSIDE_RANGE, 0, terms);

  terms.coneAttenuation = isSpotLight > 0.5 ? msmSpotConeAttenuation(axisCosine, cosInner, cosOuter, spotConeBlend) : 1;
  if (terms.coneAttenuation <= 0) return refusedSample(MSM_IMPORTANCE_REFUSAL.OUTSIDE_CONE, 0, terms);

  if (lightLuminance <= 0) return refusedSample(MSM_IMPORTANCE_REFUSAL.DARK_LIGHT, 0, terms);

  const importanceWeight = msmImportanceWeightFromTerms(
    lightLuminance,
    terms.distanceFalloff,
    terms.wrappedCosine,
    terms.coneAttenuation,
  );
  if (!msmImportanceIsAboveThreshold(importanceWeight)) {
    return refusedSample(MSM_IMPORTANCE_REFUSAL.BELOW_THRESHOLD, importanceWeight, terms);
  }
  return { accepted: true, weight: importanceWeight, rawWeight: importanceWeight, refusal: null, terms };
}














export function evaluateLightImportance(request) {
  const settings = request && typeof request === "object" ? request : {};
  const lightRecord = settings.lightRecord;
  const surfacePosition = settings.surfacePosition;
  const surfaceNormal = settings.surfaceNormal;

  if (!isFiniteVector(surfacePosition) || !isFiniteVector(surfaceNormal)) {
    return refusedSample(MSM_IMPORTANCE_REFUSAL.INVALID_SURFACE, 0, emptyTerms());
  }

  if (!isUsableMsmLightRecord(lightRecord)) {
    return refusedSample(MSM_IMPORTANCE_REFUSAL.UNUSABLE_RECORD, 0, emptyTerms());
  }

  const houseAttenuation = resolveHouseAttenuation(settings.houseAttenuation);
  const surfaceToLightX = lightRecord.positionX - surfacePosition.x;
  const surfaceToLightY = lightRecord.positionY - surfacePosition.y;
  const surfaceToLightZ = lightRecord.positionZ - surfacePosition.z;
  const straightDistance = Math.sqrt(
    surfaceToLightX * surfaceToLightX + surfaceToLightY * surfaceToLightY + surfaceToLightZ * surfaceToLightZ,
  );
  const distanceToLight = Math.max(straightDistance, MSM_MINIMUM_DISTANCE_TO_LIGHT);
  const directionToLightX = surfaceToLightX / distanceToLight;
  const directionToLightY = surfaceToLightY / distanceToLight;
  const directionToLightZ = surfaceToLightZ / distanceToLight;

  const normalDotLight =
    surfaceNormal.x * directionToLightX + surfaceNormal.y * directionToLightY + surfaceNormal.z * directionToLightZ;
  const axisCosine = -(
    directionToLightX * lightRecord.directionX +
    directionToLightY * lightRecord.directionY +
    directionToLightZ * lightRecord.directionZ
  );

  return msmImportanceFromScalars(
    distanceToLight,
    normalDotLight,
    axisCosine,
    lightRecord.range,
    lightRecord.luminance,
    lightRecord.cosInner,
    lightRecord.cosOuter,
    lightRecord.typeCode === MSM_LIGHT_TYPE_CODE.spot ? 1 : 0,
    houseAttenuation.falloffBlend,
    houseAttenuation.spotConeBlend,
    houseAttenuation.decayExponent,
  );
}


export function msmCandidateWeights(request) {
  const settings = request && typeof request === "object" ? request : {};
  const lightRecords = Array.isArray(settings.lightRecords) ? settings.lightRecords : [];
  const consideredCount = Math.min(lightRecords.length, MSM_MAX_LIGHTS_PER_CELL);

  const weights = [];
  const samples = [];
  const refusalCounts = {};
  let totalWeight = 0;
  let acceptedCount = 0;
  let refusedWeightSum = 0;

  for (let candidateSlot = 0; consideredCount > candidateSlot; candidateSlot += 1) {
    const sample = evaluateLightImportance({
      lightRecord: lightRecords[candidateSlot],
      surfacePosition: settings.surfacePosition,
      surfaceNormal: settings.surfaceNormal,
      houseAttenuation: settings.houseAttenuation,
    });
    weights.push(sample.weight);
    samples.push({ candidateSlot, ...sample });
    if (sample.accepted) {
      totalWeight += sample.weight;
      acceptedCount += 1;
    } else {
      refusedWeightSum += sample.rawWeight;
      refusalCounts[sample.refusal] = (refusalCounts[sample.refusal] || 0) + 1;
    }
  }

  return {
    weights,
    samples,
    totalWeight,
    acceptedCount,
    consideredCount,
    candidateCount: lightRecords.length,
    refusedCount: consideredCount - acceptedCount,
    refusedWeightSum,
    refusalCounts,
    skippedBySaturationCount: lightRecords.length - consideredCount,
    saturated: lightRecords.length > consideredCount,
  };
}


export function maximumDiscardedWeightPerCell(candidateCount) {
  const count = isFiniteNumber(candidateCount) && candidateCount > 0 ? candidateCount : MSM_MAX_LIGHTS_PER_CELL;
  return Math.min(count, MSM_MAX_LIGHTS_PER_CELL) * MSM_IMPORTANCE_THRESHOLD;
}


export function discardedWeightIsInvisible(refusedWeightSum) {
  return Math.abs(refusedWeightSum) <= MSM_IRRADIANCE_QUANTIZATION_STEP / 2;
}


export function describeImportanceContract() {
  return {
    phaseId: MSM_IMPORTANCE_PHASE_ID,
    formula: "luminance * distanceFalloff * saturate(N.L + wrap) * cone",
    cosineWrap: MSM_COSINE_WRAP,
    threshold: MSM_IMPORTANCE_THRESHOLD,
    thresholdDerivation: "quantizationStep / 2 / maxLightsPerCell",
    maxLightsPerCell: MSM_MAX_LIGHTS_PER_CELL,
    mirrorErrorBudget: MSM_MIRROR_ERROR_BUDGET,
    houseCurves: Object.freeze([
      "llFalloffCore.js blendFalloff: distance falloff (LL-F2)",
      "llSpotConeCore.js: spot cone (LL-F5)",
    ]),
    luminanceOwner: "MSM-F6: measured once per light, never recomputed per sample",
    drawOwner: "MSM-F14: consumes these weights, decides nothing about them",
  };
}
