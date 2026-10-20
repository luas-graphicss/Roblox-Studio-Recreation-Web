import { MSM_GATE_COMPARISON, evaluateRequirement } from "./msmGateComparisonCore.js";
import {
  MSM_SAMPLE_PATTERN_PHASE_ID,
  MSM_SAMPLE_PATTERN_REFUSALS,
  resolveSamplePatternCycle,
  resolveSamplePatternGrid,
  sampledFullPixelForReducedPixel,
} from "./msmSamplePatternCore.js";


export const MSM_ROTATION_COVERAGE_GATE_PLAN_ID = "G14";
export const MSM_ROTATION_COVERAGE_GATE_METRIC = "closedRotationCoverageProofs";


export const MSM_SAMPLE_PATTERN_PROOF_ID = "reducedResolutionPixelPattern";
export const MSM_ROTATION_COVERAGE_SIBLING_PHASE_IDS = Object.freeze(["MSM-F15", "MSM-F17"]);


export const MSM_COVERAGE_PROOF_PIXEL_CEILING = 4194304;

export const MSM_COVERAGE_PROOF_REFUSALS = Object.freeze({
  degenerateFullResolution: "degenerateFullResolution",
  divisorRefused: "divisorRefused",
  imageTooLargeToProve: "imageTooLargeToProve",
  frameWindowNotPositive: "frameWindowNotPositive",
});

function readInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstRefusalOf(candidates) {
  for (let index = 0; index < candidates.length; index += 1) {
    if (candidates[index]) return candidates[index];
  }
  return null;
}

function problemsOf(requirements) {
  return requirements
    .filter((requirement) => requirement.blocks)
    .map((requirement) => requirement.metric + " - " + requirement.reason);
}


export function proveSubPixelRotation(request) {
  const source = request && typeof request === "object" ? request : {};
  const cycle = resolveSamplePatternCycle({ divisor: source.divisor });
  const cycleFrames = cycle.coverageCycleFrames;
  const blockX = readInteger(source.blockX, 0);
  const blockY = readInteger(source.blockY, 0);
  const startFrameIndex = readInteger(source.startFrameIndex, 0);


  const fullWidth = (blockX + 1) * cycle.divisor;
  const fullHeight = (blockY + 1) * cycle.divisor;
  const walkedFrameCount = cycleFrames + 1;

  const visitedPositions = [];
  const firstFrameByPosition = new Map();
  let distinctPositionCount = 0;
  let framesToCloseCoverage = null;
  let firstRepeatedPositionFrame = null;
  let refusedSampleCount = 0;

  for (let step = 0; step < walkedFrameCount; step += 1) {
    const sample = sampledFullPixelForReducedPixel({
      divisor: cycle.divisor,
      fullWidth,
      fullHeight,
      reducedX: blockX,
      reducedY: blockY,
      frameIndex: startFrameIndex + step,
      resolveNoiseValue: source.resolveNoiseValue,
    });
    if (!sample.inside) {
      refusedSampleCount += 1;
      visitedPositions.push(null);
      continue;
    }
    const positionKey = sample.subPixelX + "," + sample.subPixelY;
    visitedPositions.push(positionKey);
    if (firstFrameByPosition.has(positionKey)) {
      if (firstRepeatedPositionFrame === null) firstRepeatedPositionFrame = step;
      continue;
    }
    firstFrameByPosition.set(positionKey, step);
    distinctPositionCount += 1;
    if (distinctPositionCount === cycle.positionsPerBlock && framesToCloseCoverage === null) {
      framesToCloseCoverage = step + 1;
    }
  }

  const requirements = [
    evaluateRequirement(
      {
        metric: "framesToCloseSubPixelCoverage",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: cycleFrames,
        unit: "frames",
        description: "the block visits every sub pixel of the rotation in exactly divisor * divisor frames",
      },
      framesToCloseCoverage,
    ),
    evaluateRequirement(
      {
        metric: "firstRepeatedSubPixelFrame",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: cycleFrames,
        unit: "frames",
        description: "no position repeats before the cycle closes: the first repetition is the frame right after the cycle",
      },
      firstRepeatedPositionFrame,
    ),
    evaluateRequirement(
      {
        metric: "distinctSubPixelPositions",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: cycle.positionsPerBlock,
        unit: "positions",
        description: "the rotation touches every sub pixel of the block",
      },
      distinctPositionCount,
    ),
    evaluateRequirement(
      {
        metric: "refusedSubPixelSamples",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "samples",
        description: "a block entirely inside the image must not refuse a single sample",
      },
      refusedSampleCount,
    ),
  ];
  const problems = problemsOf(requirements);

  return Object.freeze({
    part: "subPixelRotation",
    divisor: cycle.divisor,
    divisorAccepted: cycle.divisorAccepted,
    coverageCycleFrames: cycleFrames,
    positionsPerBlock: cycle.positionsPerBlock,
    blockX,
    blockY,
    startFrameIndex,
    walkedFrameCount,
    framesToCloseCoverage,
    firstRepeatedPositionFrame,
    distinctPositionCount,
    refusedSampleCount,
    visitedPositions: Object.freeze(visitedPositions.slice()),
    requirements: Object.freeze(requirements),
    pass: problems.length === 0,
    blocks: problems.length !== 0,
    problems: Object.freeze(problems),
  });
}

