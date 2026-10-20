import { MGL_TIER_DEFAULTS, MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import { traceOcclusion } from "./mlBvhTraversalCore.js";

export const RAY_TRACE_PASS_NAME = "rayTrace";
export const RAY_TRACE_KIND = "rayTrace";

export const RAY_ORIGIN_BIAS_STUDS = 0.05;

export const SCREEN_TRACE_PARITY_TOLERANCE = 0.05;


export const RAY_TRACE_REFUSAL_CODES = Object.freeze([
  "rayTrace.noWeakTier",
  "rayTrace.noUnboundedRays",
]);


export const TRACE_RESULT_ORDER = Object.freeze([
  MGL_TRACE_RESULT.visible,
  MGL_TRACE_RESULT.occluded,
  MGL_TRACE_RESULT.unknown,
]);

export function traceResultIndex(resultName) {
  const index = TRACE_RESULT_ORDER.indexOf(resultName);
  return index >= 0 ? index : TRACE_RESULT_ORDER.indexOf(MGL_TRACE_RESULT.unknown);
}

export function traceResultFromIndex(index) {
  const position = Math.round(Number(index));
  return TRACE_RESULT_ORDER[position] || MGL_TRACE_RESULT.unknown;
}


export function raysPerPixelForTier(tierName) {
  const tier = MGL_TIER_DEFAULTS[tierName];
  if (!tier || tier.rayTraceEnabled !== true) return 0;
  const raysPerPixel = Number(tier.raysPerPixel);
  if (!Number.isFinite(raysPerPixel) || raysPerPixel <= 0) return 0;
  return Math.floor(raysPerPixel);
}

export function isRayTraceAllowedForTier(tierName) {
  return raysPerPixelForTier(tierName) > 0;
}

function isFiniteTriple(candidate) {
  return (
    !!candidate &&
    Number.isFinite(candidate[0]) &&
    Number.isFinite(candidate[1]) &&
    Number.isFinite(candidate[2])
  );
}

function invalidRay(reason) {
  return Object.freeze({ valid: false, reason, origin: null, direction: null, minimumDistance: 0, maximumDistance: 0 });
}


export function rayForLightSample(request) {
  const settings = request || {};
  const biasStuds = Number.isFinite(Number(settings.biasStuds))
    ? Number(settings.biasStuds)
    : RAY_ORIGIN_BIAS_STUDS;
  if (!isFiniteTriple(settings.receiverPosition)) return invalidRay("receiver position is not finite");
  if (!isFiniteTriple(settings.receiverNormal)) return invalidRay("receiver normal is not finite");
  if (!isFiniteTriple(settings.lightSamplePosition)) return invalidRay("light sample position is not finite");
  if (!(biasStuds >= 0)) return invalidRay("bias must not be negative");

  const normalLength = Math.sqrt(
    settings.receiverNormal[0] * settings.receiverNormal[0] +
      settings.receiverNormal[1] * settings.receiverNormal[1] +
      settings.receiverNormal[2] * settings.receiverNormal[2],
  );
  if (!(normalLength > 1e-6)) return invalidRay("receiver normal has no length");

  const origin = [
    settings.receiverPosition[0] + (settings.receiverNormal[0] / normalLength) * biasStuds,
    settings.receiverPosition[1] + (settings.receiverNormal[1] / normalLength) * biasStuds,
    settings.receiverPosition[2] + (settings.receiverNormal[2] / normalLength) * biasStuds,
  ];
  const deltaX = settings.lightSamplePosition[0] - origin[0];
  const deltaY = settings.lightSamplePosition[1] - origin[1];
  const deltaZ = settings.lightSamplePosition[2] - origin[2];
  const distanceToLightSample = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
  if (!(distanceToLightSample > biasStuds)) {
    return invalidRay("the light sample is closer than the bias: nothing can be proved");
  }

  return Object.freeze({
    valid: true,
    reason: "",
    origin: Object.freeze(origin),
    direction: Object.freeze([
      deltaX / distanceToLightSample,
      deltaY / distanceToLightSample,
      deltaZ / distanceToLightSample,
    ]),
    minimumDistance: biasStuds,

    maximumDistance: distanceToLightSample - biasStuds,
    distanceToLightSample,
    biasStuds,
  });
}


export function shouldPromoteSample(sample) {
  const result = sample && sample.result ? sample.result : MGL_TRACE_RESULT.unknown;
  if (result === MGL_TRACE_RESULT.visible || result === MGL_TRACE_RESULT.occluded) {
    return { promote: false, reason: "already resolved upstream as " + result };
  }
  return { promote: true, reason: "upstream left it unknown" };
}

function resolution(result, raysSpent, reason, statistics) {
  return Object.freeze({
    result,
    traceKind: RAY_TRACE_KIND,
    resolved: result === MGL_TRACE_RESULT.visible || result === MGL_TRACE_RESULT.occluded,
    raysSpent,
    reason,
    statistics: statistics || null,
  });
}


export function resolveSampleWithRayTrace(request) {
  const settings = request || {};
  const sample = settings.sample || {};
  const upstreamResult = sample.result || MGL_TRACE_RESULT.unknown;

  if (!isRayTraceAllowedForTier(settings.tierName)) {
    return resolution(upstreamResult, 0, RAY_TRACE_REFUSAL_CODES[0] + ": tier " + settings.tierName + " traces no rays", null);
  }

  const promotion = shouldPromoteSample(sample);
  if (!promotion.promote) return resolution(upstreamResult, 0, promotion.reason, null);

  const ray = rayForLightSample({
    receiverPosition: sample.receiverPosition,
    receiverNormal: sample.receiverNormal,
    lightSamplePosition: sample.lightSamplePosition,
    biasStuds: settings.biasStuds,
  });
  if (!ray.valid) return resolution(MGL_TRACE_RESULT.unknown, 0, ray.reason, null);

  const budget = settings.budget || null;
  if (budget && !budget.spend(1)) {


    return resolution(MGL_TRACE_RESULT.unknown, 0, RAY_TRACE_REFUSAL_CODES[1] + ": frame ray budget exhausted", null);
  }

  const trace = traceOcclusion({
    payload: settings.payload,
    origin: ray.origin,
    direction: ray.direction,
    minimumDistance: ray.minimumDistance,
    maximumDistance: ray.maximumDistance,
    maximumNodeVisits: settings.maximumNodeVisits,
  });
  return resolution(trace.result, 1, trace.reason, {
    nodeVisitCount: trace.nodeVisitCount,
    triangleTestCount: trace.triangleTestCount,
    stackHighWaterMark: trace.stackHighWaterMark,
  });
}


export function compareVisibilityAgainstReference(request) {
  const settings = request || {};
  const traced = Array.isArray(settings.traced) ? settings.traced : [];
  const reference = Array.isArray(settings.reference) ? settings.reference : [];
  const tolerance = Number.isFinite(Number(settings.tolerance))
    ? Number(settings.tolerance)
    : SCREEN_TRACE_PARITY_TOLERANCE;
  const comparableCount = Math.min(traced.length, reference.length);

  let comparedCount = 0;
  let disagreementCount = 0;
  let notComparableCount = 0;
  for (let index = 0; index < comparableCount; index++) {
    const tracedResult = traced[index];
    const referenceResult = reference[index];
    const tracedIsDefinite = tracedResult === MGL_TRACE_RESULT.visible || tracedResult === MGL_TRACE_RESULT.occluded;
    const referenceIsDefinite =
      referenceResult === MGL_TRACE_RESULT.visible || referenceResult === MGL_TRACE_RESULT.occluded;
    if (!tracedIsDefinite || !referenceIsDefinite) {
      notComparableCount++;
      continue;
    }
    comparedCount++;
    if (tracedResult !== referenceResult) disagreementCount++;
  }

  const disagreementRatio = comparedCount > 0 ? disagreementCount / comparedCount : 0;
  return Object.freeze({
    comparedCount,
    disagreementCount,
    notComparableCount,
    disagreementRatio,
    tolerance,
    withinTolerance: comparedCount > 0 && disagreementRatio <= tolerance,
    reason:
      comparedCount === 0
        ? "nothing was comparable: every pair had an unknown on one side"
        : disagreementCount + " of " + comparedCount + " comparable samples disagree",
  });
}

export function describeRayPolicy() {
  return {
    passName: RAY_TRACE_PASS_NAME,
    biasStuds: RAY_ORIGIN_BIAS_STUDS,
    parityTolerance: SCREEN_TRACE_PARITY_TOLERANCE,
    refusalCodes: RAY_TRACE_REFUSAL_CODES,
    raysPerPixelByTier: {
      fraco: raysPerPixelForTier("fraco"),
      medio: raysPerPixelForTier("medio"),
      forte: raysPerPixelForTier("forte"),
    },
  };
}
