import { MSM_REQUIREMENT_STATUS, isFiniteNumber } from "./msmGateComparisonCore.js";
import { authorizePhaseCompletion } from "./msmCompletionAuthorityCore.js";
import {
  MSM_SECTION_11_GATE_COUNT,
  evaluateAllVerdictGates,
  listVerdictGates,
  verdictGateByPlanId,
} from "./msmVerdictGatesCore.js";

export const MSM_CERTIFICATION_PHASE_ID = "MSM-F34";

export const MSM_CERTIFICATION_STATUS = Object.freeze({
  certified: "certified",
  refused: "refused",
  pending: "pending",
});


export const MSM_REFERENCE_GPU_CLASS = "G210";
export const MSM_REFERENCE_RESOLUTION_SCALE = 0.75;


export const MSM_MINIMUM_MEASURED_FRAMES = 300;
export const MSM_MINIMUM_MEASURED_FRAMES_FROM_PLAN = false;

export const MSM_PROOF_SCENE_COUNT = 10;

function proofScene(definition) {
  return Object.freeze({
    number: definition.number,
    id: definition.id,
    title: definition.title,
    proves: definition.proves,
  });
}


export const MSM_PROOF_SCENES = Object.freeze([
  proofScene({
    number: 1,
    id: "corridorWithSixtyShadowSpots",
    title: "Corridor with sixty shadow casting spot lights",
    proves: "the central use case, with stable shadows on a weak GPU",
  }),
  proofScene({
    number: 2,
    id: "roomWithTwoHundredWeakPointLights",
    title: "Room with two hundred weak point lights",
    proves: "fixed cost: one light against two hundred lights",
  }),
  proofScene({
    number: 3,
    id: "fourStrongLightsAndOneHundredWeak",
    title: "Four strong lights and one hundred weak ones",
    proves: "importance: the weak lights cannot steal the strong ones",
  }),
  proofScene({
    number: 4,
    id: "lightBlinkingAtFourHertz",
    title: "Light blinking at four hertz",
    proves: "temporal convergence without a trail",
  }),
  proofScene({
    number: 5,
    id: "cameraOrbitingAStaticScene",
    title: "Camera orbiting a static scene",
    proves: "reprojection without motion vectors",
  }),
  proofScene({
    number: 6,
    id: "partMovingUnderTwentyLights",
    title: "A part moving under twenty lights",
    proves: "the dirty pulse and the atlas page cache",
  }),
  proofScene({
    number: 7,
    id: "sceneIdleForTenSeconds",
    title: "Scene left idle for ten seconds",
    proves: "the idle contract: zero frames and zero milliseconds",
  }),
  proofScene({
    number: 8,
    id: "technologyRoundTrip",
    title: "ShadowMap to Future to Voxel and back to ShadowMap",
    proves: "mutual exclusion and the anti TDR slicing",
  }),
  proofScene({
    number: 9,
    id: "aaaLikeSceneFromTheOptimizationMap",
    title: "The AA and AAA like scene of MAPA-OTIMIZACAO-GPU-FRACA",
    proves: "the frame rate gate of twenty five to thirty five on the G210",
  }),
  proofScene({
    number: 10,
    id: "thinSilhouetteAgainstAStrongLight",
    title: "Thin silhouette against a strong light",
    proves: "filter and upsample leaking",
  }),
]);

export function listProofScenes() {
  return MSM_PROOF_SCENES;
}

export function proofSceneByNumber(sceneNumber) {
  return MSM_PROOF_SCENES.find((scene) => scene.number === sceneNumber) || null;
}


export function gatePlanIdsForScene(sceneNumber) {
  return listVerdictGates()
    .filter((gate) => gate.sceneNumbers.indexOf(sceneNumber) !== -1)
    .map((gate) => gate.planId);
}


export function scenesWithoutJudgingGate() {
  return MSM_PROOF_SCENES.filter((scene) => gatePlanIdsForScene(scene.number).length === 0).map(
    (scene) => scene.number,
  );
}


export function sceneNumbersRequiredByGates() {
  const required = [];
  listVerdictGates().forEach((gate) => {
    gate.sceneNumbers.forEach((sceneNumber) => {
      if (required.indexOf(sceneNumber) === -1) {
        required.push(sceneNumber);
      }
    });
  });
  return required.sort((first, second) => first - second);
}

function combineStatuses(statuses) {
  if (statuses.indexOf(MSM_REQUIREMENT_STATUS.failed) !== -1) {
    return MSM_REQUIREMENT_STATUS.failed;
  }
  if (statuses.indexOf(MSM_REQUIREMENT_STATUS.pending) !== -1) {
    return MSM_REQUIREMENT_STATUS.pending;
  }
  return MSM_REQUIREMENT_STATUS.passed;
}

