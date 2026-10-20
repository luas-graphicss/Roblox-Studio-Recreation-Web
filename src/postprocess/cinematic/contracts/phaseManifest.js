const phaseDefinitions = [
  ["CP-F01", "Reference and conformance", [], ["prepare"], "Verified UE5.9 build, property inventory, golden buffers and sequence provenance"],
  ["CP-F02", "Settings and volumes", ["CP-F01"], ["prepare"], "Defaults, overrides, camera weights, spatial blending and stable serialization"],
  ["CP-F03", "Physical camera", ["CP-F01", "CP-F02"], ["prepare"], "Filmback, lens, aperture, focus, shutter, ISO and explicit world units"],
  ["CP-F04", "HDR and pre-exposure", ["CP-F01"], ["prepare", "beforeDof"], "Scene-linear color, explicit primaries, pre-exposure transport and unclipped targets"],
  ["CP-F05", "Scene geometry inputs", ["CP-F03", "CP-F04"], ["prepare", "beforeDof"], "Depth, normals, coverage, stencil and material-domain coverage"],
  ["CP-F06", "Complete motion vectors", ["CP-F03", "CP-F05"], ["prepare", "beforeDof"], "Camera, rigid, instanced, skinned, morph, deformation and particle velocity"],
  ["CP-F07", "Temporal history", ["CP-F04", "CP-F05", "CP-F06"], ["prepare"], "Per-view history, jitter, rejection, exposure rescaling and invalidation"],
  ["CP-F08", "Exposure metering", ["CP-F01", "CP-F03", "CP-F04"], ["metering"], "Basic, 64-bin histogram, manual and weighted mask metering"],
  ["CP-F09", "Exposure adaptation", ["CP-F02", "CP-F03", "CP-F04", "CP-F07", "CP-F08"], ["metering"], "Actual and target EV, compensation curves and time-independent adaptation"],
  ["CP-F10", "Local exposure", ["CP-F04", "CP-F07", "CP-F08", "CP-F09"], ["localExposure"], "Edge-aware base/detail, highlight and shadow control without glare feedback"],
  ["CP-F11", "Filmic tonemapper", ["CP-F01", "CP-F04"], ["toneMapping"], "Reference film curve and gamut transforms, not a renamed three ACES fit"],
  ["CP-F12", "Scene color grading", ["CP-F01", "CP-F02", "CP-F04", "CP-F11"], ["grading"], "White balance, global and tonal-zone saturation, contrast, gamma, gain and offset"],
  ["CP-F13", "LUT and look assets", ["CP-F01", "CP-F04", "CP-F12"], ["grading"], "Validated LUT domains, interpolation, caching and authored look blending"],
  ["CP-F14", "Standard bloom", ["CP-F01", "CP-F04"], ["bloom"], "Threshold, multi-band filtering, energy, tints and stable upsampling"],
  ["CP-F15", "Convolution bloom", ["CP-F01", "CP-F04", "CP-F14"], ["bloom"], "HDR kernel, convolution, padding, normalization and independent numerical oracle"],
  ["CP-F16", "Lens flare", ["CP-F01", "CP-F04", "CP-F05", "CP-F14"], ["lensFlare"], "Image-driven ghosts, bokeh shape, threshold, color and positional tints"],
  ["CP-F17", "Lens dirt", ["CP-F01", "CP-F14", "CP-F15", "CP-F16"], ["lensDirt"], "Dirt texture intensity and tint composed with glare in the correct domain"],
  ["CP-F18", "Physical circle of confusion", ["CP-F01", "CP-F03", "CP-F04", "CP-F05"], ["dof"], "Signed lens-derived CoC, prefilter, near/far coverage and tile classification"],
  ["CP-F19", "Diaphragm depth of field", ["CP-F18"], ["dof"], "Near/far bokeh gather or scatter, coverage compensation and recombination"],
  ["CP-F20", "Temporal depth of field", ["CP-F06", "CP-F07", "CP-F18", "CP-F19", "CP-F27"], ["dof", "afterDof"], "Focus transitions, temporal stability, edge-aware reconstruction and capture"],
  ["CP-F21", "Temporal reconstruction", ["CP-F01", "CP-F04", "CP-F05", "CP-F06", "CP-F07", "CP-F20", "CP-F27"], ["temporal"], "TAA and TSR with display-resolution history, disocclusion and translucency handling"],
  ["CP-F22", "Cinematic motion blur", ["CP-F03", "CP-F05", "CP-F06", "CP-F07", "CP-F21", "CP-F27"], ["motionBlur"], "Velocity tiles, occlusion-aware gather, shutter, target FPS and object coverage"],
  ["CP-F23", "Chromatic aberration", ["CP-F01", "CP-F03", "CP-F04"], ["lensWarp"], "Reference channel displacement, start offset and calibrated lens extension boundaries"],
  ["CP-F24", "Vignette", ["CP-F01", "CP-F11"], ["filmFinish"], "Reference radial response, aspect handling and neutral bypass"],
  ["CP-F25", "Film grain", ["CP-F01", "CP-F04", "CP-F07", "CP-F11"], ["filmFinish"], "Tonal intensities, texture, texel size, deterministic temporal seed and spectrum"],
  ["CP-F26", "Post process materials", ["CP-F01", "CP-F02", "CP-F04", "CP-F05"], ["beforeDof", "afterDof", "afterTemporal", "beforeBloom", "toneMapping", "afterOutput"], "Blendable locations, user scene textures, stencil and tonemapper replacement"],
  ["CP-F27", "Lighting and translucency bridge", ["CP-F01", "CP-F02", "CP-F04", "CP-F05", "CP-F06", "CP-F26"], ["beforeDof", "afterDof", "afterMotionBlur"], "Explicit ownership of lighting, fog, AO, reflections and translucency stages"],
  ["CP-F28", "Display output", ["CP-F01", "CP-F04", "CP-F11", "CP-F12", "CP-F13", "CP-F23", "CP-F24", "CP-F25", "CP-F26"], ["output"], "SDR/HDR transforms, gamut, paper white, alpha and real output capability proof"],
  ["CP-F29", "Cinematic capture", ["CP-F07", "CP-F15", "CP-F20", "CP-F21", "CP-F22", "CP-F28"], ["capture"], "Subframes, samples, tiled overlap, overscan and validated linear/display export"],
  ["CP-F30", "Diagnostics and comparison", ["CP-F04", "CP-F05", "CP-F06", "CP-F07"], ["debug"], "Real buffer inspection, difference views, negative controls and evidence capture"],
  ["CP-F31", "Quality and budgets", Array.from({ length: 22 }, (_, index) => `CP-F${String(index + 8).padStart(2, "0")}`).concat("CP-F32"), ["prepare"], "Explicit quality profiles, memory accounting, capability gates and hysteresis"],
  ["CP-F32", "Resource and device robustness", ["CP-F04", "CP-F07"], ["prepare"], "Pool lifetime, warmup, resize, context restoration and idempotent cleanup"],
  ["CP-F33", "Public API and authoring", ["CP-F02", "CP-F03", "CP-F26", "CP-F28"], ["prepare"], "Versioned API, settings UI, migration, persistence and legacy compatibility"],
  ["CP-F34", "Future integration adapter", ["CP-F31", "CP-F32", "CP-F33"], ["prepare"], "Isolated host integration, safe promotion and single presentation ownership"],
  ["CP-F35", "Integrated quality assurance", Array.from({ length: 34 }, (_, index) => `CP-F${String(index + 1).padStart(2, "0")}`), ["debug"], "Cross-feature GPU sequences, negative tests, memory and measured performance"],
  ["CP-F36", "Exact reference certification", ["CP-F35"], ["debug"], "Isolated reference certificate followed by real Future promotion verification"]
];

export const CONTRACT_VERSION = "1.0.0";
export const PHASE_MANIFEST = Object.freeze(phaseDefinitions.map(([id, title, completionDependencies, stages, deliverable]) => Object.freeze({
  id,
  title,
  deliverable,
  contractVersion: CONTRACT_VERSION,
  startDependencies: Object.freeze(["B00"]),
  completionDependencies: Object.freeze(completionDependencies),
  stages: Object.freeze(stages),
  entry: `src/phases/${id}/index.js`,
  ownedPaths: Object.freeze([`src/phases/${id}/`, `tests/phases/${id}/`, `fixtures/phases/${id}/`, `reports/${id}/`])
})));

export function getPhaseDefinition(phaseId) {
  const definition = PHASE_MANIFEST.find((phase) => phase.id === phaseId);
  if (!definition) throw new Error(`Unknown phase: ${phaseId}`);
  return definition;
}
