import { isKnownPhaseId } from "./msmPhaseRosterCore.js";
import { listVerdictGates, verdictGateByPlanId } from "./msmVerdictGatesCore.js";

export const MSM_SECTION_3_CONCEPT_COUNT = 26;

export const MSM_AMBITION_STATUS = Object.freeze({


  open: "open",

  inProgress: "inProgress",

  proven: "proven",

  refused: "refused",
});

function ambitionEntry(definition) {
  return Object.freeze({
    number: definition.number,
    id: definition.id,
    concept: definition.concept,
    originalBehavior: definition.originalBehavior,
    msmDecision: definition.msmDecision,
    reason: definition.reason,
    owningPhaseIds: Object.freeze(definition.owningPhaseIds.slice()),
    gatePlanIds: Object.freeze((definition.gatePlanIds || []).slice()),


    residualNumbers: Object.freeze((definition.residualNumbers || []).slice()),
    status: definition.status || MSM_AMBITION_STATUS.open,
    refusalReason: definition.refusalReason || null,
  });
}

export const MSM_AMBITION_LEDGER = Object.freeze([
  ambitionEntry({
    number: 1,
    id: "computeShaderReplacedByFullscreenPasses",
    concept: "Compute shader, atomics and indirect dispatch",
    originalBehavior: "the whole algorithm lives in compute shaders with atomics and indirect dispatch",
    msmDecision: "fullscreen passes over textures assembled on the CPU",
    reason: "WebGL2 has no compute shader, and the engine already ships every other feature this way",
    owningPhaseIds: ["MSM-F2", "MSM-F22"],
    gatePlanIds: ["G3"],
  }),
  ambitionEntry({
    number: 2,
    id: "twoDeliveryModes",
    concept: "Replaces the shading and the shadowing of every light",
    originalBehavior: "one path substitutes shading and shadowing at once",
    msmDecision: "two modes: A) shadow only, multiplicative, and B) additive irradiance with the lights removed from the forward loop",
    reason: "mode A already gives a shadow to lights that have none today, at a fraction of the risk",
    owningPhaseIds: ["MSM-F22", "MSM-F24"],
    gatePlanIds: ["G13", "G4"],
  }),
  ambitionEntry({
    number: 3,
    id: "fixedDownsampleDivisorPerTier",
    concept: "Downsample factor",
    originalBehavior: "configurable, 1x or 2x",
    msmDecision: "a fixed divisor per tier: 2 on lite and low, 4 on micro",
    reason: "quarter resolution is the house default on a weak GPU, and cost is the first restriction of this plan",
    owningPhaseIds: ["MSM-F3", "MSM-F12", "MSM-F23"],
    gatePlanIds: ["G3", "G2"],
  }),
  ambitionEntry({
    number: 4,
    id: "worldSpaceLightGrid",
    concept: "Spatial structure of the light scene",
    originalBehavior: "a view space froxel grid rebuilt every frame",
    msmDecision: "a world space grid snapped to whole cells, rebuilt only when a light changes or the camera crosses a cell",
    reason: "turning the camera costs zero rebuild, and an idle scene rebuilds nothing at all",
    owningPhaseIds: ["MSM-F8", "MSM-F4", "MSM-F10"],
    gatePlanIds: ["G8", "G1"],
  }),
  ambitionEntry({
    number: 5,
    id: "importanceOrderedCellLists",
    concept: "Light list per region of space",
    originalBehavior: "visible light list per tile with stochastic bilinear interpolation between four lists",
    msmDecision: "one list per world cell, ordered by importance on the CPU, plus a fairness cursor",
    reason: "ordering on the CPU is free for the shader, and the cursor keeps the weakest light from disappearing forever",
    owningPhaseIds: ["MSM-F8", "MSM-F14", "MSM-F15"],
    gatePlanIds: ["G14"],
  }),
  ambitionEntry({
    number: 6,
    id: "cheapSpatioTemporalBlueNoise",
    concept: "Blue noise for the stochastic choice",
    originalBehavior: "a 3D spatio-temporal blue noise texture",
    msmDecision: "an STBN-lite of 64 by 64 in RGBA8 with eight slices, generated once at boot",
    reason: "it fits the texture unit ceiling and costs one small upload instead of an asset",
    owningPhaseIds: ["MSM-F11"],
    gatePlanIds: ["G10"],
  }),
  ambitionEntry({
    number: 7,
    id: "scalarSampleWeight",
    concept: "Weight of the sample",
    originalBehavior: "log2 of the luminance of the BRDF plus one",
    msmDecision: "luminance times falloff times saturate of N dot L plus 0.2, scalar, with a cut threshold",
    reason: "a scalar weight is measurable in Node and cheap enough to run per cell on a weak GPU",
    owningPhaseIds: ["MSM-F13"],
    gatePlanIds: ["G4"],
  }),
  ambitionEntry({
    number: 8,
    id: "normalReconstructedFromDepth",
    concept: "Surface inputs",
    originalBehavior: "normal and roughness read from the G-buffer",
    msmDecision: "normal reconstructed from the shared depth in three taps",
    reason: "this engine is forward rendered, so there is no G-buffer to read",
    owningPhaseIds: ["MSM-F5"],
    gatePlanIds: ["G4"],
    residualNumbers: [4],
  }),
  ambitionEntry({
    number: 9,
    id: "noTraceTileClassification",
    concept: "Trace tile classification and compaction",
    originalBehavior: "16 by 16 tiles classified and compacted before tracing",
    msmDecision: "no classification: the quarter resolution pass IS the reduction, with an early out on empty cells",
    reason: "compaction without compute shaders would cost more than it saves at this resolution",
    owningPhaseIds: ["MSM-F9", "MSM-F12"],
    gatePlanIds: ["G1", "G3"],
  }),
  ambitionEntry({
    number: 10,
    id: "fixedStepScreenTrace",
    concept: "Screen space trace",
    originalBehavior: "a screen trace accelerated by the hierarchical depth buffer",
    msmDecision: "a march with a fixed number of steps, three to eight per tier, over the shared half resolution depth",
    reason: "a fixed step count is what makes the cost of a pixel predictable, which is the whole promise of the port",
    owningPhaseIds: ["MSM-F18"],
    gatePlanIds: ["G1"],
  }),
  ambitionEntry({
    number: 11,
    id: "physicalAtlasPagesInRotation",
    concept: "Shadow map for what the screen cannot see",
    originalBehavior: "virtual shadow map pages",
    msmDecision: "pages of the existing physical atlas with a scheduler of one to two re-renders per frame",
    reason: "the atlas is already built and paid for; what was missing was a fair rotation",
    owningPhaseIds: ["MSM-F16", "MSM-F17"],
    gatePlanIds: ["G14", "G8"],
  }),
  ambitionEntry({
    number: 12,
    id: "proxyOcclusionInsteadOfRayTracing",
    concept: "Occlusion of what is outside the screen and outside the atlas",
    originalBehavior: "hardware ray tracing",
    msmDecision: "a slab test against up to eight boxes of the largest occluders",
    reason: "there is no ray tracing in WebGL2, and eight boxes catch the occluders that matter",
    owningPhaseIds: ["MSM-F19"],
    gatePlanIds: ["G5"],
    residualNumbers: [5],
  }),
  ambitionEntry({
    number: 13,
    id: "oneVisibilitySourcePerSample",
    concept: "Arbitration between visibility sources",
    originalBehavior: "three sources arbitrated dynamically per sample",
    msmDecision: "exactly one source per sample, chosen by a static priority: atlas, then screen, then proxy",
    reason: "one source per sample is what keeps the tap count per pixel constant regardless of the light count",
    owningPhaseIds: ["MSM-F20"],
    gatePlanIds: ["G1"],
  }),
  ambitionEntry({
    number: 14,
    id: "denoiserInsideTheBudget",
    concept: "Denoiser",
    originalBehavior: "a full spatio-temporal denoiser in the SVGF family",
    msmDecision: "one temporal tap plus a five tap spatial filter behind a relative variance gate",
    reason: "a full denoiser would eat the whole millisecond budget of the weak tier by itself",
    owningPhaseIds: ["MSM-F26", "MSM-F28"],
    gatePlanIds: ["G3", "G4", "G7"],
  }),
  ambitionEntry({
    number: 15,
    id: "cameraOnlyReprojection",
    concept: "Reprojection of the history",
    originalBehavior: "per object motion vectors",
    msmDecision: "camera only reprojection plus a dirt pulse when an object moves",
    reason: "there are no motion vectors in this engine, and the pulse pays for the missing ones where it matters",
    owningPhaseIds: ["MSM-F26", "MSM-F4"],
    gatePlanIds: ["G6"],
  }),
  ambitionEntry({
    number: 16,
    id: "convergeAndFreeze",
    concept: "Temporal accumulation",
    originalBehavior: "accumulation that never stops",
    msmDecision: "adaptive alpha of 0.5, then 0.1, then zero, and the pass leaves the frame queue",
    reason: "a still scene must cost nothing; accumulating forever is how a weak GPU dies at idle",
    owningPhaseIds: ["MSM-F27", "MSM-F30"],
    gatePlanIds: ["G8", "G6"],
  }),
  ambitionEntry({
    number: 17,
    id: "byteHistoryInsteadOfFloatHistory",
    concept: "Format of the history buffer",
    originalBehavior: "half float history",
    msmDecision: "RGBA8 history with a global scale",
    reason: "one byte per channel keeps the memory ceiling and half float support is not guaranteed on the target machines",
    owningPhaseIds: ["MSM-F26"],
    gatePlanIds: ["G10"],
  }),
  ambitionEntry({
    number: 18,
    id: "diffuseOnlyIrradiance",
    concept: "Diffuse and specular",
    originalBehavior: "separate diffuse and specular buffers",
    msmDecision: "diffuse irradiance only; specular stays with the resident set on the classic path",
    reason: "a second buffer would double the bandwidth for the part of the image the eye forgives most",
    owningPhaseIds: ["MSM-F25"],
    gatePlanIds: ["G4"],
    residualNumbers: [3],
  }),
  ambitionEntry({
    number: 19,
    id: "albedoFactoredByForwardInjection",
    concept: "Albedo factored out of the denoiser",
    originalBehavior: "albedo and the environment BRDF factored out before denoising",
    msmDecision: "irradiance is injected into the forward material and multiplied there by the material own diffuse colour",
    reason: "the material already knows its albedo, so the buffer stays albedo free and the filter stays honest",
    owningPhaseIds: ["MSM-F24"],
    gatePlanIds: ["G13"],
  }),
  ambitionEntry({
    number: 20,
    id: "lightTreatedAsAPoint",
    concept: "Area lights",
    originalBehavior: "area preserving sampling with an explicit probability density",
    msmDecision: "the light is treated as a point, with an MRP-lite through the already paid LTC only on the medium tier",
    reason: "area sampling per pixel is out of budget; the point approximation is visible only up close",
    owningPhaseIds: ["MSM-F25"],
    gatePlanIds: ["G4"],
    residualNumbers: [1],
  }),
  ambitionEntry({
    number: 21,
    id: "cookiesOnlyForTheResidentSet",
    concept: "Light functions, cookies and IES profiles",
    originalBehavior: "a light function atlas and an IES atlas",
    msmDecision: "cookies and IES only for the resident set, on the classic path",
    reason: "two more atlases would cross the texture unit ceiling that gate G10 defends",
    owningPhaseIds: ["MSM-F7"],
    gatePlanIds: ["G10"],
    residualNumbers: [2],
  }),
  ambitionEntry({
    number: 22,
    id: "noVolumetricHairOrTranslucency",
    concept: "Volumetric fog, hair and translucency sharing the same sampling",
    originalBehavior: "the same light sampling serves volumetrics, hair and translucency",
    msmDecision: "none of it",
    reason: "another scope, another plan: this one buys shadow and irradiance for many lights on a weak GPU",
    owningPhaseIds: ["MSM-F1"],
    gatePlanIds: [],
    status: MSM_AMBITION_STATUS.refused,
    refusalReason: "declared out of scope in section 12; a concept with no gate must be a written refusal, not a silence",
    residualNumbers: [12],
  }),
  ambitionEntry({
    number: 23,
    id: "twoHundredFiftyFiveLightCeiling",
    concept: "Number of lights",
    originalBehavior: "hundreds of area lights measured in the reference",
    msmDecision: "255 lights with an eight bit index, 128 on the micro tier",
    reason: "an eight bit index keeps the light list in a byte texture, which is what a weak GPU can afford to read",
    owningPhaseIds: ["MSM-F6"],
    gatePlanIds: ["G1"],
    residualNumbers: [8],
  }),
  ambitionEntry({
    number: 24,
    id: "convergenceRatioInsteadOfShadingConfidence",
    concept: "Confidence signal exported to the upscaler",
    originalBehavior: "a shading confidence buffer consumed by the temporal super resolution",
    msmDecision: "a convergence ratio published in telemetry and consumed by the temporal alpha and by the governor",
    reason: "there is no TSR here, but the same number is what tells the governor whether it may buy quality back",
    owningPhaseIds: ["MSM-F27", "MSM-F33"],
    gatePlanIds: ["G6"],
  }),
  ambitionEntry({
    number: 25,
    id: "predictabilityInsteadOfConsoleVariables",
    concept: "Configuration surface",
    originalBehavior: "dozens of console variables",
    msmDecision: "one tri-state property, a table per tier and a sell ladder with a fixed order",
    reason: "on a weak GPU predictability is worth more than freedom; a fixed ladder is reviewable, a matrix of cvars is not",
    owningPhaseIds: ["MSM-F3", "MSM-F31", "MSM-F33"],
    gatePlanIds: ["G3", "G9", "G12"],
  }),
  ambitionEntry({
    number: 26,
    id: "pulsedResidentSetChanges",
    concept: "Changing which lights take part",
    originalBehavior: "the light set of a frame is whatever the frame needs",
    msmDecision: "a resident set with hysteresis, changed in pulses and in slices",
    reason: "changing the light count recompiles the program in three; a recompile storm on a weak GPU is a driver reset",
    owningPhaseIds: ["MSM-F7", "MSM-F32"],
    gatePlanIds: ["G11"],
  }),
]);

