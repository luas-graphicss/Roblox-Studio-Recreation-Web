import { BASELINE_SCENE_IDS } from "./llBaselineCore.js";
import {
  BLIND_BUILD_BENCH,
  BLIND_BUILD_ENGINE,
  BLIND_TRUTH_ENGINE,
  BLIND_TRUTH_UNREAL,
} from "./llBlindRoundContract.js";

export const REQUIRED_STILL_SOURCES = Object.freeze([BLIND_TRUTH_ENGINE, BLIND_TRUTH_UNREAL]);
export const KNOWN_STILL_BUILDS = Object.freeze([BLIND_BUILD_BENCH, BLIND_BUILD_ENGINE]);


export function cameraPoseKey(pose) {
  const source = pose && typeof pose === "object" ? pose : {};
  const target = Array.isArray(source.alvo) ? source.alvo : [];
  const round = (value) => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0);
  return (
    "alvo=" +
    round(target[0]) +
    "," +
    round(target[1]) +
    "," +
    round(target[2]) +
    "|raio=" +
    round(source.raio) +
    "|phi=" +
    round(source.phi) +
    "|theta=" +
    round(source.theta)
  );
}

export function createStillRecord(input) {
  const source = input && typeof input === "object" ? input : {};
  const finite = (value) => (Number.isFinite(value) ? value : null);
  return Object.freeze({
    sceneId: source.sceneId || "",
    source: source.source || "",
    build: source.build || "",
    imageHash: source.imageHash || "",
    imageLength: finite(source.imageLength),
    width: finite(source.width),
    height: finite(source.height),
    meanLuminance: finite(source.meanLuminance),
    cameraPoseKey: source.cameraPoseKey || "",
    origin: source.origin || "",
    capturedAt: finite(source.capturedAt),
  });
}

export function validateStillRecord(record) {
  const problems = [];
  if (!record) return { valid: false, problems: ["record is missing"] };
  if (BASELINE_SCENE_IDS.indexOf(record.sceneId) < 0) {
    problems.push("unknown scene id: " + String(record.sceneId));
  }
  if (REQUIRED_STILL_SOURCES.indexOf(record.source) < 0) {
    problems.push("source has to be one of " + REQUIRED_STILL_SOURCES.join(" or "));
  }


  if (record.source === BLIND_TRUTH_ENGINE && KNOWN_STILL_BUILDS.indexOf(record.build) < 0) {
    problems.push("build has to say where the image came from: " + KNOWN_STILL_BUILDS.join(" or "));
  }
  if (record.source === BLIND_TRUTH_UNREAL && !record.origin) {
    problems.push("an unreal still needs an origin (file and who exported it)");
  }
  if (!record.imageHash) problems.push("image fingerprint is missing");
  if (!(record.width > 0) || !(record.height > 0)) problems.push("image size is missing");
  if (!record.cameraPoseKey) problems.push("camera pose key is missing");
  return { valid: problems.length === 0, problems };
}


export function pairProblems(engineStill, unrealStill) {
  const problems = [];
  if (!engineStill) problems.push("engine still is missing");
  if (!unrealStill) problems.push("unreal still is missing");
  if (!engineStill || !unrealStill) return problems;
  if (engineStill.cameraPoseKey !== unrealStill.cameraPoseKey) {
    problems.push(
      "camera pose differs: engine " + engineStill.cameraPoseKey + " vs unreal " + unrealStill.cameraPoseKey,
    );
  }
  if (engineStill.width !== unrealStill.width || engineStill.height !== unrealStill.height) {
    problems.push(
      "image size differs: engine " +
        engineStill.width +
        "x" +
        engineStill.height +
        " vs unreal " +
        unrealStill.width +
        "x" +
        unrealStill.height,
    );
  }
  if (engineStill.imageHash && engineStill.imageHash === unrealStill.imageHash) {
    problems.push("engine and unreal stills are the SAME image (fingerprint " + engineStill.imageHash + ")");
  }
  return problems;
}

function stillOf(records, sceneId, source) {
  return records.find((record) => record && record.sceneId === sceneId && record.source === source) || null;
}

export function summarizeStillManifest(records) {
  const list = Array.isArray(records) ? records.filter((record) => validateStillRecord(record).valid) : [];
  const invalid = (Array.isArray(records) ? records : [])
    .map((record) => ({ record, check: validateStillRecord(record) }))
    .filter((item) => !item.check.valid)
    .map((item) => ({ sceneId: item.record ? item.record.sceneId : "", problems: item.check.problems }));
  const readySceneIds = [];
  const missing = [];
  const mismatched = [];
  const builds = [];
  BASELINE_SCENE_IDS.forEach((sceneId) => {
    const engineStill = stillOf(list, sceneId, BLIND_TRUTH_ENGINE);
    const unrealStill = stillOf(list, sceneId, BLIND_TRUTH_UNREAL);
    if (engineStill && builds.indexOf(engineStill.build) < 0) builds.push(engineStill.build);
    const problems = pairProblems(engineStill, unrealStill);
    if (!engineStill || !unrealStill) {
      const missingSources = [];
      if (!engineStill) missingSources.push(BLIND_TRUTH_ENGINE);
      if (!unrealStill) missingSources.push(BLIND_TRUTH_UNREAL);
      missing.push({ sceneId, missingSources });
      return;
    }
    if (problems.length > 0) {
      mismatched.push({ sceneId, problems });
      return;
    }
    readySceneIds.push(sceneId);
  });
  const engineStills = list.filter((record) => record.source === BLIND_TRUTH_ENGINE);
  return {
    expected: BASELINE_SCENE_IDS.length,
    registered: list.length,
    invalid,
    readySceneIds,
    missing,
    mismatched,
    buildsUsed: builds,


    everyEngineStillFromEngineBuild:
      engineStills.length > 0 && engineStills.every((record) => record.build === BLIND_BUILD_ENGINE),
    ready: readySceneIds.length === BASELINE_SCENE_IDS.length,
  };
}
