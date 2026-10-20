export const MOTION_PHASE_ID = "CP-F06";
export const MOTION_RESOURCES = Object.freeze({
  velocity: "CP-F06.velocity",
  validity: "CP-F06.reprojectionValidity",
  identity: "CP-F06.surfaceIdentity",
  metadata: "CP-F06.motionMetadata",
});
export const MOTION_LAYOUT = Object.freeze({
  format: "rgba16f",
  encoding: "uv-current-minus-previous",
  origin: "bottom-left",
  channels: Object.freeze({
    r: "velocity-u-per-frame",
    g: "velocity-v-per-frame",
    b: "previous-hardware-depth-diagnostic",
    a: "motion-vector-valid",
  }),
  resolution: "full-render-size",
  maximumFiniteComponent: 65504,
  clamp: "none",
  validityChannels: Object.freeze({
    r: "history-visible",
    g: "vector-valid",
    b: "current-coverage",
    a: "reactive-translucency",
  }),
});
export const MOTION_LIMITS = Object.freeze({
  maximumSurfaceId: 16777215,
  skySurfaceId: 1,
  depthQuantizationTolerance: 4 / 16777215,
});

export function requireFiniteArray(values, length, label) {
  if (!values || values.length !== length || !Array.from(values).every(Number.isFinite))
    throw new TypeError(`${label} requires ${length} finite components`);
  return values;
}

export function motionResource(target, frame, encoding) {
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
    jitterPixels: Object.freeze([...(frame.jitterPixels ?? [0, 0])]),
    samples: 1,
  });
}
