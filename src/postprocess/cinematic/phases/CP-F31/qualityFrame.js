import { validateFrame } from "../../contracts/frameContract.js";

export function createQualityFrame(frame, plan) {
  validateFrame(frame);
  return { ...frame, renderSize: { ...plan.renderSize }, outputSize: { ...frame.outputSize }, qualityTier: plan.profileId };
}

export function captureQualityFrameIdentity(frame) {
  return { ...frame, renderSize: { ...frame.renderSize }, outputSize: { ...frame.outputSize } };
}

export function validateQualityFrame(source, applied, plan, identity = captureQualityFrameIdentity(source)) {
  validateFrame(applied);
  if (source === applied) throw new Error("Host configureFrame must return a new frame, not mutate the input");
  for (const name of ["viewId", "frameId", "generation", "timeSeconds", "deltaSeconds", "preExposure", "previousPreExposure", "cameraCut", "referenceMode"])
    if (!Object.is(identity[name], applied[name]) || !Object.is(source[name], identity[name])) throw new Error(`Quality bridge cannot change host ${name}`);
  for (const axis of ["width", "height"]) {
    if (source.renderSize[axis] !== identity.renderSize[axis] || source.outputSize[axis] !== identity.outputSize[axis])
      throw new Error("Host mutated the source frame extent");
    if (applied.renderSize[axis] !== plan.renderSize[axis] || applied.outputSize[axis] !== plan.outputSize[axis])
      throw new Error("Host did not apply the negotiated physical extent");
  }
  if (applied.qualityTier !== plan.profileId) throw new Error("Host did not apply the negotiated quality profile");
  return applied;
}
