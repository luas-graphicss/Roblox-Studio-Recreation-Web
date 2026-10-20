import {
  MSM_GATE_COMPARISON,
  MSM_REQUIREMENT_STATUS,
  evaluateRequirement,
  requirementIsExecutable,
} from "./msmGateComparisonCore.js";

export const MSM_SECTION_11_GATE_COUNT = 14;

function requirement(definition) {


  return Object.freeze(Object.assign({ targetFromPlan: true }, definition));
}

function verdictGate(definition) {
  return Object.freeze({
    planId: definition.planId,
    id: definition.id,
    title: definition.title,
    requirements: Object.freeze(definition.requirements.map(requirement)),
    owningPhaseIds: Object.freeze(definition.owningPhaseIds.slice()),
    sceneNumbers: Object.freeze((definition.sceneNumbers || []).slice()),


    requiresRealGpuContext: definition.requiresRealGpuContext,
  });
}

export const MSM_VERDICT_GATES = Object.freeze([
  verdictGate({
    planId: "G1",
    id: "fixedCost",
    title: "Fixed cost, independent of the number of lights",
    owningPhaseIds: ["MSM-F20", "MSM-F34"],
    sceneNumbers: [2],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "msmMillisecondDeviationOneVersusTwoHundredLights",
        comparison: MSM_GATE_COMPARISON.withinRelativeTolerance,
        target: 0.15,
        unit: "ratio",
        description: "one light and two hundred lights cost the same milliseconds within 15 per cent",
      },
      {
        metric: "visibilityTapsPerPixelVarianceAcrossLightCounts",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "variance",
        description: "the number of visibility taps per pixel does not vary with the light count",
      },
    ],
  }),
  verdictGate({
    planId: "G2",
    id: "frameRateOnTheTargetMachine",
    title: "Frame rate on the reference weak GPU",
    owningPhaseIds: ["MSM-F34"],
    sceneNumbers: [9],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "frameRateAverageOnReferenceWeakGpu",
        comparison: MSM_GATE_COMPARISON.insideInclusiveRange,
        target: 25,
        targetCeiling: 35,
        unit: "fps",
        description: "25 to 35 fps on the reference weak GPU at 0.75 resolution scale",
      },
      {
        metric: "frameTimePercentile95",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: 45,
        unit: "ms",
        description: "the 95th percentile of the frame time stays under 45 ms",
      },
    ],
  }),
  verdictGate({
    planId: "G3",
    id: "absoluteCostPerTier",
    title: "Absolute cost of the MSM passes per tier",
    owningPhaseIds: ["MSM-F22", "MSM-F31"],
    sceneNumbers: [9],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "msmTotalMillisecondsOnTierLite",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: 2,
        unit: "ms",
        description: "every MSM pass together stays under 2.0 ms on the lite tier",
      },
      {
        metric: "msmTotalMillisecondsOnTierMicro",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: 1.2,
        unit: "ms",
        description: "every MSM pass together stays under 1.2 ms on the micro tier",
      },
      {
        metric: "msmTotalMillisecondsOnTierLow",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: 2.8,
        unit: "ms",
        description: "every MSM pass together stays under 2.8 ms on the low tier",
      },
    ],
  }),
  verdictGate({
    planId: "G4",
    id: "energyAgainstTheTruth",
    title: "Energy and colour against the reference integrator",
    owningPhaseIds: ["MSM-F21", "MSM-F34"],
    sceneNumbers: [1, 3],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "irradianceDeviationPerRegion",
        comparison: MSM_GATE_COMPARISON.withinRelativeTolerance,
        target: 0.1,
        unit: "ratio",
        description: "irradiance per region stays within 10 per cent of the reference",
      },
      {
        metric: "averageDeltaE76",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: 6,
        unit: "deltaE",
        description: "the average colour difference stays under 6 in delta E 76",
      },
      {
        metric: "structuralSimilarityAfterConvergence",
        comparison: MSM_GATE_COMPARISON.atLeast,
        target: 0.9,
        unit: "ssim",
        description: "structural similarity after convergence is at least 0.90",
      },
    ],
  }),
  verdictGate({
    planId: "G5",
    id: "approximationAgainstTheOriginal",
    title: "The approximation is not a different image",
    owningPhaseIds: ["MSM-F34"],
    sceneNumbers: [1, 9],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "structuralSimilarityAgainstOriginalPath",
        comparison: MSM_GATE_COMPARISON.atLeast,
        target: 0.85,
        unit: "ssim",
        description: "at least 0.85 of structural similarity against the original lighting path",
      },
      {
        metric: "contrastInversionsAgainstOriginalPath",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "regions",
        description: "no region is lit where the original path leaves it dark, or the opposite",
      },
    ],
  }),
  verdictGate({
    planId: "G6",
    id: "convergenceSpeed",
    title: "Convergence speed after a change",
    owningPhaseIds: ["MSM-F27"],
    sceneNumbers: [4, 5],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "framesToReachNinetyPercentOfTheFinalValue",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: 6,
        unit: "frames",
        description: "six frames at most to reach 90 per cent of the final value",
      },
      {
        metric: "framesToReachNinetyEightPercentOfTheFinalValue",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: 12,
        unit: "frames",
        description: "twelve frames at most to reach 98 per cent of the final value",
      },
    ],
  }),
  verdictGate({
    planId: "G7",
    id: "antiFirefly",
    title: "No firefly on disocclusion",
    owningPhaseIds: ["MSM-F29"],
    sceneNumbers: [5, 10],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "pixelsAboveTheLuminanceClampOnDisocclusion",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: 0.001,
        unit: "ratio of pixels",
        description: "at most one pixel in a thousand crosses the luminance clamp when history is lost",
      },
    ],
  }),
  verdictGate({
    planId: "G8",
    id: "idleCostsNothing",
    title: "An idle scene costs nothing",
    owningPhaseIds: ["MSM-F27", "MSM-F17"],
    sceneNumbers: [7],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "newMsmFramesWhileTheSceneIsIdle",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "frames",
        description: "no MSM frame is produced while nothing changes",
      },
      {
        metric: "msmMillisecondsWhileTheSceneIsIdle",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "ms",
        description: "no millisecond is spent while nothing changes",
      },
      {
        metric: "atlasPageRerendersWhileTheSceneIsIdle",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "pages",
        description: "no atlas page is re-rendered while nothing changes",
      },
    ],
  }),
  verdictGate({
    planId: "G9",
    id: "offIsByteForByte",
    title: "Turned off, the engine is the engine of today",
    owningPhaseIds: ["MSM-F3", "MSM-F22", "MSM-F34"],
    sceneNumbers: [1, 9],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "capturedPixelDifferencesWithMsmOff",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "pixels",
        description: "the capture with MSM off is byte for byte the capture of today",
      },
      {
        metric: "shaderProgramCountDifferenceWithMsmOff",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "programs",
        description: "turning MSM off compiles the same number of programs as today",
      },
    ],
  }),
  verdictGate({
    planId: "G10",
    id: "resourceCeiling",
    title: "Texture units and video memory stay inside the ceiling",
    owningPhaseIds: ["MSM-F2", "MSM-F24"],
    sceneNumbers: [],

    requiresRealGpuContext: false,
    requirements: [
      {
        metric: "textureUnitsUsedByTheMsmPass",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: 8,
        unit: "units",
        description: "the MSM pass binds at most eight texture units",
      },
      {
        metric: "textureUnitsAddedToTheForwardMaterial",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 1,
        unit: "units",
        description: "mode B adds exactly one texture unit to the forward material",
      },
      {
        metric: "newVideoMemoryMegabytes",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: 1.5,
        unit: "MB",
        description: "every MSM target together adds at most 1.5 MB of video memory",
      },
      {
        metric: "textureRecreationsAtRuntime",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "recreations",
        description: "no texture is recreated at runtime",
      },
    ],
  }),
  verdictGate({
    planId: "G11",
    id: "antiTdr",
    title: "No frame long enough to reset the driver",
    owningPhaseIds: ["MSM-F32"],
    sceneNumbers: [8],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "worstTransitionFrameMilliseconds",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: 250,
        unit: "ms",
        description: "no ignition, tier change or warmup frame crosses 250 ms",
      },
    ],
  }),
  verdictGate({
    planId: "G12",
    id: "mutualExclusion",
    title: "MSM and the frozen MegaLights never run together",
    owningPhaseIds: ["MSM-F3"],
    sceneNumbers: [1, 8, 9],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "framesWithBothLightingSystemsAwake",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "frames",
        description: "telemetry never shows the two systems awake in the same frame",
      },
    ],
  }),
  verdictGate({
    planId: "G13",
    id: "modeBPaysForItself",
    title: "Mode B is cheaper than the loop it replaces",
    owningPhaseIds: ["MSM-F24"],
    sceneNumbers: [3],
    requiresRealGpuContext: true,
    requirements: [
      {
        metric: "frameMillisecondDeltaModeBOnMinusOff",
        comparison: MSM_GATE_COMPARISON.atMost,
        target: -0.05,


        targetFromPlan: false,
        unit: "ms",
        description: "with 60 lights, the frame with mode B on is at least 0.05 ms faster than with it off",
      },
    ],
  }),
  verdictGate({
    planId: "G14",
    id: "rotationCoverage",
    title: "Everything in rotation has a coverage proof",
    owningPhaseIds: ["MSM-F12", "MSM-F15", "MSM-F17"],
    sceneNumbers: [],

    requiresRealGpuContext: false,
    requirements: [
      {
        metric: "closedRotationCoverageProofs",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 3,
        unit: "proofs",
        description: "the pixel pattern, the light fairness and the atlas page rotation each close their coverage proof",
      },
    ],
  }),
]);

