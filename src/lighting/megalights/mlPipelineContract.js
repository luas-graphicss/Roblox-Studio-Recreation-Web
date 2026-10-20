import { MGL_BUFFER_LAYOUTS } from "./mlBufferLayouts.js";
import { MGL_PASS_REFUSALS } from "./mlPassRefusals.js";
import { MGL_UNIFORMS } from "./mlUniformNames.js";


export const MGL_CONTRACT_VERSION = 1;


export const MGL_GUIDING_TILE_SIZE = 8;
export const MGL_TRACE_TILE_SIZE = 16;


export const MGL_MAX_SAMPLES_PER_PIXEL = 16;
export const MGL_MAX_LIGHTS = 1024;
export const MGL_MAX_VISIBLE_LIGHTS_PER_TILE = 8;


export const MGL_HIDDEN_LIGHT_SAMPLE_FRACTION = 0.2;

export const MGL_DISOCCLUSION_FRAME_COUNT = 4;


export const MGL_PASSES = Object.freeze([
  "sceneInputs",
  "lightSceneData",
  "lightGrid",
  "lightFunctionAtlas",
  "visibleLightList",
  "lightSampleGeneration",
  "traceTiles",
  "screenTrace",
  "virtualShadowMapTrace",
  "rayTrace",
  "sampleShading",
  "stochasticUpsample",
  "temporalFilter",
  "spatialFilter",
]);


export const MGL_PASS_OWNER = Object.freeze({
  sceneInputs: "ML-F3",
  lightSceneData: "ML-F4",
  lightGrid: "ML-F5",
  lightFunctionAtlas: "ML-F6",
  visibleLightList: "ML-F9",
  lightSampleGeneration: "ML-F11",
  traceTiles: "ML-F13",
  screenTrace: "ML-F14",
  virtualShadowMapTrace: "ML-F15",
  rayTrace: "ML-F16",
  sampleShading: "ML-F18",
  stochasticUpsample: "ML-F19",
  temporalFilter: "ML-F20",
  spatialFilter: "ML-F21",
});


export const MGL_DOWNSAMPLE_MODES = Object.freeze({
  full: { factor: 1, pattern: "none" },
  half: { factor: 2, pattern: "checkerboard" },
  quarter: { factor: 4, pattern: "fourRooks" },
});


export const MGL_TIER_DEFAULTS = Object.freeze({
  fraco: Object.freeze({
    enabled: false,
    samplesPerPixel: 1,
    downsampleMode: "quarter",
    raysPerPixel: 1,
    virtualShadowMapLightLimit: 0,
    rayTraceEnabled: false,
    volumeSamplesPerFroxel: 0,
  }),
  medio: Object.freeze({
    enabled: true,
    samplesPerPixel: 2,
    downsampleMode: "half",
    raysPerPixel: 1,
    virtualShadowMapLightLimit: 8,
    rayTraceEnabled: false,
    volumeSamplesPerFroxel: 1,
  }),
  forte: Object.freeze({
    enabled: true,
    samplesPerPixel: 4,
    downsampleMode: "full",
    raysPerPixel: 1,
    virtualShadowMapLightLimit: 24,
    rayTraceEnabled: true,
    volumeSamplesPerFroxel: 2,
  }),
});


export const MGL_TRACE_RESULT = Object.freeze({
  visible: "visible",
  occluded: "occluded",
  unknown: "unknown",
});


export const MGL_TRACE_TILE_CLASS = Object.freeze({
  empty: "empty",
  screenOnly: "screenOnly",
  virtualShadowMap: "virtualShadowMap",
  rayTrace: "rayTrace",
  mixed: "mixed",
});


export const MGL_LIGHT_SHAPE = Object.freeze({
  sphere: "sphere",
  rect: "rect",
  tube: "tube",
});


export const MGL_LIGHT_TEXELS_PER_LIGHT = 4;
export const MGL_LIGHT_BUFFER_LAYOUT = Object.freeze({
  texel0: Object.freeze({ r: "positionViewX", g: "positionViewY", b: "positionViewZ", a: "attenuationRadius" }),
  texel1: Object.freeze({ r: "colorR", g: "colorG", b: "colorB", a: "intensityCandela" }),
  texel2: Object.freeze({ r: "directionViewX", g: "directionViewY", b: "directionViewZ", a: "packedConeAngles" }),
  texel3: Object.freeze({ r: "sourceRadiusOrWidth", g: "sourceLengthOrHeight", b: "packedShapeAndFlags", a: "packedAtlasSlots" }),
});


