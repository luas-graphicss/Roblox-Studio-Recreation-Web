export const MSM_PHASE_COUNT = 34;

export const MSM_PHASE_BLOCK = Object.freeze({
  foundationAndContract: "A",
  lightSceneAndSpatialStructure: "B",
  stochasticSampling: "C",
  visibility: "D",
  shadingAndComposition: "E",
  temporalAndConvergence: "F",
  governanceApiAndProof: "G",
});

export const MSM_PHASE_RISK = Object.freeze({
  low: "low",
  medium: "medium",
  high: "high",

  highest: "highest",


  environmental: "environmental",
});

export function phaseIdFromNumber(phaseNumber) {
  return "MSM-F" + phaseNumber;
}

function everyPhaseBefore(phaseNumber) {
  const phaseIds = [];
  for (let previous = 1; previous < phaseNumber; previous += 1) {
    phaseIds.push(phaseIdFromNumber(previous));
  }
  return phaseIds;
}

function phase(definition) {
  return Object.freeze({
    number: definition.number,
    id: phaseIdFromNumber(definition.number),
    title: definition.title,
    block: definition.block,
    dependsOn: Object.freeze(definition.dependsOn.slice()),
    tierScope: definition.tierScope,
    risk: definition.risk,
  });
}

export const MSM_PHASE_ROSTER = Object.freeze([
  phase({ number: 1, title: "Ambition ledger", block: MSM_PHASE_BLOCK.foundationAndContract, dependsOn: [], tierScope: "none", risk: MSM_PHASE_RISK.low }),
  phase({ number: 2, title: "Pipeline contract", block: MSM_PHASE_BLOCK.foundationAndContract, dependsOn: ["MSM-F1"], tierScope: "all", risk: MSM_PHASE_RISK.low }),
  phase({ number: 3, title: "Technology gate, tri-state flag, tier and mutual exclusion", block: MSM_PHASE_BLOCK.foundationAndContract, dependsOn: ["MSM-F2"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 4, title: "Dirt ledger", block: MSM_PHASE_BLOCK.foundationAndContract, dependsOn: ["MSM-F2"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 5, title: "Scene inputs without a G-buffer", block: MSM_PHASE_BLOCK.foundationAndContract, dependsOn: ["MSM-F2"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 6, title: "Light record with a stable identifier", block: MSM_PHASE_BLOCK.lightSceneAndSpatialStructure, dependsOn: ["MSM-F2"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 7, title: "Resident and stochastic partition with hysteresis", block: MSM_PHASE_BLOCK.lightSceneAndSpatialStructure, dependsOn: ["MSM-F3", "MSM-F6"], tierScope: "all", risk: MSM_PHASE_RISK.high }),
  phase({ number: 8, title: "World space light grid", block: MSM_PHASE_BLOCK.lightSceneAndSpatialStructure, dependsOn: ["MSM-F2", "MSM-F6"], tierScope: "all", risk: MSM_PHASE_RISK.high }),
  phase({ number: 9, title: "Grid lookup in the shader", block: MSM_PHASE_BLOCK.lightSceneAndSpatialStructure, dependsOn: ["MSM-F8", "MSM-F5"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 10, title: "Far list of the strong emitters", block: MSM_PHASE_BLOCK.lightSceneAndSpatialStructure, dependsOn: ["MSM-F8"], tierScope: "lite+", risk: MSM_PHASE_RISK.low }),
  phase({ number: 11, title: "Cheap spatio-temporal blue noise", block: MSM_PHASE_BLOCK.stochasticSampling, dependsOn: ["MSM-F2"], tierScope: "all", risk: MSM_PHASE_RISK.low }),
  phase({ number: 12, title: "Reduced resolution pattern with coverage proof", block: MSM_PHASE_BLOCK.stochasticSampling, dependsOn: ["MSM-F11"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 13, title: "Sample importance weight", block: MSM_PHASE_BLOCK.stochasticSampling, dependsOn: ["MSM-F5", "MSM-F6"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 14, title: "Weighted reservoir sampling", block: MSM_PHASE_BLOCK.stochasticSampling, dependsOn: ["MSM-F13", "MSM-F11"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 15, title: "Fairness for the light importance never picks", block: MSM_PHASE_BLOCK.stochasticSampling, dependsOn: ["MSM-F14"], tierScope: "lite+", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 16, title: "Atlas visibility in a single tap", block: MSM_PHASE_BLOCK.visibility, dependsOn: ["MSM-F14", "MSM-F3"], tierScope: "all", risk: MSM_PHASE_RISK.high }),
  phase({ number: 17, title: "Atlas page scheduler in rotation", block: MSM_PHASE_BLOCK.visibility, dependsOn: ["MSM-F16"], tierScope: "all", risk: MSM_PHASE_RISK.high }),
  phase({ number: 18, title: "Screen trace with a fixed number of steps", block: MSM_PHASE_BLOCK.visibility, dependsOn: ["MSM-F5"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 19, title: "Proxy occlusion for off screen occluders", block: MSM_PHASE_BLOCK.visibility, dependsOn: ["MSM-F5"], tierScope: "low+", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 20, title: "Visibility policy with bounded cost", block: MSM_PHASE_BLOCK.visibility, dependsOn: ["MSM-F16", "MSM-F18", "MSM-F19"], tierScope: "all", risk: MSM_PHASE_RISK.high }),
  phase({ number: 21, title: "Estimator and sample shading", block: MSM_PHASE_BLOCK.shadingAndComposition, dependsOn: ["MSM-F14", "MSM-F20"], tierScope: "all", risk: MSM_PHASE_RISK.high }),
  phase({ number: 22, title: "Mode A: multiplicative screen composition", block: MSM_PHASE_BLOCK.shadingAndComposition, dependsOn: ["MSM-F21"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 23, title: "Depth aware upsample", block: MSM_PHASE_BLOCK.shadingAndComposition, dependsOn: ["MSM-F22"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 24, title: "Mode B: irradiance injection in the forward material", block: MSM_PHASE_BLOCK.shadingAndComposition, dependsOn: ["MSM-F7", "MSM-F21", "MSM-F23"], tierScope: "lite+", risk: MSM_PHASE_RISK.highest }),
  phase({ number: 25, title: "Specular and area lights, the honest minimum", block: MSM_PHASE_BLOCK.shadingAndComposition, dependsOn: ["MSM-F21"], tierScope: "low+", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 26, title: "Temporal accumulation with camera only reprojection", block: MSM_PHASE_BLOCK.temporalAndConvergence, dependsOn: ["MSM-F22"], tierScope: "all", risk: MSM_PHASE_RISK.high }),
  phase({ number: 27, title: "Adaptive alpha, convergence and the idle brake", block: MSM_PHASE_BLOCK.temporalAndConvergence, dependsOn: ["MSM-F26", "MSM-F4"], tierScope: "all", risk: MSM_PHASE_RISK.high }),
  phase({ number: 28, title: "Spatial filter behind a relative variance gate", block: MSM_PHASE_BLOCK.temporalAndConvergence, dependsOn: ["MSM-F26"], tierScope: "lite+", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 29, title: "Disocclusion without a hole", block: MSM_PHASE_BLOCK.temporalAndConvergence, dependsOn: ["MSM-F26"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 30, title: "Stability under blinking and animated lights", block: MSM_PHASE_BLOCK.temporalAndConvergence, dependsOn: ["MSM-F27"], tierScope: "low+", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 31, title: "Millisecond ledger and budget governor", block: MSM_PHASE_BLOCK.governanceApiAndProof, dependsOn: ["MSM-F22"], tierScope: "all", risk: MSM_PHASE_RISK.medium }),
  phase({ number: 32, title: "Sliced warmup and anti-TDR ignition", block: MSM_PHASE_BLOCK.governanceApiAndProof, dependsOn: ["MSM-F31"], tierScope: "all", risk: MSM_PHASE_RISK.high }),
  phase({ number: 33, title: "Public API, property and telemetry", block: MSM_PHASE_BLOCK.governanceApiAndProof, dependsOn: ["MSM-F3", "MSM-F31"], tierScope: "all", risk: MSM_PHASE_RISK.low }),
  phase({ number: 34, title: "Weak GPU certification and blind round", block: MSM_PHASE_BLOCK.governanceApiAndProof, dependsOn: everyPhaseBefore(34), tierScope: "all", risk: MSM_PHASE_RISK.environmental }),
]);

export function listPhases() {
  return MSM_PHASE_ROSTER;
}

export function phaseById(phaseId) {
  return MSM_PHASE_ROSTER.find((entry) => entry.id === phaseId) || null;
}

export function phaseByNumber(phaseNumber) {
  return MSM_PHASE_ROSTER.find((entry) => entry.number === phaseNumber) || null;
}

export function isKnownPhaseId(phaseId) {
  return !!phaseById(phaseId);
}

export function phasesInBlock(block) {
  return MSM_PHASE_ROSTER.filter((entry) => entry.block === block);
}

export function phasesWithUnknownDependency() {
  return MSM_PHASE_ROSTER.filter((entry) => entry.dependsOn.some((dependencyId) => !isKnownPhaseId(dependencyId)));
}

export function phaseRosterSummary() {
  return {
    totalPhases: MSM_PHASE_ROSTER.length,
    declaredByThePlan: MSM_PHASE_COUNT,
    withoutDependencies: MSM_PHASE_ROSTER.filter((entry) => entry.dependsOn.length === 0).length,
    withUnknownDependency: phasesWithUnknownDependency().length,
    highRisk: MSM_PHASE_ROSTER.filter((entry) => entry.risk === MSM_PHASE_RISK.high || entry.risk === MSM_PHASE_RISK.highest).length,
  };
}
