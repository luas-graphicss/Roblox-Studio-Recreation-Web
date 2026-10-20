import { installCinematicCapture } from "./installCinematicCapture.js";

export { createCaptureJob } from "./captureJob.js";
export { createCaptureEndpoint } from "./captureEndpoint.js";
export { createCaptureWorkerEncoder } from "./captureWorkerEncoder.js";
export { createPipelineCaptureHost } from "./createPipelineCaptureHost.js";
export { createDirectoryCaptureSink } from "./directoryCaptureSink.js";
export { captureProjectionElements, applyCaptureProjection } from "./captureProjection.js";
export { resolveCaptureOptions } from "./captureOptions.js";
export { resolveCaptureSupport, createCaptureTilePlan } from "./captureTilePlan.js";
export { captureSample, captureTileTimeline, captureShutter } from "./captureTimeline.js";
export * from "./captureContract.js";

export default Object.freeze({ id: "CP-F29", contractVersion: "1.0.0", status: "implemented", install: installCinematicCapture });