function freezeFullResolutionVerdict(fields) {
  const grid = fields.grid;
  const requirements = fields.requirements === undefined ? [] : fields.requirements;
  const problems = fields.problems === undefined ? [] : fields.problems;
  return Object.freeze({
    part: "fullResolutionCoverage",
    divisor: grid.divisor,
    divisorAccepted: grid.cycle.divisorAccepted,
    fullWidth: grid.fullWidth,
    fullHeight: grid.fullHeight,
    fullPixelCount: grid.fullPixelCount,
    reducedWidth: grid.reducedWidth,
    reducedHeight: grid.reducedHeight,
    reducedPixelCount: grid.reducedPixelCount,
    hasPartialBlocks: grid.hasPartialBlocks,
    coverageCycleFrames: grid.coverageCycleFrames,
    startFrameIndex: fields.startFrameIndex,
    frameCount: fields.frameCount,
    framesToCloseCoverage: fields.framesToCloseCoverage === undefined ? null : fields.framesToCloseCoverage,
    pixelsSampledExactlyOnce: fields.pixelsSampledExactlyOnce === undefined ? 0 : fields.pixelsSampledExactlyOnce,
    pixelsNeverSampled: fields.pixelsNeverSampled === undefined ? grid.fullPixelCount : fields.pixelsNeverSampled,
    pixelsSampledMoreThanOnce: fields.pixelsSampledMoreThanOnce === undefined ? 0 : fields.pixelsSampledMoreThanOnce,
    maximumSamplesOnOnePixel: fields.maximumSamplesOnOnePixel === undefined ? 0 : fields.maximumSamplesOnOnePixel,
    insideSampleCount: fields.insideSampleCount === undefined ? 0 : fields.insideSampleCount,
    outsideImageSampleCount: fields.outsideImageSampleCount === undefined ? 0 : fields.outsideImageSampleCount,
    refusedSampleCount: fields.refusedSampleCount === undefined ? 0 : fields.refusedSampleCount,
    unaccountedSampleCount: fields.unaccountedSampleCount === undefined ? 0 : fields.unaccountedSampleCount,
    refusal: fields.refusal === undefined ? null : fields.refusal,
    requirements: Object.freeze(requirements),
    pass: Boolean(fields.pass),
    blocks: !fields.pass,
    problems: Object.freeze(problems),
  });
}


