import { requirePreExposure } from "./preExposure.js";

function mailboxKey(viewId) {
  if (typeof viewId !== "string" || !viewId) throw new TypeError("Pre-exposure requires a viewId");
  return `CP-F04.preExposure.${encodeURIComponent(viewId)}`;
}

export function queueNextPreExposure(settings, frame, value) {
  if (!settings?.set || !Number.isSafeInteger(frame?.frameId) || frame.frameId < 0 || !Number.isSafeInteger(frame.generation) || frame.generation < 0) throw new TypeError("A stamped frame and settings writer are required");
  const request = Object.freeze({ viewId: frame.viewId, generation: frame.generation, applyFromFrameId: frame.frameId + 1, preExposure: requirePreExposure(value) });
  settings.set(mailboxKey(frame.viewId), request);
  return request;
}

export function applyQueuedPreExposure(settings, frame, previousState) {
  const request = settings.get(mailboxKey(frame.viewId));
  if (!request || request.viewId !== frame.viewId || request.generation !== frame.generation || request.applyFromFrameId > frame.frameId) return false;
  if (!Number.isSafeInteger(request.applyFromFrameId) || request.applyFromFrameId < 1) throw new TypeError("Invalid pre-exposure mailbox stamp");
  frame.preExposure = requirePreExposure(request.preExposure);
  frame.previousPreExposure = previousState?.currentPreExposure ?? frame.preExposure;
  return true;
}
