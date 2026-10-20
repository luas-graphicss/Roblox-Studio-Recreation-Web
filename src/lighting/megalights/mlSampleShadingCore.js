import * as samplingGeometry from "./mlSamplingGeometryCore.js";
import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import {
  clampCosine,
  diffuseLobeWithoutAlbedo,
  specularLobeWithoutEnvBrdf,
} from "./mlMicrofacetBrdfCore.js";


export const SHADED_SIGNAL_CHANNELS = Object.freeze([
  "radianceR",
  "radianceG",
  "radianceB",
  "sampleWeightSum",
]);

export const SAMPLE_SHADING_PASS_NAME = "sampleShading";


export const SAMPLE_SHADING_ENFORCED_REFUSALS = Object.freeze([
  "sampleShading.noCosmeticDarkening",
  "sampleShading.noAlbedoBeforeDenoise",
]);

export const SAMPLE_SKIP_REASON = Object.freeze({
  occluded: "occluded",
  unknownVisibility: "unknownVisibility",
  belowHorizon: "belowHorizon",
  degeneratePdf: "degeneratePdf",
  nonPositiveWeight: "nonPositiveWeight",
});


export const ASSUMED_TRACE_RESULT_INDEX = Object.freeze({
  [MGL_TRACE_RESULT.visible]: 0,
  [MGL_TRACE_RESULT.occluded]: 1,
  [MGL_TRACE_RESULT.unknown]: 2,
});

export function traceResultIndexOf(traceResult) {
  const index = ASSUMED_TRACE_RESULT_INDEX[traceResult];
  return index === undefined ? ASSUMED_TRACE_RESULT_INDEX[MGL_TRACE_RESULT.unknown] : index;
}

function emptyCounters(drawnSampleCount) {
  return {
    drawn: drawnSampleCount,
    shaded: 0,
    occluded: 0,
    unknownVisibility: 0,
    belowHorizon: 0,
    degeneratePdf: 0,
    nonPositiveWeight: 0,

    occludedSamplesShaded: 0,
  };
}


export function shadePixelSamples(request) {
  const surface = (request && request.surface) || {};
  const samples = (request && request.samples) || [];


  const requestedDrawnCount = Number(request && request.drawnSampleCount);
  const drawnSampleCount = Number.isFinite(requestedDrawnCount)
    ? Math.max(requestedDrawnCount, samples.length)
    : samples.length;

  const counters = emptyCounters(drawnSampleCount);
  const normal = samplingGeometry.normalizeVector(surface.normal || { x: 0, y: 0, z: 1 });
  const viewDirection = samplingGeometry.normalizeVector(surface.viewDirection || { x: 0, y: 0, z: 1 });
  const cosineViewAngle = clampCosine(samplingGeometry.dotProduct(normal, viewDirection));
  const roughness = surface.roughness;

  let diffuseRed = 0;
  let diffuseGreen = 0;
  let diffuseBlue = 0;
  let specularRed = 0;
  let specularGreen = 0;
  let specularBlue = 0;
  let weightSum = 0;

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
    const sample = samples[sampleIndex] || {};

    if (sample.traceResult === MGL_TRACE_RESULT.occluded) {
      counters.occluded++;
      continue;
    }
    if (sample.traceResult !== MGL_TRACE_RESULT.visible) {
      counters.unknownVisibility++;
      continue;
    }

    const lightDirection = samplingGeometry.normalizeVector(sample.direction || { x: 0, y: 0, z: 0 });
    const cosineLightAngle = samplingGeometry.dotProduct(normal, lightDirection);
    if (!(cosineLightAngle > 0)) {
      counters.belowHorizon++;
      continue;
    }

    const probabilityDensity = Number(sample.probabilityDensity);
    if (!(probabilityDensity > 0)) {
      counters.degeneratePdf++;
      continue;
    }

    const reservoirWeight = sample.reservoirWeight === undefined ? 1 : Number(sample.reservoirWeight);
    if (!(reservoirWeight > 0)) {
      counters.nonPositiveWeight++;
      continue;
    }


    if (sample.traceResult !== MGL_TRACE_RESULT.visible) counters.occludedSamplesShaded++;

    const throughput = reservoirWeight / probabilityDensity;
    const radiance = sample.radiance || { r: 0, g: 0, b: 0 };

    const diffuseWeight = diffuseLobeWithoutAlbedo() * cosineLightAngle * throughput;

    const halfVector = samplingGeometry.normalizeVector(
      samplingGeometry.addVectors(lightDirection, viewDirection),
    );
    const cosineHalfAngle = clampCosine(samplingGeometry.dotProduct(normal, halfVector));
    const specularWeight =
      specularLobeWithoutEnvBrdf({
        roughness,
        cosineHalfAngle,
        cosineViewAngle,
        cosineLightAngle,
      }) *
      cosineLightAngle *
      throughput;

    diffuseRed += (Number(radiance.r) || 0) * diffuseWeight;
    diffuseGreen += (Number(radiance.g) || 0) * diffuseWeight;
    diffuseBlue += (Number(radiance.b) || 0) * diffuseWeight;
    specularRed += (Number(radiance.r) || 0) * specularWeight;
    specularGreen += (Number(radiance.g) || 0) * specularWeight;
    specularBlue += (Number(radiance.b) || 0) * specularWeight;
    weightSum += reservoirWeight;
    counters.shaded++;
  }

  const normalization = drawnSampleCount > 0 ? 1 / drawnSampleCount : 0;
  return {
    diffuse: {
      r: diffuseRed * normalization,
      g: diffuseGreen * normalization,
      b: diffuseBlue * normalization,
    },
    specular: {
      r: specularRed * normalization,
      g: specularGreen * normalization,
      b: specularBlue * normalization,
    },


    sampleWeightSum: weightSum * normalization,
    counters,
  };
}


export function shadedDiffuseTexel(shadingResult) {
  return [
    shadingResult.diffuse.r,
    shadingResult.diffuse.g,
    shadingResult.diffuse.b,
    shadingResult.sampleWeightSum,
  ];
}

export function shadedSpecularTexel(shadingResult) {
  return [
    shadingResult.specular.r,
    shadingResult.specular.g,
    shadingResult.specular.b,
    shadingResult.sampleWeightSum,
  ];
}

export function describeSampleShading() {
  return {
    passName: SAMPLE_SHADING_PASS_NAME,
    owner: "ML-F18",
    writesBuffers: ["shadedDiffuse", "shadedSpecular"],
    channels: SHADED_SIGNAL_CHANNELS,
    factoredOut: ["albedo", "envBrdf"],
    dividesBy: "the drawn sample budget, never the survivors",
    enforcedRefusals: SAMPLE_SHADING_ENFORCED_REFUSALS,
    assumedTraceResultIndex: ASSUMED_TRACE_RESULT_INDEX,
  };
}
