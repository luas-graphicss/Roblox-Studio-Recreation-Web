import { isText, sameIdentifierSet } from "./certificationData.js";
import { compareExactCaptures } from "./compareExactCaptures.js";

function requireIdentifiers(values, label) {
  if (!Array.isArray(values) || values.length === 0 || new Set(values).size !== values.length) throw new Error(`${label} must contain distinct identifiers`);
  for (const value of values) if (!isText(value)) throw new Error(`${label} contains an empty identifier`);
}

function inspectCapture(id, artifacts) {
  const asset = artifacts.assetsById.get(id);
  const bytes = artifacts.bytesById.get(id);
  const capture = asset?.capture;
  if (asset?.role !== "candidate-capture" || asset.provenance !== "measured" || !capture) throw new Error("Measured candidate buffers with explicit representations are required");
  if (!["encoding", "runId", "profileId", "sceneId", "slot"].every((field) => isText(capture[field]))) throw new Error("Capture encoding and run/profile/scene/slot stamps are required");
  if (!["bottom-left", "top-left"].includes(capture.origin) || !["render", "output"].includes(capture.sizeDomain) || !Number.isSafeInteger(capture.frameIndex) || capture.frameIndex < 0) throw new Error("Invalid capture origin, size domain or frame stamp");
  if (!compareExactCaptures(bytes, bytes, capture).passed) throw new Error("Nonfinite buffer samples are not valid measurements");
  return capture;
}

export function validateCertificationConsumer(evidence, requirement, artifacts) {
  const consumer = evidence.consumer;
  if (consumer?.backend !== "gpu" || !Number.isSafeInteger(consumer.executionCount) || consumer.executionCount < 1 || consumer.mocked !== false) throw new Error("A real executed GPU producer/consumer chain is required");
  requireIdentifiers(consumer.passIds, "Executed pass ids");
  requireIdentifiers(consumer.captureIds, "Linked capture ids");
  const captures = consumer.captureIds.map((id) => inspectCapture(id, artifacts));
  const stamps = new Set();
  for (const capture of captures) {
    const stamp = JSON.stringify([capture.runId, capture.frameIndex, capture.slot]);
    if (stamps.has(stamp)) throw new Error("Duplicate capture stamps cannot establish independent frames");
    stamps.add(stamp);
  }
  if (!["temporal", "sequence"].includes(requirement.kind)) return;
  const frames = consumer.frameIndices;
  if (!Array.isArray(frames) || frames.length < 2) throw new Error("A contiguous sequence, not a screenshot, is required");
  for (const [index, frame] of frames.entries()) {
    if (!Number.isSafeInteger(frame) || frame < 0 || (index > 0 && frame !== frames[index - 1] + 1)) throw new Error("Temporal frame indices must be contiguous");
  }
  if (consumer.executionCount < frames.length) throw new Error("Temporal execution count does not cover the claimed frames");
  const sequences = new Map();
  for (const capture of captures) {
    const key = JSON.stringify([capture.runId, capture.profileId, capture.sceneId, capture.slot]);
    if (!sequences.has(key)) sequences.set(key, []);
    sequences.get(key).push(capture.frameIndex);
  }
  for (const capturedFrames of sequences.values()) {
    if (!sameIdentifierSet(capturedFrames, frames)) throw new Error("Every temporal run and slot needs real buffers for every declared frame");
  }
}
