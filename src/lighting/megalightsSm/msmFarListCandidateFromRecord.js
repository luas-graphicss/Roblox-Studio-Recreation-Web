import { MSM_GRID_MAX_LIGHT_COUNT } from "./msmWorldGridLayout.js";


export const MSM_FAR_LIST_CANDIDATE_PHASE_ID = "MSM-F10";
export const MSM_FAR_LIST_CANDIDATE_SOURCE_MODULE = "msmLightRecordCore.js";


export const MSM_FAR_LIST_CANDIDATE_REJECTION = Object.freeze({
  MISSING_RECORD: "missingRecord",
  MISSING_LIGHT_INDEX: "missingLightIndex",
  INCOMPLETE_RECORD: "incompleteRecord",
});

function acceptedCandidate(candidate) {
  return Object.freeze({ ok: true, candidate, rejection: null, reason: "" });
}

function rejectedCandidate(rejection, reason) {
  return Object.freeze({ ok: false, candidate: null, rejection, reason });
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}


function unwrapLightRecord(source) {
  if (source === null || source === undefined || typeof source !== "object") return null;
  if (source.ok === true && source.record !== null && source.record !== undefined) return source.record;
  if (source.ok === false) return null;
  return source;
}


export function farListCandidateFromLightRecord(lightRecordOrResult, lightIndex) {
  const record = unwrapLightRecord(lightRecordOrResult);
  if (record === null) {
    return rejectedCandidate(
      MSM_FAR_LIST_CANDIDATE_REJECTION.MISSING_RECORD,
      "registro ausente ou recusado pela MSM-F6: a far list nao normaliza luz",
    );
  }
  if (!isFiniteNumber(lightIndex) || !(lightIndex >= 1) || lightIndex > MSM_GRID_MAX_LIGHT_COUNT) {
    return rejectedCandidate(
      MSM_FAR_LIST_CANDIDATE_REJECTION.MISSING_LIGHT_INDEX,
      `indice estavel precisa estar em 1..${MSM_GRID_MAX_LIGHT_COUNT} (0 e o slot vazio do grid): ${String(lightIndex)}`,
    );
  }
  if (
    !isFiniteNumber(record.positionX) ||
    !isFiniteNumber(record.positionY) ||
    !isFiniteNumber(record.positionZ) ||
    !isFiniteNumber(record.range) ||
    !isFiniteNumber(record.luminance)
  ) {
    return rejectedCandidate(
      MSM_FAR_LIST_CANDIDATE_REJECTION.INCOMPLETE_RECORD,
      "registro sem positionX/Y/Z, range ou luminance finitos: formato fora do contrato da MSM-F6",
    );
  }
  return acceptedCandidate(
    Object.freeze({
      lightIndex: Math.trunc(lightIndex),
      lightKey: record.lightKey,
      position: Object.freeze({ x: record.positionX, y: record.positionY, z: record.positionZ }),
      range: record.range,


      color: Object.freeze({
        r: isFiniteNumber(record.chromaticityRed) ? record.chromaticityRed : 1,
        g: isFiniteNumber(record.chromaticityGreen) ? record.chromaticityGreen : 1,
        b: isFiniteNumber(record.chromaticityBlue) ? record.chromaticityBlue : 1,
      }),
      intensity: record.luminance,
      enabled: true,
    }),
  );
}


export function farListCandidatesFromLightRecords(lightRecords, resolveLightIndex) {
  const list = Array.isArray(lightRecords) ? lightRecords : [];
  const candidates = [];
  const rejections = [];
  const hasResolver = typeof resolveLightIndex === "function";
  for (let inputIndex = 0; inputIndex < list.length; inputIndex += 1) {
    const lightIndex = hasResolver ? resolveLightIndex(list[inputIndex], inputIndex) : Number.NaN;
    const result = farListCandidateFromLightRecord(list[inputIndex], lightIndex);
    if (result.ok) candidates.push(result.candidate);
    else rejections.push(Object.freeze({ inputIndex, rejection: result.rejection, reason: result.reason }));
  }
  return Object.freeze({ candidates: Object.freeze(candidates), rejections: Object.freeze(rejections) });
}
