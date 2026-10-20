export const LOCAL_GI_PHASE_ID = "LL-F18";
export const LOCAL_GI_FLAG_ID = "LocalLightGi";
export const LOCAL_GI_PATCH_ID = "ll-f18-gi-local";
export const LOCAL_GI_PROOF_SCENE_ID = "cena1";


export const BASELINE_FREEZE_FLAG_ID = "LlBaseline";


export const INDIRECT_INTENSITY_PROP = "IndirectLightingIntensity";
export const INDIRECT_INTENSITY_DEFAULT = 1;
export const INDIRECT_INTENSITY_MINIMUM = 0;

export const INDIRECT_INTENSITY_MAXIMUM = 8;


export const LOCAL_GI_ANCHOR_ID = "lightsFragmentMaps";
export const LOCAL_GI_INJECTION_CHUNK = "lights_fragment_maps";


export const LOCAL_GI_DECLARATION_CHUNK = "common";

export const LOCAL_GI_SHADING_POINT_CHUNK = "lights_fragment_begin";


export const LOCAL_GI_PATCH_ORDER = 180;


export const LOCAL_GI_MATERIAL_PATHS = Object.freeze(["standard", "physical", "poolPhong", "terreno", "skinned"]);


export const GI_BLEND_UNIFORM = "uLlGiLocalOn";

export const GI_EMITTER_COUNT_UNIFORM = "uLlGiBounceCount";

export const GI_EMITTER_ORIGIN_UNIFORM = "uLlGiBounceOrigin";

export const GI_EMITTER_RADIANCE_UNIFORM = "uLlGiBounceRadiance";

export const GI_EMITTER_NORMAL_UNIFORM = "uLlGiBounceNormal";


export const FALLOFF_BLEND_UNIFORM = "uLlFalloffOn";
export const SPOT_CONE_MIX_UNIFORM = "uLlSpotConeUeMix";

export const LEGACY_DECAY_EXPONENT = 2;


export const MAX_BOUNCE_EMITTERS = 16;
export const BOUNCE_EMITTER_SLOT_SIZE = 4;


export const MAX_INJECTED_LIGHTS = 16;

export const MIN_EMITTER_LUMINANCE = 1e-5;

export const LOCAL_GI_TEXTURE_UNITS = 0;


export const LOCAL_GI_TIER_BUDGET = Object.freeze({
  fraco: Object.freeze({ bounceEmitters: 0, injectedLights: 0, bounces: 0, voxelResolution: 8, samplesPerMesh: 0 }),
  medio: Object.freeze({ bounceEmitters: 8, injectedLights: 8, bounces: 1, voxelResolution: 10, samplesPerMesh: 8 }),
  forte: Object.freeze({ bounceEmitters: 16, injectedLights: 16, bounces: 2, voxelResolution: 12, samplesPerMesh: 12 }),
});


export const LOCAL_GI_FLAG_DEFAULT = Object.freeze({ fraco: false, medio: true, forte: true });


export const LOCAL_GI_SOLVE_INTERVAL_MS = 120;

export function tierBudgetFor(tier) {

  return LOCAL_GI_TIER_BUDGET[tier] || LOCAL_GI_TIER_BUDGET.medio;
}

export function clampIndirectIntensity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return INDIRECT_INTENSITY_DEFAULT;
  return Math.min(Math.max(numeric, INDIRECT_INTENSITY_MINIMUM), INDIRECT_INTENSITY_MAXIMUM);
}

export function emitterBufferLength() {
  return MAX_BOUNCE_EMITTERS * BOUNCE_EMITTER_SLOT_SIZE;
}
