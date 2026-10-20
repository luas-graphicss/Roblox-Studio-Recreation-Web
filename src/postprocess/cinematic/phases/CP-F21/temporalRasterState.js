import { multiplyTemporalMatrices, invertTemporalMatrix } from "./temporalMatrix.js";
import { validateFrame, validateResource } from "../../contracts/frameContract.js";
import { createJitteredProjection } from "../CP-F07/deterministicJitter.js";

export function requireTemporalVector(value, length, label) {
  if (!value || value.length !== length || !Array.from(value).every((component) => Number.isFinite(component) && Number.isFinite(Math.fround(component)))) throw new TypeError(`CP-F21 ${label} requires ${length} finite components`);
  return Array.from(value);
}

export function createTemporalRasterState(frame, temporalResource) {
  validateFrame(frame);
  validateResource(temporalResource, frame, "CP-F07.temporalFrame");
  const temporal = temporalResource.value;
  if (temporal?.apiVersion !== "1.0.0" || temporal.projectionApplication !== "host-owned") throw new Error("CP-F21 requires the CP-F07 host-owned projection contract");
  if (frame.matrices?.projectionNoJitter) throw new Error("CP-F21 raster state was already prepared");
  const projectionNoJitter = requireTemporalVector(frame.matrices?.projection, 16, "projection");
  const view = requireTemporalVector(frame.matrices?.view, 16, "view");
  const jitterPixels = requireTemporalVector(temporal.jitterPixels, 2, "requested jitter");
  const previousJitterPixels = requireTemporalVector(temporal.previousJitterPixels, 2, "previous jitter");
  const projection = createJitteredProjection(projectionNoJitter, jitterPixels, frame.renderSize);
  return Object.freeze({
    ...frame,
    jitterPixels: Object.freeze(jitterPixels),
    previousJitterPixels: Object.freeze(previousJitterPixels),
    matrices: Object.freeze({
      ...frame.matrices,
      view: Object.freeze(view),
      projectionNoJitter: Object.freeze(projectionNoJitter),
      viewProjectionNoJitter: Object.freeze(multiplyTemporalMatrices(projectionNoJitter, view)),
      projection,
      viewProjection: Object.freeze(multiplyTemporalMatrices(projection, view)),
      inverseViewProjection: Object.freeze(invertTemporalMatrix(multiplyTemporalMatrices(projection, view)))
    })
  });
}

export function withTemporalCameraProjection(camera, rasterFrame, operation) {
  if (typeof operation !== "function" || !camera?.projectionMatrix?.clone || !camera?.projectionMatrixInverse?.clone) throw new TypeError("CP-F21 requires a host camera and synchronous capture operation");
  const projection = requireTemporalVector(rasterFrame.matrices?.projection, 16, "raster projection");
  const previousProjection = camera.projectionMatrix.clone();
  const previousInverse = camera.projectionMatrixInverse.clone();
  try {
    camera.projectionMatrix.fromArray(projection);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    const result = operation(rasterFrame);
    if (result && typeof result.then === "function") throw new Error("Temporal camera capture must be synchronous");
    return result;
  } finally {
    camera.projectionMatrix.copy(previousProjection);
    camera.projectionMatrixInverse.copy(previousInverse);
  }
}

export function validateAppliedTemporalJitter(frame, temporal, bindings) {
  const current = requireTemporalVector(frame.jitterPixels, 2, "applied jitter");
  const requested = requireTemporalVector(temporal.jitterPixels, 2, "requested jitter");
  const previous = requireTemporalVector(frame.previousJitterPixels, 2, "previous applied jitter");
  const expectedPrevious = requireTemporalVector(temporal.previousJitterPixels, 2, "previous requested jitter");
  if (current.some((value, axis) => Math.abs(value - requested[axis]) > 1e-7) || previous.some((value, axis) => Math.abs(value - expectedPrevious[axis]) > 1e-7)) throw new Error("CP-F21 requested jitter was not applied consistently by the host");
  if (current.some((value) => value !== 0) || previous.some((value) => value !== 0)) {
    if (bindings.profile === "foundation-rigid") throw new Error("Foundation rigid velocity is a zero-jitter diagnostic only");
    const unjittered = requireTemporalVector(frame.matrices?.projectionNoJitter, 16, "projectionNoJitter");
    requireTemporalVector(frame.matrices?.viewProjectionNoJitter, 16, "viewProjectionNoJitter");
    const actual = requireTemporalVector(frame.matrices?.projection, 16, "applied projection");
    const expected = createJitteredProjection(unjittered, current, frame.renderSize);
    if (actual.some((value, index) => Math.abs(value - expected[index]) > 1e-7)) throw new Error("CP-F21 raster projection disagrees with the declared jitter");
  }
  return current;
}
