import { ML_PHASE_MANIFEST } from "../mlPhaseManifest.js";
import { MGL_PASSES, MGL_PASS_OWNER } from "../mlPipelineContract.js";
import { GBUFFER_CHANNEL_LAYOUT } from "../mlGBufferPackingCore.js";

export const DEBUG_BUFFER_MODES = Object.freeze([
  {
    id: "sceneDepth",
    owner: "ML-F3",
    title: "Linear depth",
    encoding: "depth",
    channels: GBUFFER_CHANNEL_LAYOUT.sceneDepth,
  },
  {
    id: "sceneNormal",
    owner: "ML-F3",
    title: "World normals",
    encoding: "rgb",
    channels: GBUFFER_CHANNEL_LAYOUT.sceneNormal,
  },
  { id: "roughness", owner: "ML-F3", title: "Roughness", encoding: "alpha" },
  {
    id: "sceneAlbedo",
    owner: "ML-F3",
    title: "Albedo",
    encoding: "radiance",
    channels: GBUFFER_CHANNEL_LAYOUT.sceneAlbedo,
  },
  { id: "metalness", owner: "ML-F3", title: "Metalness", encoding: "alpha" },
  {
    id: "sceneVelocity",
    owner: "ML-F3",
    title: "Motion vectors",
    encoding: "velocity",
    channels: GBUFFER_CHANNEL_LAYOUT.sceneVelocity,
  },
  {
    id: "coverage",
    owner: "ML-F3",
    title: "Geometry coverage",
    encoding: "alpha",
  },
  {
    id: "hierarchicalDepth",
    owner: "ML-F3",
    title: "HZB level / min depth",
    encoding: "depth",
  },
  {
    id: "hzbMaximum",
    owner: "ML-F3",
    title: "HZB level / max depth",
    encoding: "green",
  },
  {
    id: "packedLights",
    owner: "ML-F4",
    title: "Packed light records",
    encoding: "heat",
  },
  {
    id: "lightGridMain",
    owner: "ML-F5",
    title: "Light-grid cells",
    encoding: "heat",
  },
  {
    id: "lightGridCoarse",
    owner: "ML-F5",
    title: "Coarse grid",
    encoding: "heat",
  },
  {
    id: "lightFunctionAtlas",
    owner: "ML-F6",
    title: "Cookie / IES atlas",
    encoding: "rgb",
  },
  {
    id: "blueNoise",
    owner: "ML-F8",
    title: "Spatio-temporal noise",
    encoding: "rgb",
  },
  {
    id: "visibleLightList",
    owner: "ML-F9",
    title: "Guided light IDs",
    encoding: "id",
  },
  {
    id: "lightSamples",
    owner: "ML-F11",
    title: "Sampled light IDs",
    encoding: "id",
  },
  {
    id: "sampleWeights",
    owner: "ML-F11",
    title: "Reservoir weights",
    encoding: "green",
  },
  {
    id: "traceTileList",
    owner: "ML-F13",
    title: "Compacted trace tiles",
    encoding: "blue",
  },
  {
    id: "sampleVisibility",
    owner: "ML-F17",
    title: "Visibility / unresolved",
    encoding: "visibility",
  },
  {
    id: "shadedDiffuse",
    owner: "ML-F18",
    title: "Raw diffuse",
    encoding: "radiance",
  },
  {
    id: "shadedSpecular",
    owner: "ML-F18",
    title: "Raw specular",
    encoding: "radiance",
  },
  {
    id: "upsampledShading",
    owner: "ML-F19",
    title: "Upsampled radiance",
    encoding: "radiance",
  },
  {
    id: "historyDiffuse",
    owner: "ML-F20",
    title: "Temporal diffuse",
    encoding: "radiance",
  },
  {
    id: "historySpecular",
    owner: "ML-F20",
    title: "Temporal specular",
    encoding: "radiance",
  },
  {
    id: "temporalVariance",
    owner: "ML-F20",
    title: "Temporal variance",
    encoding: "heat",
  },
  {
    id: "historyLength",
    owner: "ML-F20",
    title: "History length",
    encoding: "heat",
  },
  {
    id: "spatialDiffuse",
    owner: "ML-F21",
    title: "Spatially filtered diffuse",
    encoding: "radiance",
  },
  {
    id: "spatialSpecular",
    owner: "ML-F21",
    title: "Spatially filtered specular",
    encoding: "radiance",
  },
  {
    id: "shadingConfidence",
    owner: "ML-F22",
    title: "Shading confidence",
    encoding: "heat",
  },
  {
    id: "volumeFroxel",
    owner: "ML-F23",
    title: "Volume slice",
    encoding: "radiance",
  },
  {
    id: "worldVoxelSh",
    owner: "ML-F24",
    title: "World voxel slice",
    encoding: "radiance",
  },
]);

export const DEBUG_PHASES = Object.freeze(
  ML_PHASE_MANIFEST.map(({ id, title, block }) => ({
    id,
    title,
    block,
    passes: MGL_PASSES.filter((pass) => MGL_PASS_OWNER[pass] === id),
    modes: DEBUG_BUFFER_MODES.filter((mode) => mode.owner === id).map(
      (mode) => mode.id,
    ),
  })),
);

export const DEBUG_LIMITATIONS = Object.freeze([
  "CPU reference results are not a complete GPU implementation or a GPU performance certification.",
  "An installed phase or an executed pass is not evidence of a ready output. Missing data stays BLOCKED.",
  "A lit image can come from the legacy renderer or MegaLights-lite. Inspect the composition gate and compare captures.",
  "F3 currently omits transparent and skinned geometry; instanced velocity has no per-instance history.",
  "The actual F3 channel packing differs from older reserved layouts: roughness is normal.a; metalness is albedo.a.",
  "F7 GPU area resolution and F17 GPU visibility have declared limitations. UNKNOWN visibility must not be called visible.",
  "The F18 reference path reads back a bounded surface lattice. Its coverage and denoised one-frame latch must be inspected.",
  "Physical-GPU timings, cross-device image parity and UE reference comparisons require separate measured evidence.",
]);