export function listVerdictGates() {
  return MSM_VERDICT_GATES;
}

export function verdictGateByPlanId(planId) {
  return MSM_VERDICT_GATES.find((gate) => gate.planId === planId) || null;
}

export function verdictGateById(gateId) {
  return MSM_VERDICT_GATES.find((gate) => gate.id === gateId) || null;
}

export function verdictGatesForPhase(phaseId) {
  return MSM_VERDICT_GATES.filter((gate) => gate.owningPhaseIds.indexOf(phaseId) >= 0);
}

export function gatesRequiringRealGpuContext() {
  return MSM_VERDICT_GATES.filter((gate) => gate.requiresRealGpuContext);
}

export function gatesWithoutExecutableRequirement() {
  return MSM_VERDICT_GATES.filter(
    (gate) => gate.requirements.length === 0 || gate.requirements.some((entry) => !requirementIsExecutable(entry)),
  );
}

function readMeasurement(measurements, metric) {
  if (!measurements || !Object.prototype.hasOwnProperty.call(measurements, metric)) {
    return null;
  }
  return measurements[metric];
}

function gateReason(status, pendingMetrics, failedMetrics) {
  if (status === MSM_REQUIREMENT_STATUS.passed) {
    return "every requirement satisfied";
  }
  if (status === MSM_REQUIREMENT_STATUS.failed) {
    return "requirements failed: " + failedMetrics.join(", ");
  }
  return "requirements never measured: " + pendingMetrics.join(", ");
}


