import {
  MGL_MAX_SAMPLES_PER_PIXEL,
  MGL_MAX_VISIBLE_LIGHTS_PER_TILE,
  tierDefaults,
} from "./mlPipelineContract.js";
import { allocateSampleBudget } from "./mlHiddenLightBudgetCore.js";
import {
  createReservoirSet,
  offerCandidateToReservoirSet,
  resetReservoirSet,
  selectionProbability,
  unbiasedEstimatorWeight,
} from "./mlWeightedReservoirCore.js";
import {
  SAMPLE_WEIGHT_REJECTION,
  createSurfaceDescription,
  sampleWeightForLight,
} from "./mlSampleWeightCore.js";
import { ALL_QUADRANTS_ENABLED_MASK, remapUnitSquareWithBitmask } from "./mlAreaSampleBitmaskCore.js";
import { SAMPLE_DIMENSION, isAcceptedRandomSource } from "./mlSampleRandomSourceCore.js";

export const LIGHT_SAMPLE_GENERATION_OWNER = "ML-F11";
export const LIGHT_SAMPLE_GENERATION_PASS_NAME = "lightSampleGeneration";

export const LIGHT_SAMPLE_GENERATION_REFUSAL_CODES = Object.freeze([
  "lightSampleGeneration.noHiddenLightDownWeighting",
  "lightSampleGeneration.noUncorrelatedRandom",
  "lightSampleGeneration.noOneLightPerPixel",
]);


export const LIGHT_SAMPLE_GENERATION_FLAG_ID = "MegaLightsLightSampleGeneration";
export const LIGHT_SAMPLE_GENERATION_FLAG_DEFAULTS = Object.freeze({ fraco: false, medio: true, forte: true });


export const LIGHT_SAMPLE_GLSL_FLAG_ID = "MegaLightsLightSampleGlsl";
export const LIGHT_SAMPLE_GLSL_FLAG_DEFAULTS = Object.freeze({ fraco: false, medio: false, forte: false });

export const SAMPLE_ORIGIN = Object.freeze({ guided: "guided", hidden: "hidden" });


export const HIDDEN_CANDIDATES_PER_HIDDEN_SAMPLE = 2;
export const GUIDED_CANDIDATE_CEILING = MGL_MAX_VISIBLE_LIGHTS_PER_TILE;
export const NO_LIGHT_INDEX = -1;


export function candidateEvaluationCeiling(samplesPerPixel) {
  return GUIDED_CANDIDATE_CEILING + clampSamplesPerPixel(samplesPerPixel) * HIDDEN_CANDIDATES_PER_HIDDEN_SAMPLE;
}

export function clampSamplesPerPixel(value) {
  const requested = Math.floor(Number(value));
  if (!Number.isFinite(requested) || requested < 1) return 1;
  if (requested > MGL_MAX_SAMPLES_PER_PIXEL) return MGL_MAX_SAMPLES_PER_PIXEL;
  return requested;
}


export function samplesPerPixelForTier(tierName) {
  const defaults = tierDefaults(tierName) || {};
  return clampSamplesPerPixel(defaults.samplesPerPixel);
}

function guidedEntryLightIndex(entry) {
  if (!entry) return NO_LIGHT_INDEX;
  const lightIndex = Math.floor(Number(entry.lightIndex));
  return Number.isFinite(lightIndex) && lightIndex >= 0 ? lightIndex : NO_LIGHT_INDEX;
}

