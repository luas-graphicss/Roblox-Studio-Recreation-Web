import { resolveMotionDepthCamera } from "./motionBlurDepth.js";
import { validateResource } from "../../contracts/frameContract.js";
import { resolveMotionGeometrySampling } from "./motionBlurGeometry.js";

function requireTexture(resource, frame, label) {
  validateResource(resource, frame, label);
  if (
    !resource.texture ||
    resource.available === false ||
    resource.disposed === true ||
    resource.target?.disposed === true
  )
    throw new TypeError(`CP-F22 unavailable texture: ${label}`);
  if ((resource.samples ?? 1) > 1 || (resource.target?.samples ?? 1) > 1)
    throw new TypeError(
      `CP-F22 ${label} requires an explicit multisample resolve`,
    );
  if (
    resource.target &&
    (resource.target.width !== resource.width ||
      resource.target.height !== resource.height ||
      resource.target.texture !== resource.texture)
  )
    throw new TypeError(
      `CP-F22 ${label} target metadata disagrees with its texture`,
    );
}

export function validateMotionBlurInputs(inputs, frame, settings) {
  const { color, velocity, depth, validity, objectSize, cameraVelocity } =
    inputs;
  requireTexture(color, frame, "color");
  requireTexture(velocity, frame, "velocity");
  requireTexture(depth, frame, "depth");
  if (
    color.format !== "rgba16f" ||
    !color.encoding.startsWith("scene-linear-") ||
    (color.transfer !== undefined && color.transfer !== "linear")
  )
    throw new TypeError(
      "CP-F22 requires scene-linear RGBA16F color before display conversion",
    );
  if (
    color.width !== frame.outputSize.width ||
    color.height !== frame.outputSize.height
  )
    throw new Error(
      "CP-F22 requires post-reconstruction output-sized color; CP-F21 must resolve the input first",
    );
  if (
    color.preExposure !== undefined &&
    (typeof color.preExposure !== "number" ||
      !Number.isFinite(color.preExposure) ||
      color.preExposure <= 0)
  )
    throw new TypeError("CP-F22 invalid color pre-exposure");
  if (
    velocity.format !== "rgba16f" ||
    velocity.encoding !== "uv-current-minus-previous"
  )
    throw new TypeError(
      "CP-F22 requires RGBA16F UV/frame velocity with alpha validity",
    );
  if (
    ![
      "hardware-depth-opengl",
      "linear-depth-meters",
      "positive-view-depth-meters",
    ].includes(depth.encoding)
  )
    throw new TypeError(
      "CP-F22 requires explicitly encoded OpenGL or linear-meter depth",
    );
  resolveMotionDepthCamera(depth, frame);
  if (depth.encoding === "hardware-depth-opengl") {
    const near = depth.nearMeters ?? frame.camera?.nearMeters;
    const far = depth.farMeters ?? frame.camera?.farMeters;
    if (
      !Number.isFinite(near) ||
      !Number.isFinite(far) ||
      near <= 0 ||
      far <= near
    )
      throw new TypeError(
        "CP-F22 hardware depth requires finite positive near/far meters",
      );
  }
  for (const [label, resource] of Object.entries({
    velocity,
    depth,
    validity,
    objectSize,
    cameraVelocity,
  })) {
    if (!resource) continue;
    requireTexture(resource, frame, label);
    if (resource.width !== depth.width || resource.height !== depth.height)
      throw new Error(`CP-F22 mismatched geometry extent: ${label}`);
    resolveMotionGeometrySampling(resource, frame, settings);
  }
  const fullRender =
    depth.width === frame.renderSize.width &&
    depth.height === frame.renderSize.height;
  const fullOutput =
    depth.width === frame.outputSize.width &&
    depth.height === frame.outputSize.height;
  if (!fullRender && !fullOutput)
    throw new Error("CP-F22 geometry must match render or output extent");
  if (
    validity &&
    (validity.encoding !== "motion-history-visibility-and-coverage" ||
      !["rgba8", "rgba16f"].includes(validity.format))
  )
    throw new TypeError("CP-F22 unsupported validity layout");
  if (settings.perObjectSizePercent > 0 && (!objectSize || !cameraVelocity))
    throw new Error(
      "CP-F22 per-object size requires object size AND camera-only velocity; camera motion must not be discarded",
    );
  if (
    objectSize &&
    (objectSize.encoding !== "object-screen-diameter-fraction" ||
      !["r16f", "r32f", "rgba16f"].includes(objectSize.format))
  )
    throw new TypeError("CP-F22 object size must be a screen-width fraction");
  if (
    cameraVelocity &&
    (cameraVelocity.encoding !== "uv-current-minus-previous" ||
      cameraVelocity.format !== "rgba16f")
  )
    throw new TypeError(
      "CP-F22 camera-only velocity has an incompatible layout",
    );
  if (
    settings.translucencyPolicy === "premultiplied" &&
    (color.alphaMode !== "premultiplied" || !validity)
  )
    throw new Error(
      "CP-F22 translucent gather requires explicit premultiplied color and coverage/reactive metadata",
    );
  if (inputs.camera) {
    validateResource(inputs.camera, frame, "CP-F22 physical camera");
    if (!inputs.camera.value || typeof inputs.camera.value !== "object")
      throw new TypeError("CP-F22 physical camera requires a value resource");
  }
  return inputs;
}

export function motionBlurValue(value, frame) {
  return Object.freeze({
    value,
    frameId: frame.frameId,
    viewId: frame.viewId,
    generation: frame.generation,
    provenance: "gpu",
  });
}

export function motionBlurTexture(target, frame, encoding) {
  return Object.freeze({
    texture: target.texture,
    target,
    width: target.width,
    height: target.height,
    format: target.userData.format,
    encoding,
    origin: "bottom-left",
    frameId: frame.frameId,
    viewId: frame.viewId,
    generation: frame.generation,
    provenance: "gpu",
  });
}

export function motionBlurColor(target, source, frame) {
  const { rangeValidated, rangeMask, validation, ...metadata } = source;
  return Object.freeze({
    ...metadata,
    ...motionBlurTexture(target, frame, source.encoding),
    owner: "CP-F22",
    preExposure: source.preExposure ?? 1,
    rangeValidationInherited: false,
    referenceVerified: false,
  });
}
