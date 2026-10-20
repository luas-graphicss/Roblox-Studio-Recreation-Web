import { mlShadowFactor } from "../megaLightsCore.js";
import { MSM_COMPOSITE_MODE_SCREEN, listPatchSlots } from "./msmPipelineContract.js";


export const MSM_SCREEN_COMPOSITE_OWNER_PHASE = "MSM-F22";
export const MSM_SCREEN_COMPOSITE_PRODUCER_PHASE = "MSM-F21";


const SCREEN_PATCH_SLOT =
  listPatchSlots().find((patchSlot) => patchSlot.compositeMode === MSM_COMPOSITE_MODE_SCREEN) || null;


export const MSM_SCREEN_COMPOSITE_PATCH_SLOT_ID = SCREEN_PATCH_SLOT ? SCREEN_PATCH_SLOT.id : "";


export const MSM_SCREEN_COMPOSITE_INPUT_BUFFER_ID = SCREEN_PATCH_SLOT ? SCREEN_PATCH_SLOT.readsBufferId : "";


export const MSM_SCREEN_COMPOSITE_MATERIAL_TEXTURE_UNIT_COST = SCREEN_PATCH_SLOT
  ? SCREEN_PATCH_SLOT.materialTextureUnitCost
  : 0;


export const MSM_SCREEN_COMPOSITE_NEUTRAL_FACTOR = 1;


export const MSM_SCREEN_COMPOSITE_MINIMUM_UNSHADOWED_LUMINANCE = 1e-6;


export const MSM_SCREEN_COMPOSITE_MINIMUM_BASE_LUMINANCE = 0.001;


export const MSM_SCREEN_COMPOSITE_FETCHES_PER_PIXEL = 1;


export const MSM_SCREEN_COMPOSITE_INPUT_CHANNELS = Object.freeze([
  Object.freeze({
    channel: "r",
    carries: "shadowedLuminance",
    meaning: "accumulated sum of W_i times V_i of the pixel",
    writtenBy: MSM_SCREEN_COMPOSITE_PRODUCER_PHASE,
    readByModeA: true,
  }),
  Object.freeze({
    channel: "g",
    carries: "unshadowedLuminance",
    meaning: "W_lum of the pixel: the same sum with V = 1 (glossary of section 13)",
    writtenBy: MSM_SCREEN_COMPOSITE_PRODUCER_PHASE,
    readByModeA: true,
  }),
  Object.freeze({
    channel: "b",
    carries: "convergence",
    meaning: "reserved for the temporal history; mode A never reads it",
    writtenBy: "MSM-F26",
    readByModeA: false,
  }),
]);


export const MSM_SCREEN_COMPOSITE_MIRROR_ARGUMENT_ORDER = Object.freeze([
  Object.freeze({
    jsFunction: "msmScreenCompositeVisibility",
    glslFunction: "msmScreenCompositeVisibility",
    argumentOrder: Object.freeze(["shadowedLuminance", "unshadowedLuminance"]),
    glslPacking: "vec2(shadowedLuminance, unshadowedLuminance)",
  }),
  Object.freeze({
    jsFunction: "msmScreenCompositeFactor",
    glslFunction: "msmScreenCompositeFactorOf",
    argumentOrder: Object.freeze([
      "shadowedLuminance",
      "unshadowedLuminance",
      "baseLuminance",
      "strength",
    ]),
    glslPacking: "vec2 pair, plus uMsmCompositeBaseLuminance and uMsmCompositeStrength",
  }),
]);


export const MSM_SCREEN_COMPOSITE_DECLARED_RESIDUES = Object.freeze([
  "mode A multiplies an already shaded colour: it can only darken, never add light and never tint",
  "the factor is biased by construction (wsum over wsum plus base); the unbiased estimator is mode B, MSM-F24",
  "the fetch is nearest on the reduced buffer, so the shadow is blocky until the depth aware upsample of MSM-F23",
]);

function readFiniteNumber(value, fallbackValue) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallbackValue;
}

function clampToUnitRange(value) {
  return Math.min(1, Math.max(0, value));
}


export function msmScreenCompositeVisibility(shadowedLuminance, unshadowedLuminance) {
  const unshadowed = readFiniteNumber(unshadowedLuminance, 0);
  const shadowed = readFiniteNumber(shadowedLuminance, 0);
  if (MSM_SCREEN_COMPOSITE_MINIMUM_UNSHADOWED_LUMINANCE > unshadowed) {
    return MSM_SCREEN_COMPOSITE_NEUTRAL_FACTOR;
  }
  return clampToUnitRange(shadowed / unshadowed);
}


export function msmScreenCompositeOcclusion(shadowedLuminance, unshadowedLuminance) {
  return 1 - msmScreenCompositeVisibility(shadowedLuminance, unshadowedLuminance);
}


export function msmScreenCompositeFactor(shadowedLuminance, unshadowedLuminance, baseLuminance, strength) {
  const occlusion = msmScreenCompositeOcclusion(shadowedLuminance, unshadowedLuminance);
  const weightSum = Math.max(0, readFiniteNumber(unshadowedLuminance, 0));
  const safeBaseLuminance = Math.max(
    MSM_SCREEN_COMPOSITE_MINIMUM_BASE_LUMINANCE,
    readFiniteNumber(baseLuminance, 0),
  );
  const safeStrength = clampToUnitRange(readFiniteNumber(strength, 0));
  const factor = mlShadowFactor(occlusion, weightSum, safeBaseLuminance, safeStrength);
  return clampToUnitRange(readFiniteNumber(factor, MSM_SCREEN_COMPOSITE_NEUTRAL_FACTOR));
}


export function msmScreenCompositeIsNeutral(factor) {
  return Object.is(factor, MSM_SCREEN_COMPOSITE_NEUTRAL_FACTOR);
}


export function describeScreenComposite() {
  return {
    ownerPhase: MSM_SCREEN_COMPOSITE_OWNER_PHASE,
    producerPhase: MSM_SCREEN_COMPOSITE_PRODUCER_PHASE,
    compositeMode: MSM_COMPOSITE_MODE_SCREEN,
    patchSlotId: MSM_SCREEN_COMPOSITE_PATCH_SLOT_ID,
    inputBufferId: MSM_SCREEN_COMPOSITE_INPUT_BUFFER_ID,
    materialTextureUnitCost: MSM_SCREEN_COMPOSITE_MATERIAL_TEXTURE_UNIT_COST,
    fetchesPerPixel: MSM_SCREEN_COMPOSITE_FETCHES_PER_PIXEL,
    neutralFactor: MSM_SCREEN_COMPOSITE_NEUTRAL_FACTOR,
    minimumUnshadowedLuminance: MSM_SCREEN_COMPOSITE_MINIMUM_UNSHADOWED_LUMINANCE,
    minimumBaseLuminance: MSM_SCREEN_COMPOSITE_MINIMUM_BASE_LUMINANCE,
    canBrighten: false,
    canTint: false,
    inputChannels: MSM_SCREEN_COMPOSITE_INPUT_CHANNELS,
    residues: MSM_SCREEN_COMPOSITE_DECLARED_RESIDUES,
  };
}
