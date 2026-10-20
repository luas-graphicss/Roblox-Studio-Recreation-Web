export const BASELINE_SCENE_IDS = Object.freeze([
  "cena1",
  "cena2",
  "cena3",
  "cena4",
  "cena5",
  "cena6",
  "cena7",
  "cena8",
]);


export const BASELINE_IDENTITY_SSIM = 0.99999;

export const BASELINE_BROKEN_SSIM = 0.99;
export const BASELINE_MAX_MEAN_DELTA_E = 0.5;


export const BASELINE_MAX_LUMINANCE_NOISE = 0.001;

export const BASELINE_VERDICT = Object.freeze({
  IDENTICAL: "identical",
  DRIFTED: "drifted",
  BROKEN: "broken",
  MISSING: "missing",
});

function finiteNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function createBaselineRecord(input) {
  const source = input || {};
  return Object.freeze({
    sceneId: source.sceneId || "",
    tier: source.tier || "",
    width: finiteNumberOrNull(source.width),
    height: finiteNumberOrNull(source.height),
    meanLuminance: finiteNumberOrNull(source.meanLuminance),
    lightCount: finiteNumberOrNull(source.lightCount),
    shadowCount: finiteNumberOrNull(source.shadowCount),
    drawCalls: finiteNumberOrNull(source.drawCalls),
    fps: finiteNumberOrNull(source.fps),
    activePatchCount: finiteNumberOrNull(source.activePatchCount),
    imageHash: source.imageHash || "",
    imageLength: finiteNumberOrNull(source.imageLength),

    deterministic: source.deterministic === true,


    luminanceNoise: finiteNumberOrNull(source.luminanceNoise),
    fingerprintStored: source.fingerprintStored === true,
    pixelBaselineStored: source.pixelBaselineStored === true,
    capturedAt: source.capturedAt || null,
  });
}

export function validateBaselineRecord(record) {
  const problems = [];
  if (!record) {
    return { valid: false, problems: ["record is missing"] };
  }
  if (BASELINE_SCENE_IDS.indexOf(record.sceneId) < 0) {
    problems.push("unknown scene id: " + String(record.sceneId));
  }
  if (!record.tier) problems.push("tier is missing");
  if (!(record.width > 0) || !(record.height > 0)) problems.push("capture size is missing");
  if (record.meanLuminance === null) problems.push("mean luminance is missing");
  if (!record.imageHash) problems.push("image fingerprint is missing");
  if (!record.fingerprintStored) problems.push("fingerprint was not persisted");
  return { valid: problems.length === 0, problems };
}

export function summarizeBaselineCoverage(records) {
  const list = Array.isArray(records) ? records : [];
  const coveredSceneIds = [];
  const invalidRecords = [];
  list.forEach((record) => {
    const check = validateBaselineRecord(record);
    if (check.valid) {
      if (coveredSceneIds.indexOf(record.sceneId) < 0) coveredSceneIds.push(record.sceneId);
    } else {
      invalidRecords.push({ sceneId: record ? record.sceneId : "", problems: check.problems });
    }
  });
  const missingSceneIds = BASELINE_SCENE_IDS.filter((sceneId) => coveredSceneIds.indexOf(sceneId) < 0);
  return {
    expected: BASELINE_SCENE_IDS.length,
    total: list.length,
    coveredSceneIds,
    missingSceneIds,
    invalidRecords,
    byteExactCapableSceneIds: byteExactCapableSceneIds(list),
    animatedSceneIds: animatedSceneIds(list),
    complete: missingSceneIds.length === 0 && invalidRecords.length === 0,
  };
}





export function byteExactCapableSceneIds(records) {
  const list = Array.isArray(records) ? records : [];
  return list.filter((record) => record && record.deterministic).map((record) => record.sceneId);
}

export function animatedSceneIds(records) {
  const list = Array.isArray(records) ? records : [];
  return list.filter((record) => record && !record.deterministic).map((record) => record.sceneId);
}


