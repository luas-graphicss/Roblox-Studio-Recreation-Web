import { hierarchicalDepthLevelCount } from "./mlHzbCore.js";

export const SCENE_INPUT_ATTACHMENTS = Object.freeze([
  Object.freeze({
    name: "sceneDepth",
    index: 0,
    contractBufferName: "sceneDepth",
    carries: "linear view depth in R, normalized view depth in G, coverage in A",
    consumers: ["ML-F5", "ML-F13", "ML-F14", "ML-F19", "ML-F20", "ML-F21"],
  }),
  Object.freeze({
    name: "sceneNormal",
    index: 1,
    contractBufferName: "sceneNormal",
    carries: "world normal encoded in RGB, roughness in A",
    consumers: ["ML-F11", "ML-F18", "ML-F19", "ML-F21"],
  }),
  Object.freeze({
    name: "sceneAlbedo",
    index: 2,


    contractBufferName: "sceneAlbedoRoughness",
    carries: "linear albedo in RGB, metalness in A",
    consumers: ["ML-F18"],
  }),
  Object.freeze({
    name: "sceneVelocity",
    index: 3,
    contractBufferName: "sceneVelocity",
    carries: "encoded screen velocity in RG, validity in A",
    consumers: ["ML-F20", "ML-F22"],
  }),
]);

export const HIERARCHICAL_DEPTH_BUFFER_NAME = "hierarchicalDepth";

export const SCENE_INPUT_TOLERANCES = Object.freeze({
  minimumProbeCount: 8,
  maximumNormalAngleErrorInDegrees: 2,
  maximumRoughnessError: 0.02,
  maximumStaticVelocityInPixels: 0.1,
});

export function sceneInputAttachmentNames() {
  return SCENE_INPUT_ATTACHMENTS.map((attachment) => attachment.name);
}

export function sceneInputAttachment(attachmentName) {
  return SCENE_INPUT_ATTACHMENTS.find((attachment) => attachment.name === attachmentName) || null;
}







export function validateSceneInputReport(report) {
  const problems = [];
  if (!report) return { valid: false, problems: ["no scene input report was produced"] };

  if (!report.gBufferAvailable) {
    problems.push("the G-buffer is not available: " + (report.reason || "no reason reported"));
  }

  const width = Number(report.width) || 0;
  const height = Number(report.height) || 0;
  if (width <= 0 || height <= 0) problems.push("the G-buffer has no size: " + width + "x" + height);

  const attachments = report.attachments || {};
  SCENE_INPUT_ATTACHMENTS.forEach((attachment) => {
    const state = attachments[attachment.name];
    if (!state || !state.present) {
      problems.push('attachment "' + attachment.name + '" is missing');
    }
  });

  const pyramid = report.hierarchicalDepth || {};
  if (!pyramid.built) {
    problems.push("the hierarchical depth pyramid was not built");
  } else {
    const expectedLevels = hierarchicalDepthLevelCount(width, height);
    if (pyramid.levelCount !== expectedLevels) {
      problems.push(
        "the pyramid has " + pyramid.levelCount + " levels, expected " + expectedLevels + " for " + width + "x" + height,
      );
    }
    if (pyramid.width !== width || pyramid.height !== height) {
      problems.push(
        "the pyramid base is " + pyramid.width + "x" + pyramid.height + " but the G-buffer is " + width + "x" + height,
      );
    }
  }

  return { valid: problems.length === 0, problems };
}

function angleBetweenUnitVectorsInDegrees(first, second) {
  const dotProduct = Math.max(-1, Math.min(1, first[0] * second[0] + first[1] * second[1] + first[2] * second[2]));
  return (Math.acos(dotProduct) * 180) / Math.PI;
}


export function evaluateNormalAndRoughnessProbes(probes) {
  const problems = [];
  const rows = [];
  const probeList = Array.isArray(probes) ? probes : [];

  if (probeList.length < SCENE_INPUT_TOLERANCES.minimumProbeCount) {
    problems.push(
      "only " + probeList.length + " probes, the gate needs " + SCENE_INPUT_TOLERANCES.minimumProbeCount,
    );
  }

  let worstNormalAngleErrorInDegrees = 0;
  let worstRoughnessError = 0;

  probeList.forEach((probe, probeIndex) => {
    const label = probe.label || "probe " + probeIndex;
    const normalAngleErrorInDegrees = angleBetweenUnitVectorsInDegrees(
      probe.expectedWorldNormal || [0, 0, 0],
      probe.sampledWorldNormal || [0, 0, 0],
    );
    const roughnessError = Math.abs(Number(probe.expectedRoughness) - Number(probe.sampledRoughness));
    if (normalAngleErrorInDegrees > worstNormalAngleErrorInDegrees) {
      worstNormalAngleErrorInDegrees = normalAngleErrorInDegrees;
    }
    if (roughnessError > worstRoughnessError) worstRoughnessError = roughnessError;

    if (!(normalAngleErrorInDegrees <= SCENE_INPUT_TOLERANCES.maximumNormalAngleErrorInDegrees)) {
      problems.push(label + ": normal off by " + normalAngleErrorInDegrees.toFixed(3) + " degrees");
    }
    if (!(roughnessError <= SCENE_INPUT_TOLERANCES.maximumRoughnessError)) {
      problems.push(label + ": roughness off by " + roughnessError.toFixed(4));
    }
    rows.push({ label, normalAngleErrorInDegrees, roughnessError });
  });

  return {
    pass: problems.length === 0,
    probeCount: probeList.length,
    worstNormalAngleErrorInDegrees,
    worstRoughnessError,
    rows,
    problems,
  };
}


export function evaluateStaticVelocity(samples) {
  const problems = [];
  const sampleList = Array.isArray(samples) ? samples : [];
  let worstVelocityInPixels = 0;

  if (sampleList.length === 0) problems.push("no static velocity sample was taken");

  sampleList.forEach((sample, sampleIndex) => {
    const label = sample.label || "sample " + sampleIndex;
    const velocityInPixels = Number(sample.velocityInPixels) || 0;
    if (velocityInPixels > worstVelocityInPixels) worstVelocityInPixels = velocityInPixels;
    if (!(velocityInPixels <= SCENE_INPUT_TOLERANCES.maximumStaticVelocityInPixels)) {
      problems.push(label + ": static pixel drifted " + velocityInPixels.toFixed(4) + " px");
    }
  });

  return {
    pass: problems.length === 0,
    sampleCount: sampleList.length,
    worstVelocityInPixels,
    problems,
  };
}
