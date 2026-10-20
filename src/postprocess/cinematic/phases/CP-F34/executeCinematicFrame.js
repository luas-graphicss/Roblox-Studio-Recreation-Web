import { captureFrameIdentity, validateCapturedInputs, validateHostFrame, validateOutputColor } from "./frameDelivery.js";
import { assertOwnershipAcknowledgement } from "./promotionPolicy.js";
import { callSynchronousMethod } from "./synchronousCallbacks.js";
import { runSynchronousFrameGuard } from "./runSynchronousFrameGuard.js";

function summarizeExecution(execution) {
  if (!Array.isArray(execution)) return [];
  return execution.map((entry) => Object.freeze({
    id: entry.id,
    stage: entry.stage,
    status: entry.status,
    transformsColor: entry.transformsColor === true,
    cpuSubmissionMs: entry.cpuSubmissionMs,
  }));
}

export function executeCinematicFrame({ host, runtime, request, configuration, route, assertActive = () => {} }) {
  let presentationAttempted = false;
  let presentationDeclined = false;
  let passes = [];
  try {
    const getters = callSynchronousMethod(host, "readGetters");
    const frame = validateHostFrame(callSynchronousMethod(host, "getFrame", { ...request, getters }), request.dimensions);
    const identity = captureFrameIdentity(frame);
    const execution = Object.freeze({ route, ownership: configuration.ownership, packageRevision: configuration.packageRevision, getters });
    const presented = runSynchronousFrameGuard((operation) => callSynchronousMethod(host, "withFrameState", operation), () => {
      assertActive();
      const acknowledged = callSynchronousMethod(host, "acknowledgeOwnership", configuration.ownership, frame);
      assertOwnershipAcknowledgement(configuration.ownership, acknowledged);
      const prepared = callSynchronousMethod(runtime, "prepare", frame, execution);
      assertActive();
      callSynchronousMethod(host, "finalizeFrame", frame, prepared);
      assertActive();
      const inputs = validateCapturedInputs(callSynchronousMethod(host, "captureInputs", frame, getters, execution, prepared), frame);
      assertActive();
      const result = callSynchronousMethod(runtime, "render", frame, inputs);
      assertActive();
      if (captureFrameIdentity(frame) !== identity) throw new Error("Pipeline mutated host frame identity");
      const color = validateOutputColor(result?.color, frame, configuration.output);
      passes = summarizeExecution(result?.execution);
      presentationAttempted = true;
      const committed = callSynchronousMethod(host, "present", color, frame);
      if (typeof committed !== "boolean") throw new TypeError("Presentation must return a boolean");
      presentationDeclined = committed === false;
      return committed;
    });
    if (typeof presented !== "boolean") throw new TypeError("Host state guard must return the operation result");
    return { presented, route, frameId: frame.frameId, viewId: frame.viewId, passes };
  } catch (error) {
    return { presented: presentationAttempted && !presentationDeclined, uncertainPresentation: presentationAttempted && !presentationDeclined, error, route: { active: false, reason: presentationAttempted && !presentationDeclined ? "presentation-uncertain" : "pipeline-failed" } };
  }
}
