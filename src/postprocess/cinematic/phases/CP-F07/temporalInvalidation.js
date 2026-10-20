import { validateFrame } from "../../contracts/frameContract.js";
import { resolveTemporalControls } from "./temporalControls.js";

export function snapshotTemporalFrame(frame, options) {
  validateFrame(frame);
  if (!Number.isSafeInteger(frame.frameId) || frame.frameId >= Number.MAX_SAFE_INTEGER) throw new TypeError("frameId must leave room for a history checkpoint");
  if (typeof frame.qualityTier !== "string" || !frame.qualityTier) throw new TypeError("qualityTier must be explicit");
  if (typeof frame.cameraCut !== "boolean") throw new TypeError("cameraCut must be boolean");
  return Object.freeze({
    ...frame,
    renderSize: Object.freeze({ ...frame.renderSize }),
    outputSize: Object.freeze({ ...frame.outputSize }),
    controls: resolveTemporalControls(options)
  });
}

export function findTemporalInvalidators(previous, current, checkpointPresent = true) {
  const reasons = [];
  if (!previous) reasons.push("first-frame");
  if (current.cameraCut) reasons.push("camera-cut");
  if (current.controls.paused) reasons.push("pause");
  if (previous) {
    if (!checkpointPresent) reasons.push("history-reset");
    if (current.generation !== previous.generation) reasons.push("generation-change");
    if (current.frameId !== previous.frameId + 1) reasons.push("frame-discontinuity");
    if (current.timeSeconds < previous.timeSeconds) reasons.push("time-rewind");
    if (current.renderSize.width !== previous.renderSize.width || current.renderSize.height !== previous.renderSize.height || current.outputSize.width !== previous.outputSize.width || current.outputSize.height !== previous.outputSize.height) reasons.push("resize");
    if (current.qualityTier !== previous.qualityTier) reasons.push("quality-change");
    if (previous.controls.paused && !current.controls.paused) reasons.push("resume");
    for (const [key, reason] of [["sceneRevision", "scene-change"], ["teleportRevision", "teleport"], ["deviceRevision", "device-restore"], ["resetRevision", "manual-reset"]]) {
      if (current.controls[key] !== previous.controls[key]) reasons.push(reason);
    }
    if (["jitterEnabled", "seed", "sequenceLength"].some((key) => current.controls[key] !== previous.controls[key])) reasons.push("sequence-change");
  }
  return Object.freeze(reasons);
}