function guidedEntryGuidingWeight(entry) {
  const weight = Number(entry && (entry.tileContributionWeight !== undefined ? entry.tileContributionWeight : entry.weight));
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

function guidedEntryShapeIndex(entry) {
  const shapeIndex = Math.floor(
    Number(entry && (entry.lightShapeIndex !== undefined ? entry.lightShapeIndex : entry.shapeIndex)),
  );
  return Number.isFinite(shapeIndex) && shapeIndex > 0 ? shapeIndex : 0;
}


export function createLightSampleGenerator(options) {
  const settings = options && typeof options === "object" ? options : {};
  const defaultRandomSource = settings.randomSource || null;

  const guidedReservoirSetsBySlotCount = new Map();
  const hiddenReservoirSetsBySlotCount = new Map();
  const candidatePool = [];
  const samplePool = [];
  const drawnSamples = [];
  const problems = [];
  const guidedLightIndices = [];
  const lightDescriptor = {};


  const slotRandomContext = {
    source: null,
    pixelX: 0,
    pixelY: 0,
    frameIndex: 0,
    candidateIndex: 0,
    slotOffset: 0,
  };

  function unitRandomForSlot(slotIndex) {
    return slotRandomContext.source.unitRandom({
      pixelX: slotRandomContext.pixelX,
      pixelY: slotRandomContext.pixelY,
      frameIndex: slotRandomContext.frameIndex,
      slotIndex: slotRandomContext.slotOffset + slotIndex,
      candidateIndex: slotRandomContext.candidateIndex,
      dimensionIndex: SAMPLE_DIMENSION.lightSelection,
    });
  }

  function acquireReservoirSet(cache, slotCount) {
    if (!(slotCount > 0)) return null;
    const existing = cache.get(slotCount);
    if (existing) return resetReservoirSet(existing);
    const created = createReservoirSet(slotCount);
    cache.set(slotCount, created);
    return created;
  }

  function acquireCandidate(index) {
    let candidate = candidatePool[index];
    if (!candidate) {
      candidate = { lightIndex: NO_LIGHT_INDEX, origin: SAMPLE_ORIGIN.guided, needsShadowTrace: false, lightShapeIndex: 0, brdfWeightedLuminance: 0 };
      candidatePool[index] = candidate;
    }
    return candidate;
  }

  function acquireSample(index) {
    let sample = samplePool[index];
    if (!sample) {
      sample = {
        slotIndex: 0,
        origin: SAMPLE_ORIGIN.guided,
        lightIndex: NO_LIGHT_INDEX,
        weight: 0,
        selectionProbability: 0,
        estimatorWeight: 0,
        brdfWeightedLuminance: 0,
        sourcePointU: 0,
        sourcePointV: 0,
        quadrantIndex: 0,
        needsShadowTrace: false,
        lightShapeIndex: 0,
      };
      samplePool[index] = sample;
    }
    return sample;
  }

  function readLightDescriptor(readLightAt, lightIndex) {
    if (typeof readLightAt !== "function") return null;
    const light = readLightAt(lightIndex, lightDescriptor);
    return light && typeof light === "object" ? light : null;
  }

  function drawSourcePoint(sample, source, absoluteSlotIndex, areaSampleBitmaskOf) {
    const unitU = source.unitRandom({
      pixelX: slotRandomContext.pixelX,
      pixelY: slotRandomContext.pixelY,
      frameIndex: slotRandomContext.frameIndex,
      slotIndex: absoluteSlotIndex,
      candidateIndex: 0,
      dimensionIndex: SAMPLE_DIMENSION.sourcePointU,
    });
    const unitV = source.unitRandom({
      pixelX: slotRandomContext.pixelX,
      pixelY: slotRandomContext.pixelY,
      frameIndex: slotRandomContext.frameIndex,
      slotIndex: absoluteSlotIndex,
      candidateIndex: 0,
      dimensionIndex: SAMPLE_DIMENSION.sourcePointV,
    });

    const mask = typeof areaSampleBitmaskOf === "function"
      ? Math.floor(Number(areaSampleBitmaskOf(sample.lightIndex)))
      : ALL_QUADRANTS_ENABLED_MASK;
    const usableMask = Number.isFinite(mask) ? mask : ALL_QUADRANTS_ENABLED_MASK;
    const remapped = remapUnitSquareWithBitmask(unitU, unitV, usableMask);

    sample.sourcePointU = remapped.u1;
    sample.sourcePointV = remapped.u2;
    sample.quadrantIndex = remapped.quadrantIndex;


    if (remapped.probabilityDensityScale > 0) sample.estimatorWeight /= remapped.probabilityDensityScale;
    return remapped;
  }

  function collectDrawnSamples(reservoirSet, origin, slotOffset, populationScale, source, areaSampleBitmaskOf) {
    if (!reservoirSet) return;
    for (let slotIndex = 0; slotIndex < reservoirSet.slotCount; slotIndex += 1) {
      const slot = reservoirSet.slots[slotIndex];
      if (slot.candidate === null) continue;
      const sample = acquireSample(drawnSamples.length);
      const absoluteSlotIndex = slotOffset + slotIndex;
      sample.slotIndex = absoluteSlotIndex;
      sample.origin = origin;
      sample.lightIndex = slot.candidate.lightIndex;
      sample.needsShadowTrace = slot.candidate.needsShadowTrace;
      sample.lightShapeIndex = slot.candidate.lightShapeIndex;
      sample.brdfWeightedLuminance = slot.candidate.brdfWeightedLuminance;
      sample.weight = slot.weight;
      sample.selectionProbability = selectionProbability(slot.weight, reservoirSet.weightSum);
      sample.estimatorWeight =
        unbiasedEstimatorWeight(slot.weight, reservoirSet.weightSum, reservoirSet.slotCount) * populationScale;
      drawSourcePoint(sample, source, absoluteSlotIndex, areaSampleBitmaskOf);
      drawnSamples.push(sample);
    }
  }


  function generateForPixel(request) {
    const input = request && typeof request === "object" ? request : {};
    problems.length = 0;
    drawnSamples.length = 0;
    guidedLightIndices.length = 0;

    const samplesPerPixel = clampSamplesPerPixel(input.samplesPerPixel);
    const surface = input.surface || createSurfaceDescription(null);
    const source = input.randomSource || defaultRandomSource;
    const readLightAt = input.readLightAt;
    const areaSampleBitmaskOf = input.areaSampleBitmaskOf;

    slotRandomContext.source = source;
    slotRandomContext.pixelX = Math.floor(Number(input.pixelX) || 0);
    slotRandomContext.pixelY = Math.floor(Number(input.pixelY) || 0);
    slotRandomContext.frameIndex = Math.floor(Number(input.frameIndex) || 0);


    if (!isAcceptedRandomSource(source)) {
      problems.push(
        "lightSampleGeneration.noUncorrelatedRandom: the random source is missing or its spectrum is not filterable, so this pixel drew nothing",
      );
      return buildResult(samplesPerPixel, null, 0, 0, 0, 0, 1, false);
    }


    const guidedLights = Array.isArray(input.guidedLights) ? input.guidedLights : [];
    const guidedCandidateCount = Math.min(guidedLights.length, GUIDED_CANDIDATE_CEILING);
    if (guidedLights.length > GUIDED_CANDIDATE_CEILING) {
      problems.push(
        "the guiding list brought " + guidedLights.length + " lights and the contract ceiling is " +
          GUIDED_CANDIDATE_CEILING + ": the extra entries were not evaluated, so the cost stays fixed",
      );
    }

    let candidateEvaluationCount = 0;
    let guidedWeightSum = 0;
    let guidedWeightedCandidateCount = 0;
    for (let index = 0; index < guidedCandidateCount; index += 1) {
      const entry = guidedLights[index];
      const lightIndex = guidedEntryLightIndex(entry);
      if (lightIndex === NO_LIGHT_INDEX) continue;
      const light = readLightDescriptor(readLightAt, lightIndex);
      candidateEvaluationCount += 1;
      if (!light) {
        problems.push("guided light " + lightIndex + " has no descriptor in the packed buffer and was skipped");
        continue;
      }
      const weighted = sampleWeightForLight({ light, surface });
      const candidate = acquireCandidate(guidedWeightedCandidateCount);
      candidate.lightIndex = lightIndex;
      candidate.origin = SAMPLE_ORIGIN.guided;
      candidate.needsShadowTrace = !!(entry && entry.needsShadowTrace);
      candidate.lightShapeIndex = guidedEntryShapeIndex(entry) || Math.max(0, Math.floor(Number(light.shapeIndex) || 0));
      candidate.brdfWeightedLuminance = weighted.brdfWeightedLuminance;
      candidate.weight = weighted.weight;
      candidate.rejection = weighted.rejection;
      candidate.guidingWeight = guidedEntryGuidingWeight(entry);
      guidedLightIndices.push(lightIndex);
      guidedWeightSum += weighted.weight;
      guidedWeightedCandidateCount += 1;
    }


    const hiddenLightCount =
      input.hiddenLightCount === null || input.hiddenLightCount === undefined
        ? null
        : Math.max(0, Math.floor(Number(input.hiddenLightCount) || 0));
    const budget = allocateSampleBudget({
      sampleBudget: samplesPerPixel,
      visibleLightCount: guidedWeightedCandidateCount,
      visibleWeightSum: guidedWeightSum,
      hiddenLightCount,
      historyReprojectionValid: input.historyReprojectionValid !== false,
      randomValue: source.unitRandom({
        pixelX: slotRandomContext.pixelX,
        pixelY: slotRandomContext.pixelY,
        frameIndex: slotRandomContext.frameIndex,
        slotIndex: 0,
        candidateIndex: 0,
        dimensionIndex: SAMPLE_DIMENSION.hiddenBudgetRounding,
      }),
    });
    budget.problems.forEach((problem) => problems.push("ML-F10: " + problem));


    const guidedReservoirSet = acquireReservoirSet(guidedReservoirSetsBySlotCount, budget.guidedSampleCount);
    if (guidedReservoirSet) {
      slotRandomContext.slotOffset = 0;
      for (let index = 0; index < guidedWeightedCandidateCount; index += 1) {
        const candidate = candidatePool[index];
        slotRandomContext.candidateIndex = index;
        offerCandidateToReservoirSet(guidedReservoirSet, candidate, candidate.weight, unitRandomForSlot);
      }
    }


    const hiddenDrawCeiling = budget.hiddenSampleCount * HIDDEN_CANDIDATES_PER_HIDDEN_SAMPLE;
    const hiddenReservoirSet = acquireReservoirSet(hiddenReservoirSetsBySlotCount, budget.hiddenSampleCount);
    let hiddenCandidateCount = 0;
    let hiddenWeightSum = 0;
    if (hiddenReservoirSet && typeof input.hiddenLightIndexAt === "function") {
      slotRandomContext.slotOffset = budget.guidedSampleCount;
      for (let drawIndex = 0; drawIndex < hiddenDrawCeiling; drawIndex += 1) {
        const drawRandom = source.unitRandom({
          pixelX: slotRandomContext.pixelX,
          pixelY: slotRandomContext.pixelY,
          frameIndex: slotRandomContext.frameIndex,
          slotIndex: budget.guidedSampleCount,
          candidateIndex: drawIndex,
          dimensionIndex: SAMPLE_DIMENSION.lightSelection,
        });
        const lightIndex = Math.floor(Number(input.hiddenLightIndexAt(drawIndex, drawRandom)));
        if (!(lightIndex >= 0)) continue;


        if (guidedLightIndices.indexOf(lightIndex) !== -1) continue;
        const light = readLightDescriptor(readLightAt, lightIndex);
        candidateEvaluationCount += 1;
        if (!light) continue;
        const weighted = sampleWeightForLight({ light, surface });
        const candidate = acquireCandidate(guidedWeightedCandidateCount + hiddenCandidateCount);
        candidate.lightIndex = lightIndex;
        candidate.origin = SAMPLE_ORIGIN.hidden;


        candidate.needsShadowTrace = true;
        candidate.lightShapeIndex = Math.max(0, Math.floor(Number(light.shapeIndex) || 0));
        candidate.brdfWeightedLuminance = weighted.brdfWeightedLuminance;
        candidate.weight = weighted.weight;
        candidate.rejection = weighted.rejection;
        slotRandomContext.candidateIndex = drawIndex;
        offerCandidateToReservoirSet(hiddenReservoirSet, candidate, weighted.weight, unitRandomForSlot);
        hiddenWeightSum += weighted.weight;
        hiddenCandidateCount += 1;
      }
    } else if (budget.hiddenSampleCount > 0) {
      problems.push(
        "the budget reserved " + budget.hiddenSampleCount +
          " hidden sample(s) and no hiddenLightIndexAt(drawIndex, unitRandom) was given: a new light can never be found",
      );
    }

    let hiddenPopulationScale = 1;
    if (hiddenCandidateCount > 0) {
      if (hiddenLightCount === null) {
        problems.push(
          "hiddenLightCount is unknown, so the hidden estimate was NOT scaled to the population: the hidden share of this pixel is a lower bound",
        );
      } else if (hiddenLightCount > hiddenCandidateCount) {
        hiddenPopulationScale = hiddenLightCount / hiddenCandidateCount;
      }
    }


    collectDrawnSamples(guidedReservoirSet, SAMPLE_ORIGIN.guided, 0, 1, source, areaSampleBitmaskOf);
    collectDrawnSamples(
      hiddenReservoirSet,
      SAMPLE_ORIGIN.hidden,
      budget.guidedSampleCount,
      hiddenPopulationScale,
      source,
      areaSampleBitmaskOf,
    );

    return buildResult(
      samplesPerPixel,
      budget,
      guidedWeightSum,
      hiddenWeightSum,
      guidedWeightedCandidateCount,
      hiddenCandidateCount,
      hiddenPopulationScale,
      true,
      candidateEvaluationCount,
    );
  }

  const result = {
    samples: drawnSamples,
    problems,
    samplesPerPixel: 0,
    budget: null,
    guidedWeightSum: 0,
    hiddenWeightSum: 0,
    guidedCandidateCount: 0,
    hiddenCandidateCount: 0,
    hiddenPopulationScale: 1,
    randomSourceAccepted: false,
    candidateEvaluationCount: 0,
    candidateEvaluationCeiling: 0,
    distinctLightCount: 0,
  };

  function buildResult(
    samplesPerPixel,
    budget,
    guidedWeightSum,
    hiddenWeightSum,
    guidedCandidateCount,
    hiddenCandidateCount,
    hiddenPopulationScale,
    randomSourceAccepted,
    candidateEvaluationCount,
  ) {
    let distinctLightCount = 0;
    for (let index = 0; index < drawnSamples.length; index += 1) {
      let alreadySeen = false;
      for (let earlier = 0; earlier < index; earlier += 1) {
        if (drawnSamples[earlier].lightIndex === drawnSamples[index].lightIndex) {
          alreadySeen = true;
          break;
        }
      }
      if (!alreadySeen) distinctLightCount += 1;
    }

    result.samplesPerPixel = samplesPerPixel;
    result.budget = budget;
    result.guidedWeightSum = guidedWeightSum;
    result.hiddenWeightSum = hiddenWeightSum;
    result.guidedCandidateCount = guidedCandidateCount;
    result.hiddenCandidateCount = hiddenCandidateCount;
    result.hiddenPopulationScale = hiddenPopulationScale;
    result.randomSourceAccepted = randomSourceAccepted;
    result.candidateEvaluationCount = Number(candidateEvaluationCount) || 0;
    result.candidateEvaluationCeiling = candidateEvaluationCeiling(samplesPerPixel);
    result.distinctLightCount = distinctLightCount;
    return result;
  }

  return {
    generateForPixel,


    reset() {
      guidedReservoirSetsBySlotCount.clear();
      hiddenReservoirSetsBySlotCount.clear();
      candidatePool.length = 0;
      samplePool.length = 0;
      drawnSamples.length = 0;
      problems.length = 0;
      return true;
    },

    describe() {
      return describeLightSampleGeneration();
    },
  };
}


export function describeLightSampleGeneration() {
  return {
    owner: LIGHT_SAMPLE_GENERATION_OWNER,
    passName: LIGHT_SAMPLE_GENERATION_PASS_NAME,
    draw: "weighted reservoir sampling, one independent reservoir per slot (Efraimidis and Spirakis 2006)",
    weight: "log2(luminance(BRDF weighted contribution)) + 1",
    guidedCandidateCeiling: GUIDED_CANDIDATE_CEILING,
    hiddenCandidatesPerHiddenSample: HIDDEN_CANDIDATES_PER_HIDDEN_SAMPLE,
    maximumSamplesPerPixel: MGL_MAX_SAMPLES_PER_PIXEL,
    samplesPerPixelByTier: {
      fraco: samplesPerPixelForTier("fraco"),
      medio: samplesPerPixelForTier("medio"),
      forte: samplesPerPixelForTier("forte"),
    },
    refuses: LIGHT_SAMPLE_GENERATION_REFUSAL_CODES,
    rejectionReasons: SAMPLE_WEIGHT_REJECTION,
  };
}
