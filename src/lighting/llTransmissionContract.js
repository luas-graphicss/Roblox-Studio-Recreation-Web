export const TRANSMISSION_PHASE_ID = "LL-F16";


export const BASELINE_FREEZE_FLAG_ID = "LlBaseline";


export const ATLAS_GATE_FLAG_ID = "ShadowAtlas";
export const COLORED_SHADOW_FLAG_ID = "LocalColoredShadow";


export const RAY_TRACED_SHADOW_FLAG_ID = "LocalRayTracedShadow";
export const RAY_TRACED_SHADOW_PROP = "RayTracedShadow";
export const RAY_TRACED_SHADOW_REQUIRED_TIER = "forte";
export const RAY_TRACED_SHADOW_MAX_LIGHTS = 4;
export const RAY_TRACED_PARITY_TOLERANCE = 0.05;
export const RAY_TRACED_DEPTH_BIAS_STUDS = 0.05;


export const TRANSMISSION_PATCH_ID = "ll-f16-transmission-local";
export const TRANSMISSION_ANCHOR_ID = "lightsFragmentBegin";
export const TRANSMISSION_LIGHT_LOOP_CHUNK = "lights_fragment_begin";




export const TRANSMISSION_DECLARATION_CHUNK = "shadowmap_pars_fragment";

export const TRANSMISSION_PATCH_ORDER = 220;
export const ATLAS_TINT_FUNCTION = "rswSaTint";
export const TRANSMISSION_TINT_FUNCTION = "llLocalTransmissionTint";
export const SUBSURFACE_FUNCTION = "llLocalSubsurfaceRadiance";

export const TRANSMISSION_TEXTURE_UNITS = 0;


export const TRANSMITTER_COUNT_UNIFORM = "uTransCount";
export const TRANSMITTER_MIN_UNIFORM = "uTransMin";
export const TRANSMITTER_MAX_UNIFORM = "uTransMax";
export const TRANSMITTER_TINT_UNIFORM = "uTransTint";


export const TRANSMITTER_BOX_SLOTS = 8;





export const TRANSMISSION_MIX_UNIFORM = "uLlTransmissionMix";
export const SUBSURFACE_MATERIAL_UNIFORM = "uLlSubsurfaceMaterial";


export const TRANSMISSION_PROOF_SCENE_ID = "cena7";
export const TRANSMISSION_QA_ID = "ll-f16-vitral-sss";


export const TRANSMITTER_REFUSALS = Object.freeze({
  notTransmissive: "not-transmissive",
  emptyBox: "empty-box",
  overBudget: "over-budget",
});

export const RAY_TRACED_REFUSALS = Object.freeze({
  baselineFrozen: "baseline-frozen",
  tierNotHigh: "tier-not-high",
  flagOff: "flag-off",
  propOff: "prop-off",
  overBudget: "over-budget",
});
