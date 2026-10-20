import { ML_GATE_COMPARISON, isExecutableGate } from "./mlGateComparisonCore.js";
import {
  ML_UNREAL_TARGET_VERSION,
  sourcesVerifyTargetVersion,
  unknownSourceIds,
} from "./mlReferenceSourcesCore.js";

export const ML_PARITY_TERM_STATUS = Object.freeze({


  open: "open",

  inBench: "inBench",

  proven: "proven",

  refused: "refused",
});

const PAPER_AND_DOCUMENTATION = ["siggraph2025Paper", "officialMegaLightsDocumentation"];
const PAPER_DOCUMENTATION_AND_CONSOLE_VARIABLES = [
  "siggraph2025Paper",
  "officialMegaLightsDocumentation",
  "megaLightsConsoleVariables",
];

function parityTerm(definition) {
  const sourceIds = Object.freeze(definition.sourceIds.slice());
  return Object.freeze({
    number: definition.number,
    id: definition.id,
    term: definition.term,
    unrealReference: definition.unrealReference,
    engineToday: definition.engineToday,
    phases: Object.freeze(definition.phases.slice()),


    gate: Object.freeze(Object.assign({ numberFromPlan: true }, definition.gate)),
    sourceIds,

    needsVerification: !sourcesVerifyTargetVersion(sourceIds),
    status: definition.status || ML_PARITY_TERM_STATUS.open,
  });
}

