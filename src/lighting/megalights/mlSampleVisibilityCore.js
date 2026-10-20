import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import { bufferLayout } from "./mlBufferLayouts.js";
import { MGL_TRACE_KIND } from "./mlTraceCascadeCore.js";

export const SAMPLE_VISIBILITY_BUFFER_NAME = "sampleVisibility";
export const SAMPLE_VISIBILITY_SAMPLER_UNIFORM = "uMglSampleVisibility";
export const ENCODED_BYTE_CEILING = 255;


export const SAMPLE_VISIBILITY_CHANNEL_ORDER = Object.freeze([
  "traceResultIndex",
  "traceKindIndex",
  "normalizedHitDistance",
  "raysSpent",
]);


const RGBA_CHANNEL_KEYS = Object.freeze(["r", "g", "b", "a"]);

export const TRACE_RESULT_INDEX = Object.freeze({
  visible: 0,
  occluded: 1,
  unknown: 2,
});

export const TRACE_KIND_INDEX = Object.freeze({
  none: 0,
  screenTrace: 1,
  virtualShadowMapTrace: 2,
  rayTrace: 3,
  policyFallback: 4,
});

function nameByIndex(indexTable, rawIndex) {
  const wantedIndex = Math.round(Number(rawIndex));
  const names = Object.keys(indexTable);
  for (let position = 0; position !== names.length; position += 1) {
    if (indexTable[names[position]] === wantedIndex) return names[position];
  }
  return null;
}

function clampToUnitRange(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}


export function encodedChannelsMatchFrozenLayout() {
  const layout = bufferLayout(SAMPLE_VISIBILITY_BUFFER_NAME);
  if (!layout || !layout.texels || layout.texels.length !== 1) return false;
  const frozenTexel = layout.texels[0];
  if (Object.keys(frozenTexel).length !== SAMPLE_VISIBILITY_CHANNEL_ORDER.length) return false;
  return SAMPLE_VISIBILITY_CHANNEL_ORDER.every(
    (channelName, position) => frozenTexel[RGBA_CHANNEL_KEYS[position]] === channelName
  );
}


export function resultIndexTableMatchesContract() {
  const contractResults = Object.keys(MGL_TRACE_RESULT).map((key) => MGL_TRACE_RESULT[key]);
  const encodedResults = Object.keys(TRACE_RESULT_INDEX);
  if (contractResults.length !== encodedResults.length) return false;
  return contractResults.every((resultName) => TRACE_RESULT_INDEX[resultName] !== undefined);
}

export function isResolvedVisibility(record) {
  return Boolean(record) && record.traceResult !== MGL_TRACE_RESULT.unknown;
}


export function encodeSampleVisibility(record) {
  const source = record || {};
  const problems = [];

  let resultIndex = TRACE_RESULT_INDEX[source.traceResult];
  if (resultIndex === undefined) {
    problems.push(
      "traceResult \"" + String(source.traceResult) + "\" is not a contract result: encoded as unknown, never as visible"
    );
    resultIndex = TRACE_RESULT_INDEX.unknown;
  }

  let kindIndex = TRACE_KIND_INDEX[source.traceKind];
  if (kindIndex === undefined) {
    problems.push(
      "traceKind \"" + String(source.traceKind) + "\" is not a contract kind: encoded as none"
    );
    kindIndex = TRACE_KIND_INDEX.none;
  }

  const hitDistance = Number(source.normalizedHitDistance);
  let hitDistanceByte = ENCODED_BYTE_CEILING;
  if (Number.isFinite(hitDistance)) {
    hitDistanceByte = Math.round(clampToUnitRange(hitDistance) * ENCODED_BYTE_CEILING);
  } else {
    problems.push("normalizedHitDistance is not a number: encoded as 1 (no hit)");
  }

  const raysSpent = Math.floor(Number(source.raysSpent));
  let raysSpentByte = 0;
  if (!Number.isFinite(raysSpent) || raysSpent < 0) {
    problems.push("raysSpent is not a ray count: encoded as 0");
  } else if (raysSpent > ENCODED_BYTE_CEILING) {
    problems.push(
      "raysSpent " + raysSpent + " is above the byte ceiling: clamped to 255 instead of wrapping"
    );
    raysSpentByte = ENCODED_BYTE_CEILING;
  } else {
    raysSpentByte = raysSpent;
  }

  return Object.freeze({
    texel: Object.freeze([resultIndex, kindIndex, hitDistanceByte, raysSpentByte]),
    problems: Object.freeze(problems),
  });
}


export function decodeSampleVisibility(texel) {
  const bytes = Array.isArray(texel) ? texel : [];
  const problems = [];

  const traceResult = nameByIndex(TRACE_RESULT_INDEX, bytes[0]);
  if (traceResult === null) {
    problems.push("traceResultIndex " + String(bytes[0]) + " is not a known result: read as unknown");
  }

  const traceKind = nameByIndex(TRACE_KIND_INDEX, bytes[1]);
  if (traceKind === null) {
    problems.push("traceKindIndex " + String(bytes[1]) + " is not a known kind: read as none");
  }

  const hitDistanceByte = Number(bytes[2]);
  const raysSpent = Math.floor(Number(bytes[3]));

  return Object.freeze({
    traceResult: traceResult === null ? MGL_TRACE_RESULT.unknown : traceResult,
    traceKind: traceKind === null ? MGL_TRACE_KIND.none : traceKind,
    normalizedHitDistance: Number.isFinite(hitDistanceByte)
      ? clampToUnitRange(hitDistanceByte / ENCODED_BYTE_CEILING)
      : 1,
    raysSpent: Number.isFinite(raysSpent) && raysSpent > 0 ? raysSpent : 0,
    problems: Object.freeze(problems),
  });
}