function isDeclared(value) {
  return value !== null && value !== undefined && value !== "";
}


function sceneRunDeclarationProblems(sceneRun) {
  const pending = [];
  const failed = [];

  if (!isDeclared(sceneRun.gpuClass)) {
    pending.push(
      "the run does not say which GPU class it ran on, and the round is certified on the " +
        MSM_REFERENCE_GPU_CLASS +
        " class",
    );
  } else if (sceneRun.gpuClass !== MSM_REFERENCE_GPU_CLASS) {
    failed.push("it ran on " + String(sceneRun.gpuClass) + " and the reference class is " + MSM_REFERENCE_GPU_CLASS);
  }


  if (!isFiniteNumber(sceneRun.resolutionScale)) {
    pending.push(
      "the run does not say at which resolution scale it ran, and the round is measured at " +
        MSM_REFERENCE_RESOLUTION_SCALE,
    );
  } else if (sceneRun.resolutionScale !== MSM_REFERENCE_RESOLUTION_SCALE) {
    failed.push(
      "it ran at resolution scale " +
        sceneRun.resolutionScale +
        " and the round is measured at " +
        MSM_REFERENCE_RESOLUTION_SCALE,
    );
  }

  if (typeof sceneRun.msmEnabled !== "boolean") {
    pending.push("the run does not say whether MSM was enabled");
  } else if (sceneRun.msmEnabled === false) {
    failed.push("MSM was not enabled, so the run says nothing about MSM");
  }

  if (typeof sceneRun.cameraPoseId !== "string" || sceneRun.cameraPoseId.length === 0) {
    pending.push("the run carries no camera pose identifier, and section 10 fixes the framing");
  }

  if (!isFiniteNumber(sceneRun.framesMeasured)) {
    pending.push("the run counted no frames");
  } else if (!(sceneRun.framesMeasured >= MSM_MINIMUM_MEASURED_FRAMES)) {
    pending.push(
      "the run counted " +
        sceneRun.framesMeasured +
        " frames and a percentile needs at least " +
        MSM_MINIMUM_MEASURED_FRAMES,
    );
  }

  return { pending, failed };
}

function sceneVerdict(scene, judgingGatePlanIds, status, blocks, reason, sceneRun) {
  return Object.freeze({
    sceneNumber: scene.number,
    sceneId: scene.id,
    judgedBySection11: judgingGatePlanIds.length !== 0,
    judgingGatePlanIds: Object.freeze(judgingGatePlanIds.slice()),
    cameraPoseId: sceneRun && typeof sceneRun.cameraPoseId === "string" ? sceneRun.cameraPoseId : null,
    framesMeasured: sceneRun && isFiniteNumber(sceneRun.framesMeasured) ? sceneRun.framesMeasured : null,
    status,
    blocks,
    reason,
  });
}

function evaluateSceneRun(scene, sceneRun) {
  const judgingGatePlanIds = gatePlanIdsForScene(scene.number);

  if (judgingGatePlanIds.length === 0) {
    return sceneVerdict(
      scene,
      judgingGatePlanIds,
      MSM_REQUIREMENT_STATUS.pending,
      false,
      "no gate of section 11 names this scene, so no number can certify it",
      sceneRun,
    );
  }

  if (!sceneRun) {
    return sceneVerdict(
      scene,
      judgingGatePlanIds,
      MSM_REQUIREMENT_STATUS.pending,
      true,
      "the scene was never run, and gates " + judgingGatePlanIds.join(", ") + " depend on it",
      null,
    );
  }

  const problems = sceneRunDeclarationProblems(sceneRun);

  if (problems.failed.length !== 0) {
    return sceneVerdict(
      scene,
      judgingGatePlanIds,
      MSM_REQUIREMENT_STATUS.failed,
      true,
      problems.failed.concat(problems.pending).join("; "),
      sceneRun,
    );
  }

  if (problems.pending.length !== 0) {
    return sceneVerdict(
      scene,
      judgingGatePlanIds,
      MSM_REQUIREMENT_STATUS.pending,
      true,
      problems.pending.join("; "),
      sceneRun,
    );
  }

  return sceneVerdict(
    scene,
    judgingGatePlanIds,
    MSM_REQUIREMENT_STATUS.passed,
    false,
    "run on " + MSM_REFERENCE_GPU_CLASS + " with the fixed pose " + sceneRun.cameraPoseId,
    sceneRun,
  );
}


