import { validateDepthCamera } from "./depthMath.js";

function validateMatrix(actual, expected, label) {
  if (!expected || expected.length !== 16 || !Array.from(expected).every(Number.isFinite)) throw new Error(`CP-F05 frame requires a finite ${label} matrix`);
  if (!actual || actual.length !== 16 || actual.some((value, index) => !Number.isFinite(value) || Math.abs(value - expected[index]) > 1e-8)) throw new Error(`CP-F05 ${label} changed after scene color capture`);
}

export function validateCaptureAlignment(frame, sceneColor, camera) {
  validateDepthCamera(frame.camera);
  if (!frame.jitterPixels || frame.jitterPixels.length !== 2 || !frame.jitterPixels.every(Number.isFinite)) throw new TypeError("CP-F05 requires finite current jitter in physical pixels");
  if (!sceneColor?.texture || sceneColor.frameId !== frame.frameId || sceneColor.viewId !== frame.viewId || sceneColor.generation !== frame.generation) throw new Error("CP-F05 scene color must belong to the same frame and view");
  if (sceneColor.width !== frame.renderSize.width || sceneColor.height !== frame.renderSize.height || sceneColor.origin !== "bottom-left") throw new Error("CP-F05 color must use the same physical extent and bottom-left origin");
  if (camera.near !== frame.camera.nearMeters || camera.far !== frame.camera.farMeters) throw new Error("CP-F05 host camera planes disagree with the finalized frame");
  if (!camera.isPerspectiveCamera && !camera.isOrthographicCamera) throw new Error("CP-F05 requires a perspective or orthographic host camera");
  validateMatrix(camera.projectionMatrix.elements, frame.matrices?.projection, "projection");
  validateMatrix(camera.matrixWorldInverse.elements, frame.matrices?.view, "view");
  if (sceneColor.jitterPixels && sceneColor.jitterPixels.some((value, index) => value !== frame.jitterPixels[index])) throw new Error("CP-F05 color jitter disagrees with the frame");
  if ((sceneColor.target?.samples ?? sceneColor.samples ?? 1) > 1) throw new Error("CP-F05 multisampled color requires an explicit correlated geometry sample resolve, not averaged IDs");
}
