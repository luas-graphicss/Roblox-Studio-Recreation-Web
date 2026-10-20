import { finiteNumber } from "./cameraValidation.js";
import { fieldOfViewDegrees, focalLengthFromFieldOfView } from "./lensProjection.js";

const OWNED_FIELDS = Object.freeze(["fov", "zoom", "filmGauge", "filmOffset"]);

export function createThreeCameraBinding(rendererAdapter) {
  const host = rendererAdapter?.host;
  if (!host || (!host.camera && typeof host.cameraForView !== "function")) throw new Error("CP-F03 requires rendererAdapter.host.camera or cameraForView(viewId)");
  const records = new Map();
  function cameraFor(frame) {
    const camera = typeof host.cameraForView === "function" ? host.cameraForView(frame.viewId) : host.camera;
    if (!camera?.isPerspectiveCamera) throw new TypeError("CP-F03 requires a perspective camera for this view");
    finiteNumber(camera.near, "camera.near", Number.MIN_VALUE);
    finiteNumber(camera.far, "camera.far", Number.MIN_VALUE);
    if (camera.far <= camera.near) throw new RangeError("camera.far must exceed camera.near");
    finiteNumber(camera.zoom, "camera.zoom", Number.MIN_VALUE);
    if (!records.has(camera) || records.get(camera).lastApplied === null) {
      const original = Object.fromEntries(OWNED_FIELDS.map((field) => [field, camera[field]]));
      const sensorHeightMm = camera.getFilmHeight();
      records.set(camera, { original, lastApplied: null, baseline: { sensorWidthMm: camera.getFilmWidth(), sensorHeightMm, focalLengthMm: focalLengthFromFieldOfView(sensorHeightMm, camera.fov) * camera.zoom, overscan: 1 } });
    }
    return camera;
  }
  function describe(frame) {
    const camera = cameraFor(frame);
    camera.updateMatrixWorld(true);
    const matrix = camera.matrixWorld.elements;
    return {
      ...records.get(camera).baseline,
      nearWorld: camera.near,
      farWorld: camera.far,
      positionWorld: [matrix[12], matrix[13], matrix[14]],
      forwardWorld: [-matrix[8], -matrix[9], -matrix[10]],
      worldUnits: host.worldUnits ?? { worldUnit: "meter" },
      unitSource: host.worldUnits ? "authored-host-adapter" : "B00-contract-meters"
    };
  }
  function restoreCamera(camera) {
    const record = records.get(camera);
    if (!record?.lastApplied) return;
    for (const field of OWNED_FIELDS) {
      if (Object.is(camera[field], record.lastApplied[field])) camera[field] = record.original[field];
    }
    camera.updateProjectionMatrix();
    record.lastApplied = null;
  }
  function apply(frame, state, hasAuthoredSettings) {
    const camera = cameraFor(frame);
    const record = records.get(camera);
    if (!state.enabled || !hasAuthoredSettings) {
      restoreCamera(camera);
      return { applied: false, consumer: "host-perspective-camera", reason: state.enabled ? "inherited-host-projection" : "disabled-restored-host" };
    }
    if (camera.view?.enabled) throw new Error("CP-F03 centered projection cannot overwrite an active tiled/off-axis view");
    const lens = state.lens;
    camera.aspect = lens.outputAspect;
    camera.filmGauge = lens.activeHeightMm * Math.max(lens.outputAspect, 1);
    camera.filmOffset = 0;
    camera.fov = fieldOfViewDegrees(lens.activeHeightMm, lens.focalLengthMm);
    camera.zoom = 1 / lens.overscan;
    camera.updateProjectionMatrix();
    record.lastApplied = Object.fromEntries(OWNED_FIELDS.map((field) => [field, camera[field]]));
    return { applied: true, consumer: "host-perspective-camera", reason: "physical-lens-before-scene-capture" };
  }
  return Object.freeze({ describe, apply, restore: (frame) => restoreCamera(cameraFor(frame)), dispose() { for (const camera of records.keys()) restoreCamera(camera); records.clear(); } });
}