export function evaluateSceneCoverage(sceneRuns) {
  const runs = Array.isArray(sceneRuns) ? sceneRuns : [];
  const scenes = MSM_PROOF_SCENES.map((scene) =>
    evaluateSceneRun(
      scene,
      runs.find((entry) => entry && entry.sceneNumber === scene.number) || null,
    ),
  );
  const blocking = scenes.filter((entry) => entry.blocks);

  return Object.freeze({
    totalScenes: scenes.length,
    declaredByThePlan: MSM_PROOF_SCENE_COUNT,
    requiredSceneNumbers: Object.freeze(sceneNumbersRequiredByGates()),
    coveredSceneNumbers: Object.freeze(
      scenes.filter((entry) => entry.status === MSM_REQUIREMENT_STATUS.passed).map((entry) => entry.sceneNumber),
    ),
    unjudgedSceneNumbers: Object.freeze(scenesWithoutJudgingGate()),
    status: combineStatuses(blocking.map((entry) => entry.status)),
    blocks: blocking.length !== 0,
    blockingReasons: Object.freeze(blocking.map((entry) => "scene " + entry.sceneNumber + ": " + entry.reason)),
    scenes: Object.freeze(scenes),
  });
}


export const MSM_BLIND_ROUND_SCENE_NUMBERS = verdictGateByPlanId("G9").sceneNumbers;

function blindRoundCheck(name, expectation, observed, description) {
  if (observed === null || observed === undefined) {
    return Object.freeze({
      name,
      status: MSM_REQUIREMENT_STATUS.pending,
      blocks: true,
      reason: "never measured: " + description,
    });
  }
  const satisfied = expectation(observed);
  return Object.freeze({
    name,
    status: satisfied ? MSM_REQUIREMENT_STATUS.passed : MSM_REQUIREMENT_STATUS.failed,
    blocks: !satisfied,
    reason: (satisfied ? "passed: " : "failed: ") + description,
  });
}

function machineOf(crossProof, side) {
  const machine = crossProof && crossProof[side];
  return machine && typeof machine === "object" ? machine : {};
}


export function evaluateBlindRound(crossProof) {
  const weakMachine = machineOf(crossProof, "weakMachine");
  const strongMachine = machineOf(crossProof, "strongMachine");
  const proof = crossProof && typeof crossProof === "object" ? crossProof : {};
  const coveredSceneNumbers = Array.isArray(proof.sceneNumbers) ? proof.sceneNumbers : null;

  const checks = [
    blindRoundCheck(
      "weakMachineIsTheReferenceClass",
      (value) => value === MSM_REFERENCE_GPU_CLASS,
      weakMachine.gpuClass === undefined ? null : weakMachine.gpuClass,
      "the weak side of the round is the " + MSM_REFERENCE_GPU_CLASS + " class",
    ),
    blindRoundCheck(
      "strongMachineRanWithMsmAutoOff",
      (value) => value === false,
      strongMachine.msmAutoEnabled === undefined ? null : strongMachine.msmAutoEnabled,
      "the strong machine ran with MSM AUTO off, so it is the engine of today",
    ),
    blindRoundCheck(
      "bothMachinesUsedTheSameCameraPose",
      (value) => value.length !== 0 && value === String(strongMachine.cameraPoseId || ""),
      typeof weakMachine.cameraPoseId === "string" ? weakMachine.cameraPoseId : null,
      "the two machines framed the scene with the same fixed camera pose",
    ),
    blindRoundCheck(
      "captureDiffIsByteForByte",
      (value) => value === 0,
      isFiniteNumber(proof.capturedPixelDifferences) ? proof.capturedPixelDifferences : null,
      "the capture diff between the two sides is byte for byte",
    ),
    blindRoundCheck(
      "sameShaderProgramCount",
      (value) => value === 0,
      isFiniteNumber(proof.shaderProgramCountDifference) ? proof.shaderProgramCountDifference : null,
      "both sides compiled the same number of shader programs",
    ),
    blindRoundCheck(
      "scenesOfGateG9AreCovered",
      (value) => MSM_BLIND_ROUND_SCENE_NUMBERS.every((sceneNumber) => value.indexOf(sceneNumber) !== -1),
      coveredSceneNumbers,
      "the round covers the scenes gate G9 names: " + MSM_BLIND_ROUND_SCENE_NUMBERS.join(", "),
    ),
  ];

  const blocking = checks.filter((entry) => entry.blocks);

  return Object.freeze({
    totalChecks: checks.length,
    status: combineStatuses(blocking.map((entry) => entry.status)),
    blocks: blocking.length !== 0,
    blockingReasons: Object.freeze(blocking.map((entry) => entry.name + " - " + entry.reason)),
    checks: Object.freeze(checks),
  });
}

function gateStatusOf(gateEvaluation) {
  if (gateEvaluation.failed !== 0) {
    return MSM_REQUIREMENT_STATUS.failed;
  }
  if (gateEvaluation.pending !== 0) {
    return MSM_REQUIREMENT_STATUS.pending;
  }
  return MSM_REQUIREMENT_STATUS.passed;
}