export const ML_PARITY_LEDGER = Object.freeze([
  parityTerm({
    number: 1,
    id: "costIndependentOfLightCount",
    term: "Cost independent of the number of lights",
    unrealReference: "yes, one sample per pixel",
    engineToday: "no: a per-light loop in the fragment shader",
    phases: ["ML-F11", "ML-F29"],
    gate: {
      metric: "frameMillisecondDeviationOneVersusThousandLights",
      comparison: ML_GATE_COMPARISON.withinRelativeTolerance,
      target: 0.15,
      unit: "ratio",
      description: "one light versus one thousand lights, same tier, within 15% of frame milliseconds",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 2,
    id: "samplesPerPixel",
    term: "Samples per pixel",
    unrealReference: "1 to 16, configurable",
    engineToday: "1, fixed",
    phases: ["ML-F11"],
    gate: {
      metric: "honoredSamplesPerPixelConfigurations",
      comparison: ML_GATE_COMPARISON.exactly,
      target: 3,
      unit: "configurations",
      description: "the 1, 2 and 4 settings of NumSamplesPerPixel are all honoured",
    },
    sourceIds: PAPER_DOCUMENTATION_AND_CONSOLE_VARIABLES,
  }),
  parityTerm({
    number: 3,
    id: "downsampleFactor",
    term: "Downsample factor",
    unrealReference: "DownsampleMode",
    engineToday: "none",
    phases: ["ML-F12"],
    gate: {
      metric: "energyDeviationFullVersusHalfResolution",
      comparison: ML_GATE_COMPARISON.withinRelativeTolerance,
      target: 0.03,
      unit: "ratio",
      description: "full and half resolution keep energy parity within 3%",
    },
    sourceIds: PAPER_DOCUMENTATION_AND_CONSOLE_VARIABLES,
  }),
  parityTerm({
    number: 4,
    id: "samplingPattern",
    term: "Sampling pattern",
    unrealReference: "jittered checkerboard and four-rooks",
    engineToday: "per-pixel hash",
    phases: ["ML-F8", "ML-F12"],
    gate: {
      metric: "framesWithoutARepeatedPattern",
      comparison: ML_GATE_COMPARISON.atLeast,
      target: 8,
      unit: "frames",
      description: "blue noise spectrum verified and no fixed pattern across eight frames",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 5,
    id: "sampleWeight",
    term: "Sample weight",
    unrealReference: "Log2Luminance(BRDF) + 1",
    engineToday: "luminance times attenuation, with no BRDF",
    phases: ["ML-F11"],
    gate: {
      metric: "weightErrorAgainstTheReferenceIntegrator",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0.001,
      unit: "absolute error",
      description: "error against the reference integrator stays at or below 1e-3",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 6,
    id: "weightedReservoirSampling",
    term: "Weighted reservoir sampling of N samples",
    unrealReference: "Efraimidis 2006",
    engineToday: "a single pass picking one sample",
    phases: ["ML-F11"],
    gate: {
      metric: "selectionProbabilityDeviationOverOneMillionDraws",
      comparison: ML_GATE_COMPARISON.withinRelativeTolerance,
      target: 0.005,
      unit: "ratio",
      description: "P(i) equals w_i divided by the weight sum within 0.5% over one million draws",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 7,
    id: "visibleLightList",
    term: "Visible light list",
    unrealReference: "8x8 tile, built from the previous frame",
    engineToday: "does not exist",
    phases: ["ML-F9"],
    gate: {
      metric: "energyShareComingFromTheVisibleList",
      comparison: ML_GATE_COMPARISON.atLeast,
      target: 0.8,
      unit: "ratio",
      description: "at least 80% of the energy comes from the list in a static scene",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 8,
    id: "visibleListInterpolation",
    term: "Interpolation between neighbouring lists",
    unrealReference: "stochastic bilinear across four lists",
    engineToday: "not applicable",
    phases: ["ML-F9"],
    gate: {
      metric: "structuralSimilarityOnTheTileBorderCrop",
      comparison: ML_GATE_COMPARISON.atLeast,
      target: 0.99,
      unit: "ssim",
      description: "no visible discontinuity on the tile border crop",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 9,
    id: "hiddenLightBudget",
    term: "Hidden lights",
    unrealReference: "at most 20% of the samples, relaxable",
    engineToday: "not applicable",
    phases: ["ML-F10"],
    gate: {
      metric: "framesToRecoverAStrongHiddenLight",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 4,
      unit: "frames",
      description: "a strong hidden light never dominates and is recovered within four frames",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 10,
    id: "lightGrid",
    term: "Light grid",
    unrealReference: "froxel, coarse plus main, with hierarchical depth culling",
    engineToday: "a single pass cluster without hierarchical depth",
    phases: ["ML-F5"],
    gate: {
      metric: "occludedGridCellsSkippedShare",
      comparison: ML_GATE_COMPARISON.atLeast,
      target: 0.4,
      unit: "ratio",
      description: "at least 40% of the occluded cells are skipped in the corridor scene",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 11,
    id: "packedLightLists",
    term: "Packed light lists",
    unrealReference: "yes",
    engineToday: "float indices",
    phases: ["ML-F5"],
    gate: {
      metric: "packedMemoryShareOfTheUnpackedVersion",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0.25,
      unit: "ratio",
      description: "memory stays at or below a quarter of the unpacked version",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 12,
    id: "sphereAreaSampling",
    term: "Sphere sampling",
    unrealReference: "area preserving, with a probability density function",
    engineToday: "treated as a point",
    phases: ["ML-F7"],
    gate: {
      metric: "meanErrorAgainstTheBruteForceIntegrator",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0.0001,
      unit: "absolute error",
      description: "mean error against the brute force integrator stays at or below 1e-4",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 13,
    id: "rectAreaSampling",
    term: "Rectangle sampling",
    unrealReference: "area preserving, with a probability density function",
    engineToday: "treated as a point",
    phases: ["ML-F7"],
    gate: {
      metric: "meanErrorAgainstTheBruteForceIntegrator",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0.0001,
      unit: "absolute error",
      description: "mean error against the brute force integrator stays at or below 1e-4",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 14,
    id: "tubeAreaSampling",
    term: "Tube and capsule sampling",
    unrealReference: "area preserving, with a probability density function",
    engineToday: "treated as a point",
    phases: ["ML-F7"],
    gate: {
      metric: "meanErrorAgainstTheBruteForceIntegrator",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0.0001,
      unit: "absolute error",
      description: "mean error against the brute force integrator stays at or below 1e-4",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 15,
    id: "areaGuidingBitmask",
    term: "Two by two area guiding bitmask",
    unrealReference: "yes",
    engineToday: "not applicable",
    phases: ["ML-F7", "ML-F9"],
    gate: {
      metric: "varianceShareOfUniformSampling",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0.6,
      unit: "ratio",
      description: "variance stays at or below 60% of uniform sampling",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 16,
    id: "lightFunctionAtlas",
    term: "IES and light function atlas",
    unrealReference: "a single atlas",
    engineToday: "per light, with a ceiling of eight",
    phases: ["ML-F6"],
    gate: {
      metric: "profilesStoredInASingleAtlas",
      comparison: ML_GATE_COMPARISON.atLeast,
      target: 64,
      unit: "profiles",
      description: "at least 64 profiles in the atlas, costing one texture unit",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 17,
    id: "texturedRectLights",
    term: "Textured rectangle lights",
    unrealReference: "yes",
    engineToday: "no",
    phases: ["ML-F6"],
    gate: {
      metric: "rectSamplesIgnoringTheSourceTexture",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0,
      unit: "samples",
      description: "the source texture is read at the drawn sample, never approximated",
    },
    sourceIds: PAPER_DOCUMENTATION_AND_CONSOLE_VARIABLES,
  }),
  parityTerm({
    number: 18,
    id: "traceTileClassification",
    term: "Trace tile classification",
    unrealReference: "16x16 tiles, compacted between stages",
    engineToday: "not applicable",
    phases: ["ML-F13"],
    gate: {
      metric: "emptyTraceTilesSkippedShare",
      comparison: ML_GATE_COMPARISON.atLeast,
      target: 0.5,
      unit: "ratio",
      description: "at least half of the empty tiles are skipped",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 19,
    id: "screenSpaceTracing",
    term: "Screen space tracing",
    unrealReference: "guided by a hierarchical depth buffer",
    engineToday: "a linear march of sixteen steps",
    phases: ["ML-F14"],
    gate: {
      metric: "averageStepReductionFromHierarchicalDepth",
      comparison: ML_GATE_COMPARISON.atLeast,
      target: 0.4,
      unit: "ratio",
      description: "the hierarchical depth buffer cuts average steps by at least 40%",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 20,
    id: "virtualShadowMapSampling",
    term: "Virtual shadow map sampling",
    unrealReference: "virtual pages",
    engineToday: "the shadow atlas exists but is dormant",
    phases: ["ML-F15"],
    gate: {
      metric: "dormantShadowAtlasHooks",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0,
      unit: "hooks",
      description: "the atlas is awake and its shadow reaches the drawn sample",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 21,
    id: "rayTracedOcclusion",
    term: "Ray traced occlusion",
    unrealReference: "hardware ray tracing",
    engineToday: "an isolated point ray tracing path",
    phases: ["ML-F16"],
    gate: {
      metric: "visibilityDeviationAgainstScreenTrace",
      comparison: ML_GATE_COMPARISON.withinAbsoluteTolerance,
      target: 0.05,
      unit: "visibility",
      description: "the bounding volume hierarchy resolves off-screen samples within 0.05 of the screen trace",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 22,
    id: "traceArbitration",
    term: "Arbitration between screen, shadow map and ray tracing",
    unrealReference: "a policy plus compaction",
    engineToday: "not applicable",
    phases: ["ML-F17"],
    gate: {
      metric: "raysPerPixelOnTheWeakTier",
      comparison: ML_GATE_COMPARISON.exactly,
      target: 1,
      unit: "rays",
      description: "exactly one ray per pixel on the weak tier, with no visibility hole",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 23,
    id: "shadeOnlyVisibleSamples",
    term: "Shading only of visible samples",
    unrealReference: "yes",
    engineToday: "darkens everything",
    phases: ["ML-F18"],
    gate: {
      metric: "shadedOccludedSamples",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0,
      unit: "samples",
      description: "the counter of shaded occluded samples reads zero",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 24,
    id: "diffuseAndSpecularSeparated",
    term: "Diffuse and specular kept separate",
    unrealReference: "yes",
    engineToday: "no",
    phases: ["ML-F18"],
    gate: {
      metric: "energyDeviationAgainstTheForwardPath",
      comparison: ML_GATE_COMPARISON.withinRelativeTolerance,
      target: 0.03,
      unit: "ratio",
      description: "two buffers, with energy within 3% of the forward path",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 25,
    id: "albedoAndEnvironmentBrdfFactoredOut",
    term: "Albedo and environment BRDF factored out",
    unrealReference: "Zhuang 2021",
    engineToday: "no",
    phases: ["ML-F18"],
    gate: {
      metric: "checkerboardAlbedoBleedFailures",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0,
      unit: "failures",
      description: "the denoiser does not bleed albedo in the checkerboard test",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 26,
    id: "stochasticBilinearUpsample",
    term: "Stochastic bilinear upsample",
    unrealReference: "weighted by depth and normal",
    engineToday: "not applicable",
    phases: ["ML-F19"],
    gate: {
      metric: "upsampleHolePixels",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0,
      unit: "pixels",
      description: "a failed upsample falls back to history and leaves no hole",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 27,
    id: "singleDenoiserForEveryLight",
    term: "One denoiser for every light",
    unrealReference: "a single pass",
    engineToday: "reuses the shadow denoiser",
    phases: ["ML-F20", "ML-F21"],
    gate: {
      metric: "denoisePassCount",
      comparison: ML_GATE_COMPARISON.exactly,
      target: 2,
      unit: "passes",
      description: "one temporal pass plus one spatial pass, both measured",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 28,
    id: "temporalVariance",
    term: "Temporal variance",
    unrealReference: "yes, in the manner of SVGF",
    engineToday: "no",
    phases: ["ML-F20"],
    gate: {
      metric: "varianceDeviationAgainstTheOfflineReference",
      comparison: ML_GATE_COMPARISON.withinRelativeTolerance,
      target: 0.05,
      unit: "ratio",
      description: "variance matches the offline reference within 5%",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 29,
    id: "sparseRotatedSpatialFilter",
    term: "Sparse spatial filter, rotated per pixel",
    unrealReference: "a single pass",
    engineToday: "the A-Trous filter of the shadow denoiser",
    phases: ["ML-F21"],
    gate: {
      metric: "spatialFilterPassCount",
      comparison: ML_GATE_COMPARISON.exactly,
      target: 1,
      unit: "passes",
      description: "one pass, filtering only where relative variance is high",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 30,
    id: "edgeStoppingFunctions",
    term: "SVGF edge stopping",
    unrealReference: "depth, normal and variance",
    engineToday: "partial",
    phases: ["ML-F21"],
    gate: {
      metric: "silhouetteLeakPixels",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0,
      unit: "pixels",
      description: "light does not leak across a silhouette in the edge test",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 31,
    id: "disocclusionHandling",
    term: "Disocclusion handled for four frames",
    unrealReference: "tonemapped, with more samples and a fade",
    engineToday: "no",
    phases: ["ML-F22"],
    gate: {
      metric: "fireflyLuminanceRatioUnderForcedDisocclusion",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0.001,
      unit: "ratio",
      description: "fireflies stay at or below 1e-3 of the mean luminance during disocclusion",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 32,
    id: "shadingConfidenceForUpscaler",
    term: "Shading confidence handed to the temporal upscaler",
    unrealReference: "share of energy coming from the visible list",
    engineToday: "not applicable",
    phases: ["ML-F22"],
    gate: {
      metric: "correlationBetweenConfidenceAndError",
      comparison: ML_GATE_COMPARISON.atLeast,
      target: 0.7,
      unit: "correlation",
      description: "confidence correlates with the measured error at r of 0.7 or better",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 33,
    id: "volumetricFogFroxel",
    term: "Volumetric fog froxels",
    unrealReference: "stochastic injection",
    engineToday: "analytic injection",
    phases: ["ML-F23"],
    gate: {
      metric: "spotShaftsWithoutRealOcclusion",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0,
      unit: "shafts",
      description: "a spot light shaft is genuinely occluded, not faded",
    },
    sourceIds: PAPER_DOCUMENTATION_AND_CONSOLE_VARIABLES,
  }),
  parityTerm({
    number: 34,
    id: "worldVoxelSphericalHarmonics",
    term: "World voxel grid with spherical harmonics",
    unrealReference: "two bands, for translucents and particles",
    engineToday: "not applicable",
    phases: ["ML-F24"],
    gate: {
      metric: "sphericalHarmonicBandsStoredAndRead",
      comparison: ML_GATE_COMPARISON.exactly,
      target: 2,
      unit: "bands",
      description: "two bands are written and read back",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 35,
    id: "sharedSamplingAndTracing",
    term: "Sampling and tracing shared with the volume",
    unrealReference: "hybrid, saving roughly a quarter of the work",
    engineToday: "not applicable",
    phases: ["ML-F24"],
    gate: {
      metric: "measuredSavingFromSharingWithTheVolume",
      comparison: ML_GATE_COMPARISON.atLeast,
      target: 0.15,
      unit: "ratio",
      description: "the measured saving is at least 15%",
    },
    sourceIds: PAPER_DOCUMENTATION_AND_CONSOLE_VARIABLES,
  }),
  parityTerm({
    number: 36,
    id: "uniformWeightsInTranslucency",
    term: "Uniform weights in translucency",
    unrealReference: "the maximum of the phase function and the BRDF",
    engineToday: "not applicable",
    phases: ["ML-F24"],
    gate: {
      metric: "temporalInstabilityRatioWithAMovingCamera",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0.05,
      unit: "ratio",



      numberFromPlan: false,
      description: "stability with a moving camera: temporal instability stays at or below 5%",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 37,
    id: "hairStrands",
    term: "Hair strands",
    unrealReference: "HairStrands scalability keys",
    engineToday: "not applicable",
    phases: ["ML-F25"],
    gate: {
      metric: "hairStrandsLitByASeparatePath",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0,
      unit: "paths",
      description: "hair is lit by the same sampling path as everything else",
    },
    sourceIds: PAPER_DOCUMENTATION_AND_CONSOLE_VARIABLES,
  }),
  parityTerm({
    number: 38,
    id: "frontLayerTranslucency",
    term: "Front layer translucency",
    unrealReference: "SpecularOnly, SoftShadows and TexturedRectLights",
    engineToday: "not applicable",
    phases: ["ML-F25"],
    gate: {
      metric: "honoredScalabilityKeys",
      comparison: ML_GATE_COMPARISON.exactly,
      target: 3,
      unit: "keys",
      description: "the three scalability keys are all honoured",
    },
    sourceIds: PAPER_DOCUMENTATION_AND_CONSOLE_VARIABLES,
  }),
  parityTerm({
    number: 39,
    id: "onScreenLightCeiling",
    term: "Ceiling of lights on screen",
    unrealReference: "941 measured",
    engineToday: "128",
    phases: ["ML-F4", "ML-F29"],
    gate: {
      metric: "simultaneousAreaLightsOnTheStrongTier",
      comparison: ML_GATE_COMPARISON.atLeast,
      target: 512,
      unit: "lights",
      description: "at least 512 simultaneous area lights on the strong tier without breaking the cost gate",
    },
    sourceIds: PAPER_AND_DOCUMENTATION,
  }),
  parityTerm({
    number: 40,
    id: "megaLightsIsTheBaseOfFuture",
    term: "MegaLights is the base of the Future path",
    unrealReference: "yes",
    engineToday: "no",
    phases: ["ML-F26"],
    gate: {
      metric: "futurePathsNotRoutedThroughMegaLights",
      comparison: ML_GATE_COMPARISON.atMost,
      target: 0,
      unit: "paths",
      description: "selecting the Future technology routes every light through the new path",
    },
    sourceIds: PAPER_DOCUMENTATION_AND_CONSOLE_VARIABLES,
  }),
]);

export function listParityTerms() {
  return ML_PARITY_LEDGER;
}

export function parityTermByNumber(termNumber) {
  return ML_PARITY_LEDGER.find((term) => term.number === termNumber) || null;
}

export function parityTermById(termId) {
  return ML_PARITY_LEDGER.find((term) => term.id === termId) || null;
}

export function parityTermsForPhase(phaseId) {
  return ML_PARITY_LEDGER.filter((term) => term.phases.indexOf(phaseId) >= 0);
}

export function termsNeedingVerification() {
  return ML_PARITY_LEDGER.filter((term) => term.needsVerification);
}

export function termsWithoutOwningPhase() {
  return ML_PARITY_LEDGER.filter((term) => term.phases.length === 0);
}

export function termsWithoutExecutableGate() {
  return ML_PARITY_LEDGER.filter((term) => !isExecutableGate(term.gate));
}

export function termsWithUnknownSource() {
  return ML_PARITY_LEDGER.filter(
    (term) => term.sourceIds.length === 0 || unknownSourceIds(term.sourceIds).length > 0,
  );
}

export function termsWithStatus(status) {
  return ML_PARITY_LEDGER.filter((term) => term.status === status);
}

export function parityLedgerSummary() {
  const totalTerms = ML_PARITY_LEDGER.length;
  return {
    totalTerms,
    withOwningPhase: totalTerms - termsWithoutOwningPhase().length,
    withExecutableGate: totalTerms - termsWithoutExecutableGate().length,
    withKnownSource: totalTerms - termsWithUnknownSource().length,
    needingVerification: termsNeedingVerification().length,
    gateTargetsProposedByTheBench: ML_PARITY_LEDGER.filter((term) => !term.gate.numberFromPlan).length,
    open: termsWithStatus(ML_PARITY_TERM_STATUS.open).length,
    inBench: termsWithStatus(ML_PARITY_TERM_STATUS.inBench).length,
    proven: termsWithStatus(ML_PARITY_TERM_STATUS.proven).length,
    refused: termsWithStatus(ML_PARITY_TERM_STATUS.refused).length,
    targetUnrealVersion: ML_UNREAL_TARGET_VERSION,
  };
}


export function authorizePhaseCompletion(phaseId) {
  const terms = parityTermsForPhase(phaseId);
  const blockingReasons = [];

  if (terms.length === 0) {
    blockingReasons.push("no parity term names " + phaseId + " as an owner");
  }

  terms.forEach((term) => {
    if (term.status !== ML_PARITY_TERM_STATUS.proven) {
      blockingReasons.push("term " + term.number + " (" + term.id + ") is " + term.status + ", not proven");
    }
    if (term.needsVerification) {
      blockingReasons.push(
        "term " + term.number + " (" + term.id + ") has no source verified against Unreal " + ML_UNREAL_TARGET_VERSION,
      );
    }
  });

  return {
    phaseId,
    authorized: blockingReasons.length === 0,
    termNumbers: terms.map((term) => term.number),
    blockingReasons,
  };
}