export function evaluateBaselineComparison(measurement, thresholds) {
  const limits = Object.assign(
    {
      identitySsim: BASELINE_IDENTITY_SSIM,
      brokenSsim: BASELINE_BROKEN_SSIM,
      maxMeanDeltaE: BASELINE_MAX_MEAN_DELTA_E,
    },
    thresholds || {},
  );
  if (!measurement || !Number.isFinite(measurement.ssim)) {
    return {
      verdict: BASELINE_VERDICT.MISSING,
      identical: false,
      ssim: null,
      meanDeltaE: null,
      reasons: ["no comparison available (baseline not registered)"],
    };
  }
  const ssim = measurement.ssim;
  const meanDeltaE = finiteNumberOrNull(measurement.meanDeltaE);
  const reasons = [];
  let verdict = BASELINE_VERDICT.IDENTICAL;
  if (ssim < limits.brokenSsim) {
    verdict = BASELINE_VERDICT.BROKEN;
    reasons.push("ssim " + ssim + " below broken gate " + limits.brokenSsim);
  } else if (ssim < limits.identitySsim) {
    verdict = BASELINE_VERDICT.DRIFTED;
    reasons.push("ssim " + ssim + " below identity gate " + limits.identitySsim);
  }
  if (meanDeltaE !== null && meanDeltaE > limits.maxMeanDeltaE && verdict === BASELINE_VERDICT.IDENTICAL) {
    verdict = BASELINE_VERDICT.DRIFTED;
    reasons.push("mean deltaE " + meanDeltaE + " above " + limits.maxMeanDeltaE);
  }
  return { verdict, identical: verdict === BASELINE_VERDICT.IDENTICAL, ssim, meanDeltaE, reasons };
}


export function evaluateFingerprintComparison(comparison) {
  const source = comparison || {};
  if (!source.baselineHash) {
    return {
      verdict: BASELINE_VERDICT.MISSING,
      identical: false,
      luminanceDelta: null,
      reasons: ["no baseline fingerprint registered for this scene"],
    };
  }
  if (!source.currentHash) {
    return {
      verdict: BASELINE_VERDICT.MISSING,
      identical: false,
      luminanceDelta: null,
      reasons: ["capture failed, nothing to compare"],
    };
  }
  const luminanceDelta = finiteNumberOrNull(source.luminanceDelta);
  if (source.baselineHash === source.currentHash) {
    return { verdict: BASELINE_VERDICT.IDENTICAL, identical: true, luminanceDelta, reasons: [] };
  }
  const noiseFloor = Number.isFinite(source.luminanceNoise) ? source.luminanceNoise : 0;
  const tolerance = Math.max(noiseFloor, BASELINE_MAX_LUMINANCE_NOISE);
  if (luminanceDelta !== null && luminanceDelta <= tolerance) {
    return {
      verdict: BASELINE_VERDICT.DRIFTED,
      identical: false,
      luminanceDelta,
      reasons: ["image bytes changed but mean luminance stayed inside the scene noise floor " + tolerance],
    };
  }
  return {
    verdict: BASELINE_VERDICT.BROKEN,
    identical: false,
    luminanceDelta,
    reasons: [
      luminanceDelta === null
        ? "image bytes changed and there is no luminance to compare"
        : "image bytes changed and mean luminance moved " + luminanceDelta,
    ],
  };
}

export function summarizeBaselineVerification(results) {
  const list = Array.isArray(results) ? results : [];
  const identical = list.filter((item) => item && item.identical).length;
  const withinNoise = list.filter(
    (item) => item && !item.identical && item.verdict === BASELINE_VERDICT.DRIFTED,
  ).length;
  const brokenSceneIds = list
    .filter((item) => item && item.verdict === BASELINE_VERDICT.BROKEN)
    .map((item) => item.sceneId);
  const notIdentical = list
    .filter((item) => item && !item.identical)
    .map((item) => ({ sceneId: item.sceneId, verdict: item.verdict, reasons: item.reasons || [] }));
  const deterministic = list.filter((item) => item && item.deterministic);
  return {
    total: list.length,
    identical,
    withinNoise,
    brokenSceneIds,
    notIdentical,
    deterministicTotal: deterministic.length,
    allDeterministicIdentical:
      deterministic.length > 0 && deterministic.every((item) => item.identical),
    allIdentical: list.length === BASELINE_SCENE_IDS.length && notIdentical.length === 0,
  };
}
