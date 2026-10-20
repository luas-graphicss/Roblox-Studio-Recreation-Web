import {
  CL_IDX_TEX_H,
  CL_IDX_TEX_W,
  CL_MAX_INDEX_ENTRIES,
  CL_MAX_LIGHTS,
  CL_MAX_LIGHTS_PER_CELL,
  CL_TOTAL,
  CL_X,
  CL_Y,
  CL_Z,
} from "./lightClusterCore.js";

export const CLUSTER_SHADING_PHASE_ID = "LL-F20";
export const CLUSTER_SHADING_FLAG_ID = "LocalLightCluster";
export const CLUSTER_SHADING_PATCH_ID = "ll-f20-cluster-shading";


export const CLUSTER_SHADING_ANCHOR = "lightsFragmentBegin";
export const CLUSTER_SHADING_CHUNK_NAME = "lights_fragment_begin";


export const CLUSTER_SHADING_DECLARATIONS_CHUNK_NAME = "common";


export const CLUSTER_SHADING_PATCH_ORDER = 160;


export const BASELINE_FREEZE_FLAG_ID = "LlBaseline";


export const CLUSTER_SHADING_UNIFORMS = Object.freeze({
  enabled: "uLlF20Enabled",
  lightCount: "uLlF20LightCount",
  lightTexture: "uLlF20LightTex",
  cellTexture: "uLlF20CellTex",
  lightIndexTexture: "uLlF20LightIndexTex",
  near: "uLlF20Near",
  far: "uLlF20Far",
  projectionScaleX: "uLlF20ProjM00",
  projectionScaleY: "uLlF20ProjM11",
});


export const CLUSTER_SHADING_TEXTURE_UNITS = 3;


export const FRAGMENT_TEXTURE_UNIT_BUDGET = 16;


export const CLUSTER_GRID = Object.freeze({
  tilesX: CL_X,
  tilesY: CL_Y,
  depthSlices: CL_Z,
  cells: CL_TOTAL,
  indexTextureWidth: CL_IDX_TEX_W,
  indexTextureHeight: CL_IDX_TEX_H,
  maxIndexEntries: CL_MAX_INDEX_ENTRIES,
  maxLightsPerCell: CL_MAX_LIGHTS_PER_CELL,
  maxLights: CL_MAX_LIGHTS,
});