export function evaluateVerdictGate(planId, measurements) {
  const gate = verdictGateByPlanId(planId);
  if (!gate) {
    return Object.freeze({
      planId,
      known: false,
      status: MSM_REQUIREMENT_STATUS.failed,
      passed: false,
      blocks: true,
      requirements: Object.freeze([]),
      pendingMetrics: Object.freeze([]),
      failedMetrics: Object.freeze([]),
      requiresRealGpuContext: false,
      reason: 'there is no gate "' + String(planId) + '" in section 11',
    });
  }

  const verdicts = gate.requirements.map((entry) => evaluateRequirement(entry, readMeasurement(measurements, entry.metric)));
  const pendingMetrics = verdicts.filter((entry) => entry.status === MSM_REQUIREMENT_STATUS.pending).map((entry) => entry.metric);
  const failedMetrics = verdicts.filter((entry) => entry.status === MSM_REQUIREMENT_STATUS.failed).map((entry) => entry.metric);
  let status = MSM_REQUIREMENT_STATUS.passed;
  if (failedMetrics.length > 0) {
    status = MSM_REQUIREMENT_STATUS.failed;
  } else if (pendingMetrics.length > 0) {
    status = MSM_REQUIREMENT_STATUS.pending;
  }

  return Object.freeze({
    planId: gate.planId,
    id: gate.id,
    known: true,
    status,
    passed: status === MSM_REQUIREMENT_STATUS.passed,
    blocks: status !== MSM_REQUIREMENT_STATUS.passed,
    requirements: Object.freeze(verdicts),
    pendingMetrics: Object.freeze(pendingMetrics),
    failedMetrics: Object.freeze(failedMetrics),
    requiresRealGpuContext: gate.requiresRealGpuContext,
    reason: gateReason(status, pendingMetrics, failedMetrics),
  });
}

export function evaluateAllVerdictGates(measurements) {
  const evaluations = MSM_VERDICT_GATES.map((gate) => evaluateVerdictGate(gate.planId, measurements));
  const passed = evaluations.filter((entry) => entry.passed);
  const pending = evaluations.filter((entry) => entry.status === MSM_REQUIREMENT_STATUS.pending);
  const failed = evaluations.filter((entry) => entry.status === MSM_REQUIREMENT_STATUS.failed);
  return {
    totalGates: evaluations.length,
    passed: passed.length,
    pending: pending.length,
    failed: failed.length,
    allPassed: passed.length === evaluations.length,
    blockingGatePlanIds: evaluations.filter((entry) => entry.blocks).map((entry) => entry.planId),
    gates: evaluations,
  };
}

export function verdictGatesSummary() {
  return {
    totalGates: MSM_VERDICT_GATES.length,
    declaredByThePlan: MSM_SECTION_11_GATE_COUNT,
    totalRequirements: MSM_VERDICT_GATES.reduce((total, gate) => total + gate.requirements.length, 0),
    withoutExecutableRequirement: gatesWithoutExecutableRequirement().length,
    requiringRealGpuContext: gatesRequiringRealGpuContext().length,
    targetsProposedHereInsteadOfCopiedFromThePlan: MSM_VERDICT_GATES.reduce(
      (total, gate) => total + gate.requirements.filter((entry) => !entry.targetFromPlan).length,
      0,
    ),
  };
}