export function proveFullResolutionCoverage(request) {
  const source = request && typeof request === "object" ? request : {};
  const grid = resolveSamplePatternGrid({
    divisor: source.divisor,
    fullWidth: source.fullWidth,
    fullHeight: source.fullHeight,
  });
  const cycleFrames = grid.coverageCycleFrames;
  const startFrameIndex = readInteger(source.startFrameIndex, 0);
  const frameCount = readInteger(source.frameCount, cycleFrames);
  const refusal = firstRefusalOf([
    grid.refusal === MSM_SAMPLE_PATTERN_REFUSALS.degenerateFullResolution
      ? MSM_COVERAGE_PROOF_REFUSALS.degenerateFullResolution
      : null,
    grid.cycle.divisorAccepted ? null : MSM_COVERAGE_PROOF_REFUSALS.divisorRefused,
    grid.fullPixelCount > MSM_COVERAGE_PROOF_PIXEL_CEILING ? MSM_COVERAGE_PROOF_REFUSALS.imageTooLargeToProve : null,
    frameCount < 1 ? MSM_COVERAGE_PROOF_REFUSALS.frameWindowNotPositive : null,
  ]);

  if (refusal !== null) {
    return freezeFullResolutionVerdict({
      grid,
      startFrameIndex,
      frameCount,
      refusal,
      pass: false,
      problems: ["the coverage was not measured - " + refusal],
    });
  }

  const sampleCountByFullPixel = new Uint32Array(grid.fullPixelCount);
  let insideSampleCount = 0;
  let outsideImageSampleCount = 0;
  let refusedSampleCount = 0;
  let coveredPixelCount = 0;
  let framesToCloseCoverage = null;

  for (let step = 0; step < frameCount; step += 1) {
    const frameIndex = startFrameIndex + step;
    for (let reducedY = 0; reducedY < grid.reducedHeight; reducedY += 1) {
      for (let reducedX = 0; reducedX < grid.reducedWidth; reducedX += 1) {
        const sample = sampledFullPixelForReducedPixel({
          divisor: grid.divisor,
          fullWidth: grid.fullWidth,
          fullHeight: grid.fullHeight,
          reducedX,
          reducedY,
          frameIndex,
          resolveNoiseValue: source.resolveNoiseValue,
        });
        if (sample.inside) {
          const flatIndex = sample.fullY * grid.fullWidth + sample.fullX;
          if (sampleCountByFullPixel[flatIndex] === 0) coveredPixelCount += 1;
          sampleCountByFullPixel[flatIndex] += 1;
          insideSampleCount += 1;
        } else if (sample.refusal === MSM_SAMPLE_PATTERN_REFUSALS.sampleOutsideImage) {
          outsideImageSampleCount += 1;
        } else {
          refusedSampleCount += 1;
        }
      }
    }
    if (framesToCloseCoverage === null && coveredPixelCount === grid.fullPixelCount) {
      framesToCloseCoverage = step + 1;
    }
  }

  let pixelsSampledExactlyOnce = 0;
  let pixelsNeverSampled = 0;
  let pixelsSampledMoreThanOnce = 0;
  let maximumSamplesOnOnePixel = 0;
  for (let index = 0; index < sampleCountByFullPixel.length; index += 1) {
    const sampleCount = sampleCountByFullPixel[index];
    if (sampleCount === 0) pixelsNeverSampled += 1;
    else if (sampleCount === 1) pixelsSampledExactlyOnce += 1;
    else pixelsSampledMoreThanOnce += 1;
    if (sampleCount > maximumSamplesOnOnePixel) maximumSamplesOnOnePixel = sampleCount;
  }
  const unaccountedSampleCount =
    frameCount * grid.reducedPixelCount - (insideSampleCount + outsideImageSampleCount + refusedSampleCount);

  const requirements = [
    evaluateRequirement(
      {
        metric: "framesToCloseFullResolutionCoverage",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: cycleFrames,
        unit: "frames",
        description: "every pixel of the image received a sample after exactly divisor * divisor frames",
      },
      framesToCloseCoverage,
    ),
    evaluateRequirement(
      {
        metric: "fullResolutionPixelsSampledExactlyOnce",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: grid.fullPixelCount,
        unit: "pixels",
        description: "one cycle gives each pixel exactly one sample: no pixel is starved and none is paid for twice",
      },
      pixelsSampledExactlyOnce,
    ),
    evaluateRequirement(
      {
        metric: "fullResolutionPixelsNeverSampled",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "pixels",
        description: "a pixel that never gets a sample would keep a stale value forever",
      },
      pixelsNeverSampled,
    ),
    evaluateRequirement(
      {
        metric: "fullResolutionPixelsSampledMoreThanOnce",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "pixels",
        description: "a pixel sampled twice in one cycle is cost paid for nothing",
      },
      pixelsSampledMoreThanOnce,
    ),
    evaluateRequirement(
      {
        metric: "unaccountedSamples",
        comparison: MSM_GATE_COMPARISON.exactly,
        target: 0,
        unit: "samples",
        description: "every sample of the window was classified as inside, outside the image or refused",
      },
      unaccountedSampleCount,
    ),
  ];
  const problems = problemsOf(requirements);

  return freezeFullResolutionVerdict({
    grid,
    startFrameIndex,
    frameCount,
    framesToCloseCoverage,
    pixelsSampledExactlyOnce,
    pixelsNeverSampled,
    pixelsSampledMoreThanOnce,
    maximumSamplesOnOnePixel,
    insideSampleCount,
    outsideImageSampleCount,
    refusedSampleCount,
    unaccountedSampleCount,
    refusal: null,
    requirements,
    problems,
    pass: problems.length === 0,
  });
}