export function listAmbitionEntries() {
  return MSM_AMBITION_LEDGER;
}

export function ambitionEntryByNumber(entryNumber) {
  return MSM_AMBITION_LEDGER.find((entry) => entry.number === entryNumber) || null;
}

export function ambitionEntryById(entryId) {
  return MSM_AMBITION_LEDGER.find((entry) => entry.id === entryId) || null;
}

export function ambitionEntriesForPhase(phaseId) {
  return MSM_AMBITION_LEDGER.filter((entry) => entry.owningPhaseIds.indexOf(phaseId) >= 0);
}

export function ambitionEntriesCitingGate(planId) {
  return MSM_AMBITION_LEDGER.filter((entry) => entry.gatePlanIds.indexOf(planId) >= 0);
}

export function ambitionEntriesWithStatus(status) {
  return MSM_AMBITION_LEDGER.filter((entry) => entry.status === status);
}

function isRefused(entry) {
  return entry.status === MSM_AMBITION_STATUS.refused;
}






export function ambitionLedgerCoverage() {
  const gates = listVerdictGates();
  const citedPlanIds = [];
  MSM_AMBITION_LEDGER.forEach((entry) => {
    entry.gatePlanIds.forEach((planId) => {
      if (citedPlanIds.indexOf(planId) < 0) {
        citedPlanIds.push(planId);
      }
    });
  });

  const entriesWithoutOwningPhase = MSM_AMBITION_LEDGER.filter((entry) => entry.owningPhaseIds.length === 0).map((entry) => entry.number);
  const entriesWithUnknownPhase = MSM_AMBITION_LEDGER.filter(
    (entry) => entry.owningPhaseIds.some((phaseId) => !isKnownPhaseId(phaseId)),
  ).map((entry) => entry.number);
  const entriesWithoutGateOrRefusal = MSM_AMBITION_LEDGER.filter(
    (entry) => entry.gatePlanIds.length === 0 && !(isRefused(entry) && !!entry.refusalReason),
  ).map((entry) => entry.number);
  const entriesWithUnknownGate = MSM_AMBITION_LEDGER.filter(
    (entry) => entry.gatePlanIds.some((planId) => !verdictGateByPlanId(planId)),
  ).map((entry) => entry.number);
  const gatesNeverCited = gates.filter((gate) => citedPlanIds.indexOf(gate.planId) < 0).map((gate) => gate.planId);

  return {
    totalEntries: MSM_AMBITION_LEDGER.length,
    declaredByThePlan: MSM_SECTION_3_CONCEPT_COUNT,
    totalGates: gates.length,
    entriesWithoutOwningPhase,
    entriesWithUnknownPhase,
    entriesWithoutGateOrRefusal,
    entriesWithUnknownGate,
    gatesNeverCited,
    complete:
      MSM_AMBITION_LEDGER.length === MSM_SECTION_3_CONCEPT_COUNT &&
      entriesWithoutOwningPhase.length === 0 &&
      entriesWithUnknownPhase.length === 0 &&
      entriesWithoutGateOrRefusal.length === 0 &&
      entriesWithUnknownGate.length === 0 &&
      gatesNeverCited.length === 0,
  };
}

export function ambitionLedgerSummary() {
  const totalEntries = MSM_AMBITION_LEDGER.length;
  return {
    totalEntries,
    open: ambitionEntriesWithStatus(MSM_AMBITION_STATUS.open).length,
    inProgress: ambitionEntriesWithStatus(MSM_AMBITION_STATUS.inProgress).length,
    proven: ambitionEntriesWithStatus(MSM_AMBITION_STATUS.proven).length,
    refused: ambitionEntriesWithStatus(MSM_AMBITION_STATUS.refused).length,
    withDeclaredResidual: MSM_AMBITION_LEDGER.filter((entry) => entry.residualNumbers.length > 0).length,
    coverage: ambitionLedgerCoverage(),
  };
}