function planAuthorityStatus(phaseAuthorization) {
  return phaseAuthorization.authorized ? MSM_REQUIREMENT_STATUS.passed : MSM_REQUIREMENT_STATUS.pending;
}

function planAuthorityReasons(phaseAuthorization) {
  if (phaseAuthorization.authorized) {
    return [];
  }
  const reasons = [
    "the plan refuses " + MSM_CERTIFICATION_PHASE_ID + " on its own terms, so the round cannot be certified",
  ];
  if (phaseAuthorization.unauthorizedDependencyIds.length !== 0) {
    reasons.push(
      MSM_CERTIFICATION_PHASE_ID +
        " depends on every phase before it and " +
        phaseAuthorization.unauthorizedDependencyIds.length +
        " of them are not authorised yet: " +
        phaseAuthorization.unauthorizedDependencyIds.join(", "),
    );
  }
  return reasons;
}

function certificationStatusOf(combinedStatus) {
  if (combinedStatus === MSM_REQUIREMENT_STATUS.failed) {
    return MSM_CERTIFICATION_STATUS.refused;
  }
  if (combinedStatus === MSM_REQUIREMENT_STATUS.pending) {
    return MSM_CERTIFICATION_STATUS.pending;
  }
  return MSM_CERTIFICATION_STATUS.certified;
}

function answerToSectionZero(certificationStatus) {
  if (certificationStatus === MSM_CERTIFICATION_STATUS.certified) {
    return "yes";
  }
  if (certificationStatus === MSM_CERTIFICATION_STATUS.refused) {
    return "no";
  }
  return "pending";
}

function uniqueReasons(reasons) {
  const unique = [];
  reasons.forEach((reason) => {
    if (unique.indexOf(reason) === -1) {
      unique.push(reason);
    }
  });
  return unique;
}


export function certifyWeakGpuRound(evidence) {
  const submitted = evidence && typeof evidence === "object" ? evidence : {};
  const measurements = submitted.measurements && typeof submitted.measurements === "object" ? submitted.measurements : {};

  const gates = evaluateAllVerdictGates(measurements);
  const sceneCoverage = evaluateSceneCoverage(submitted.sceneRuns);
  const blindRound = evaluateBlindRound(submitted.crossProof);
  const phaseAuthorization = authorizePhaseCompletion(MSM_CERTIFICATION_PHASE_ID, measurements);

  const combinedStatus = combineStatuses([
    gateStatusOf(gates),
    sceneCoverage.status,
    blindRound.status,
    planAuthorityStatus(phaseAuthorization),
  ]);
  const certificationStatus = certificationStatusOf(combinedStatus);

  const blockingReasons = uniqueReasons(
    gates.gates
      .filter((gate) => gate.blocks)
      .map((gate) => "gate " + gate.planId + " is " + gate.status + ": " + gate.reason)
      .concat(sceneCoverage.blockingReasons)
      .concat(blindRound.blockingReasons)
      .concat(planAuthorityReasons(phaseAuthorization)),
  );

  return Object.freeze({
    phaseId: MSM_CERTIFICATION_PHASE_ID,
    status: certificationStatus,
    certified: certificationStatus === MSM_CERTIFICATION_STATUS.certified,
    blocks: certificationStatus !== MSM_CERTIFICATION_STATUS.certified,
    answerToSectionZero: answerToSectionZero(certificationStatus),
    referenceGpuClass: MSM_REFERENCE_GPU_CLASS,
    referenceResolutionScale: MSM_REFERENCE_RESOLUTION_SCALE,
    gates,
    sceneCoverage,
    blindRound,
    phaseAuthorization,
    blockingReasons: Object.freeze(blockingReasons),
  });
}


export function certificationSummary(evidence) {
  const verdict = certifyWeakGpuRound(evidence);
  return {
    phaseId: verdict.phaseId,
    status: verdict.status,
    answerToSectionZero: verdict.answerToSectionZero,
    totalGates: verdict.gates.totalGates,
    declaredByThePlan: MSM_SECTION_11_GATE_COUNT,
    gatesPassed: verdict.gates.passed,
    gatesPending: verdict.gates.pending,
    gatesFailed: verdict.gates.failed,
    scenesCovered: verdict.sceneCoverage.coveredSceneNumbers.length,
    scenesDeclaredByThePlan: MSM_PROOF_SCENE_COUNT,
    unjudgedSceneNumbers: verdict.sceneCoverage.unjudgedSceneNumbers,
    blindRoundStatus: verdict.blindRound.status,
    planAuthorizesThePhase: verdict.phaseAuthorization.authorized,
    blockingReasonCount: verdict.blockingReasons.length,
  };
}