export function proveSamplePatternRotation(request) {
  const source = request && typeof request === "object" ? request : {};
  const subPixelRotation = proveSubPixelRotation({
    divisor: source.divisor,
    blockX: source.blockX,
    blockY: source.blockY,
    startFrameIndex: source.startFrameIndex,
    resolveNoiseValue: source.resolveNoiseValue,
  });
  const fullResolutionCoverage = proveFullResolutionCoverage({
    divisor: source.divisor,
    fullWidth: source.fullWidth,
    fullHeight: source.fullHeight,
    startFrameIndex: source.startFrameIndex,
    frameCount: source.frameCount,
    resolveNoiseValue: source.resolveNoiseValue,
  });
  const requirements = subPixelRotation.requirements.concat(fullResolutionCoverage.requirements);
  const problems = subPixelRotation.problems.concat(fullResolutionCoverage.problems);
  const pass = subPixelRotation.pass && fullResolutionCoverage.pass;

  return Object.freeze({
    proofId: MSM_SAMPLE_PATTERN_PROOF_ID,
    phaseId: MSM_SAMPLE_PATTERN_PHASE_ID,
    gatePlanId: MSM_ROTATION_COVERAGE_GATE_PLAN_ID,
    gateMetric: MSM_ROTATION_COVERAGE_GATE_METRIC,
    divisor: fullResolutionCoverage.divisor,
    coverageCycleFrames: fullResolutionCoverage.coverageCycleFrames,
    parts: Object.freeze([subPixelRotation, fullResolutionCoverage]),
    requirements: Object.freeze(requirements),
    pass,
    blocks: !pass,


    closedProofCount: pass ? 1 : 0,
    problems: Object.freeze(problems),
  });
}


export function describeRotationCoverageContribution() {
  return {
    gatePlanId: MSM_ROTATION_COVERAGE_GATE_PLAN_ID,
    gateMetric: MSM_ROTATION_COVERAGE_GATE_METRIC,
    proofId: MSM_SAMPLE_PATTERN_PROOF_ID,
    phaseId: MSM_SAMPLE_PATTERN_PHASE_ID,
    contributesProofCount: 1,
    siblingProofPhaseIds: MSM_ROTATION_COVERAGE_SIBLING_PHASE_IDS,
    note: "G14 counts 3 closed rotation proofs; this file answers only for the reduced resolution pixel pattern",
  };
}
