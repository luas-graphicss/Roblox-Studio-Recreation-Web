import { enumValue, finiteNumber, plainRecord, positiveNumber } from "./cameraValidation.js";

export function createRackFocusSequence(keyframes, interpolation = "smoothstep") {
  enumValue(interpolation, "focusInterpolation", ["linear", "smoothstep"]);
  if (!Array.isArray(keyframes) || keyframes.length < 2) throw new TypeError("Rack focus requires at least two keyframes");
  let previousTime = -1;
  const frames = keyframes.map((keyframe) => {
    plainRecord(keyframe, "focus keyframe");
    const timeSeconds = finiteNumber(keyframe.timeSeconds, "keyframe.timeSeconds", 0);
    if (timeSeconds <= previousTime) throw new TypeError("Focus keyframe times must be strictly increasing");
    previousTime = timeSeconds;
    if (keyframe.atInfinity !== undefined && typeof keyframe.atInfinity !== "boolean") throw new TypeError("atInfinity must be boolean");
    const diopters = keyframe.atInfinity === true ? 0 : finiteNumber(1 / positiveNumber(keyframe.distanceMeters, "keyframe.distanceMeters"), "keyframe.diopters", 0);
    return Object.freeze({ timeSeconds, diopters });
  });
  function sample(timeSeconds) {
    finiteNumber(timeSeconds, "focus timeSeconds", 0);
    if (timeSeconds <= frames[0].timeSeconds) return frames[0].diopters;
    if (timeSeconds >= frames.at(-1).timeSeconds) return frames.at(-1).diopters;
    let rightIndex = 1;
    while (frames[rightIndex].timeSeconds < timeSeconds) rightIndex += 1;
    const left = frames[rightIndex - 1];
    const right = frames[rightIndex];
    const fraction = (timeSeconds - left.timeSeconds) / (right.timeSeconds - left.timeSeconds);
    const weight = interpolation === "smoothstep" ? fraction * fraction * (3 - 2 * fraction) : fraction;
    return left.diopters + (right.diopters - left.diopters) * weight;
  }
  return Object.freeze({ keyframes: Object.freeze(frames), interpolation, sample });
}