export const MGL_BUFFERS = Object.freeze({
  sceneDepth: Object.freeze({ owner: "ML-F3", format: "depth", scale: 1 }),
  sceneNormal: Object.freeze({ owner: "ML-F3", format: "rgba8", scale: 1 }),
  sceneAlbedoRoughness: Object.freeze({ owner: "ML-F3", format: "rgba8", scale: 1 }),
  sceneVelocity: Object.freeze({ owner: "ML-F3", format: "rg16f", scale: 1 }),
  hierarchicalDepth: Object.freeze({ owner: "ML-F3", format: "rg16f", scale: 1, mipped: true }),
  packedLights: Object.freeze({ owner: "ML-F4", format: "rgba32f", scale: "dataTexture" }),
  lightGridCoarse: Object.freeze({ owner: "ML-F5", format: "rgba32f", scale: "dataTexture" }),
  lightGridMain: Object.freeze({ owner: "ML-F5", format: "rgba32f", scale: "dataTexture" }),
  lightFunctionAtlas: Object.freeze({ owner: "ML-F6", format: "rgba8", scale: "atlas" }),
  blueNoise: Object.freeze({ owner: "ML-F8", format: "rgba8", scale: "tiled" }),
  visibleLightList: Object.freeze({ owner: "ML-F9", format: "rgba32f", scale: "guidingTile" }),
  lightSamples: Object.freeze({ owner: "ML-F11", format: "rgba32f", scale: "downsampled" }),
  traceTileList: Object.freeze({ owner: "ML-F13", format: "rgba32f", scale: "traceTile" }),
  sampleVisibility: Object.freeze({ owner: "ML-F17", format: "rgba8", scale: "downsampled" }),
  shadedDiffuse: Object.freeze({ owner: "ML-F18", format: "rgba16f", scale: "downsampled" }),
  shadedSpecular: Object.freeze({ owner: "ML-F18", format: "rgba16f", scale: "downsampled" }),
  historyDiffuse: Object.freeze({ owner: "ML-F20", format: "rgba16f", scale: 1 }),
  historySpecular: Object.freeze({ owner: "ML-F20", format: "rgba16f", scale: 1 }),
  temporalVariance: Object.freeze({ owner: "ML-F20", format: "rg16f", scale: 1 }),
  shadingConfidence: Object.freeze({ owner: "ML-F22", format: "r8", scale: 1 }),
  volumeFroxel: Object.freeze({ owner: "ML-F23", format: "rgba16f", scale: "froxel" }),
  worldVoxelSh: Object.freeze({ owner: "ML-F24", format: "rgba16f", scale: "worldVoxel" }),
});


export const MGL_TEXTURE_UNIT_CEILING = 16;
export const MGL_TEXTURE_UNITS_RESERVED = Object.freeze({
  "engine:ltc": 2,
  "ML-F3:sceneInputs": 3,
  "ML-F4:packedLights": 1,
  "ML-F5:lightGrid": 1,
  "ML-F6:lightFunctionAtlas": 1,
  "ML-F8:blueNoise": 1,
  "ML-F9:visibleLightList": 1,
  "ML-F11:lightSamples": 1,
  "ML-F15:shadowAtlas": 1,
  "ML-F16:bvh": 1,
  "ML-F20:history": 2,
});

export function totalReservedTextureUnits() {
  return Object.keys(MGL_TEXTURE_UNITS_RESERVED).reduce(
    (total, key) => total + Number(MGL_TEXTURE_UNITS_RESERVED[key] || 0),
    0,
  );
}


export const MGL_PATCH_ORDER = Object.freeze({
  "ML-F7": 40,
  "ML-F11": 60,
  "ML-F14": 80,
  "ML-F15": 100,
  "ML-F16": 120,
  "ML-F17": 140,
  "ML-F18": 160,
  "ML-F19": 180,
  "ML-F20": 200,
  "ML-F21": 220,
  "ML-F22": 240,
  "ML-F23": 260,
  "ML-F24": 280,
  "ML-F25": 300,
});




export const MGL_GATES = Object.freeze({
  fixedCostToleranceRatio: 0.15,
  minSimultaneousAreaLightsStrongTier: 512,
  targetSimultaneousAreaLights: 941,
  maxTotalMillisecondsStrongTier: 5.0,
  flagOffMinimumSsim: 0.99999,
  maxOverheadMillisecondsAllFlagsOff: 0.5,
  minFramesPerSecondMediumTier: 30,
  minFramesPerSecondStrongTier: 45,
  maxWarmupSpikeMilliseconds: 12,
  blindRoundMinimumConfusionRate: 0.7,
  blindRoundMinimumEvaluators: 3,
  maxFireflyLuminanceRatio: 0.001,
  minShadingConfidenceCorrelation: 0.7,
});

export function tierDefaults(tierName) {
  return MGL_TIER_DEFAULTS[tierName] || MGL_TIER_DEFAULTS.medio;
}

export function downsampleFactorFor(modeName) {
  const mode = MGL_DOWNSAMPLE_MODES[modeName];
  return mode ? mode.factor : 1;
}


export function reservedTextureUnitsByPhase() {
  const unitsByPhase = {};
  Object.keys(MGL_TEXTURE_UNITS_RESERVED).forEach((reservationKey) => {
    const phaseId = reservationKey.split(":")[0];
    unitsByPhase[phaseId] =
      (unitsByPhase[phaseId] || 0) + Number(MGL_TEXTURE_UNITS_RESERVED[reservationKey] || 0);
  });
  return unitsByPhase;
}

export function describeContract() {
  return {
    version: MGL_CONTRACT_VERSION,
    passCount: MGL_PASSES.length,
    guidingTileSize: MGL_GUIDING_TILE_SIZE,
    traceTileSize: MGL_TRACE_TILE_SIZE,
    maxLights: MGL_MAX_LIGHTS,
    maxSamplesPerPixel: MGL_MAX_SAMPLES_PER_PIXEL,
    reservedTextureUnits: totalReservedTextureUnits(),
    textureUnitCeiling: MGL_TEXTURE_UNIT_CEILING,
    bufferCount: Object.keys(MGL_BUFFERS).length,
    bufferLayoutCount: Object.keys(MGL_BUFFER_LAYOUTS).length,
    uniformCount: Object.keys(MGL_UNIFORMS).length,
    passesWithRefusals: Object.keys(MGL_PASS_REFUSALS).length,
  };
}





export { MGL_BUFFER_LAYOUTS, MGL_PASS_REFUSALS, MGL_UNIFORMS };
