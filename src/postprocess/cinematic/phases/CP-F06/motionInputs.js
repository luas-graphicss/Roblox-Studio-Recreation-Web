import { requireFiniteArray } from "./motionContract.js";

export const MOTION_BINDINGS_SETTING = "CP-F06.bindings";
export const MOTION_ENABLED_SETTING = "CP-F06.enabled";

export function resolveMotionBindings(value) {
  if (value !== undefined && value !== null && (typeof value !== "object" || Array.isArray(value)))
    throw new TypeError("CP-F06 bindings must be a record");
  if (value && Object.keys(value).some((key) => !["depth", "coverage", "camera"].includes(key)))
    throw new Error("CP-F06 unknown resource binding");
  const bindings = {
    depth: value?.depth ?? "sceneDepth",
    coverage: value?.coverage ?? null,
    camera: value?.camera ?? null,
  };
  for (const [key, name] of Object.entries(bindings)) {
    if (name === null && key !== "depth") continue;
    if (typeof name !== "string" || !name.trim() || name === "$color" || name.startsWith("CP-F06."))
      throw new TypeError(`CP-F06 invalid ${key} resource binding`);
  }
  if (
    new Set(Object.values(bindings).filter(Boolean)).size !== Object.values(bindings).filter(Boolean).length
  )
    throw new Error("CP-F06 bindings must name distinct resources");
  return Object.freeze(bindings);
}

export function resolveMotionEnabled(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "boolean") throw new TypeError("CP-F06 enabled must be boolean or null/AUTO");
  return value;
}

export function validateMotionInput(resource, frame, label, encoding) {
  if (
    !resource?.texture ||
    resource.frameId !== frame.frameId ||
    resource.viewId !== frame.viewId ||
    resource.generation !== frame.generation
  )
    throw new Error(`CP-F06 missing, stale or cross-view ${label}`);
  if (
    resource.width !== frame.renderSize.width ||
    resource.height !== frame.renderSize.height ||
    resource.origin !== "bottom-left"
  )
    throw new Error(`CP-F06 ${label} must use the full current render extent and bottom-left origin`);
  if (resource.encoding !== encoding)
    throw new Error(`CP-F06 unsupported ${label} encoding: ${resource.encoding}`);
  if (encoding === "hardware-depth-opengl" && !["depth24", "r32f"].includes(resource.format))
    throw new Error("CP-F06 depth must have hardware-depth precision");
  if ((resource.samples ?? resource.target?.samples ?? 1) > 1)
    throw new Error("CP-F06 requires correlated single-sample geometry");
  if (resource.jitterPixels) {
    requireFiniteArray(resource.jitterPixels, 2, `${label} jitter`);
    if (resource.jitterPixels.some((value, index) => value !== (frame.jitterPixels?.[index] ?? 0)))
      throw new Error(`CP-F06 ${label} jitter is misaligned`);
  }
  return resource;
}

export function validateMotionCameraAlignment(frame, camera) {
  if (!camera?.isPerspectiveCamera && !camera?.isOrthographicCamera)
    throw new Error("CP-F06 requires a perspective or orthographic host camera");
  for (const [name, actual] of [
    ["view", camera.matrixWorldInverse?.elements],
    ["projection", camera.projectionMatrix?.elements],
  ]) {
    const expected = requireFiniteArray(frame.matrices?.[name], 16, `Frame ${name}`);
    requireFiniteArray(actual, 16, `Host ${name}`);
    if (actual.some((value, index) => Math.abs(value - expected[index]) > 1e-8))
      throw new Error(`CP-F06 host ${name} changed after frame finalization`);
  }
}
