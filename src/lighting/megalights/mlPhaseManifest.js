export const ML_PHASE_MANIFEST = Object.freeze([
  { id: "ML-F1", block: "A", title: "Parity ledger and UE 5.9 cross-check", load: () => import("./phases/mlPhaseF1Ledger.js") },
  { id: "ML-F2", block: "A", title: "Pipeline contract, pass graph, phase registry", load: () => import("./phases/mlPhaseF2Contract.js") },
  { id: "ML-F3", block: "A", title: "Scene inputs: G-buffer, HZB, motion vectors", load: () => import("./phases/mlPhaseF3SceneInputs.js") },
  { id: "ML-F4", block: "B", title: "Light scene data and stable light identifiers", load: () => import("./phases/mlPhaseF4LightSceneData.js") },
  { id: "ML-F5", block: "B", title: "Two-pass froxel light grid with HZB culling", load: () => import("./phases/mlPhaseF5LightGrid.js") },
  { id: "ML-F6", block: "B", title: "Light function atlas and IES atlas", load: () => import("./phases/mlPhaseF6LightFunctionAtlas.js") },
  { id: "ML-F7", block: "B", title: "Area-preserving area light sampling", load: () => import("./phases/mlPhaseF7AreaSampling.js") },
  { id: "ML-F8", block: "C", title: "Spatio-temporal blue noise", load: () => import("./phases/mlPhaseF8BlueNoise.js") },
  { id: "ML-F9", block: "C", title: "Visible light list guiding", load: () => import("./phases/mlPhaseF9VisibleLightList.js") },
  { id: "ML-F10", block: "C", title: "Hidden light sample budget", load: () => import("./phases/mlPhaseF10HiddenLightBudget.js") },
  { id: "ML-F11", block: "C", title: "Light sample generation, weighted reservoir", load: () => import("./phases/mlPhaseF11LightSampleGeneration.js") },
  { id: "ML-F12", block: "C", title: "Downsampled sampling patterns", load: () => import("./phases/mlPhaseF12DownsamplePattern.js") },
  { id: "ML-F13", block: "D", title: "Trace tile classification and compaction", load: () => import("./phases/mlPhaseF13TraceTiles.js") },
  { id: "ML-F14", block: "D", title: "Screen space tracing accelerated by HZB", load: () => import("./phases/mlPhaseF14ScreenTrace.js") },
  { id: "ML-F15", block: "D", title: "Virtual shadow map sampling path", load: () => import("./phases/mlPhaseF15VirtualShadowMap.js") },
  { id: "ML-F16", block: "D", title: "Ray traced occlusion through BVH", load: () => import("./phases/mlPhaseF16RayTrace.js") },
  { id: "ML-F17", block: "D", title: "Hybrid trace policy and ray budget", load: () => import("./phases/mlPhaseF17TracePolicy.js") },
  { id: "ML-F18", block: "E", title: "Sample shading with albedo factored out", load: () => import("./phases/mlPhaseF18SampleShading.js") },
  { id: "ML-F19", block: "E", title: "Stochastic upsample with history fallback", load: () => import("./phases/mlPhaseF19StochasticUpsample.js") },
  { id: "ML-F20", block: "F", title: "Temporal filter and temporal variance", load: () => import("./phases/mlPhaseF20TemporalFilter.js") },
  { id: "ML-F21", block: "F", title: "Sparse rotated spatial filter", load: () => import("./phases/mlPhaseF21SpatialFilter.js") },
  { id: "ML-F22", block: "F", title: "Disocclusion, anti-firefly, shading confidence", load: () => import("./phases/mlPhaseF22Disocclusion.js") },
  { id: "ML-F23", block: "G", title: "Volumetric fog froxel MegaLights", load: () => import("./phases/mlPhaseF23VolumeFroxel.js") },
  { id: "ML-F24", block: "G", title: "World voxel grid with 2-band spherical harmonics", load: () => import("./phases/mlPhaseF24WorldVoxelGrid.js") },
  { id: "ML-F25", block: "G", title: "Hair strands and front layer translucency", load: () => import("./phases/mlPhaseF25HairAndTranslucency.js") },
  { id: "ML-F26", block: "H", title: "Future integration and lite retirement", load: () => import("./phases/mlPhaseF26FutureIntegration.js") },
  { id: "ML-F27", block: "H", title: "Public API, data model, interop", load: () => import("./phases/mlPhaseF27PublicApi.js") },
  { id: "ML-F28", block: "H", title: "Tier budget governor and anti-TDR warmup", load: () => import("./phases/mlPhaseF28TierBudget.js") },
  { id: "ML-F29", block: "H", title: "Performance gates and fixed cost proof", load: () => import("./phases/mlPhaseF29PerfGates.js") },
  { id: "ML-F30", block: "H", title: "Parity certification and blind round", load: () => import("./phases/mlPhaseF30ParityCertification.js") },
]);

export function phaseIds() {
  return ML_PHASE_MANIFEST.map((phase) => phase.id);
}

export function phaseById(phaseId) {
  return ML_PHASE_MANIFEST.find((phase) => phase.id === phaseId) || null;
}

export function phasesInBlock(blockLetter) {
  return ML_PHASE_MANIFEST.filter((phase) => phase.block === blockLetter);
}
