function nonnegativeFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new TypeError(`CP-F22 ${label} must be a finite nonnegative number`);
  return value;
}

export function resolveMotionBlurShutter(
  settings,
  frame,
  physicalCamera = null,
) {
  const delta = nonnegativeFinite(frame.deltaSeconds, "deltaSeconds");
  let seconds;
  let source;
  if (settings.shutterMode === "camera") {
    seconds = nonnegativeFinite(
      physicalCamera
        ? physicalCamera.shutter?.seconds
        : frame.camera?.shutterSeconds,
      "camera shutter seconds",
    );
    source = physicalCamera
      ? "CP-F03.camera.shutter.seconds"
      : "host-camera-shutter-seconds";
  } else if (settings.shutterMode === "seconds") {
    seconds = settings.shutterSeconds;
    source = "authored-shutter-seconds";
  } else {
    seconds =
      (settings.shutterAngleDegrees / 360) *
      (settings.targetFps > 0 ? 1 / settings.targetFps : delta);
    source =
      settings.targetFps > 0
        ? "authored-angle-and-target-fps"
        : "angle-and-render-timestep";
  }
  const intervals = {
    centered: [-0.5, 0.5],
    trailing: [-1, 0],
    leading: [0, 1],
  };
  const interval = intervals[settings.shutterTiming];
  const maximumLength = Math.min(
    settings.maximumBlurPixels,
    (settings.maximumBlurPercent * frame.outputSize.width) / 100,
  );
  const bypassReason = !settings.enabled
    ? "disabled"
    : settings.amount === 0
      ? "zero-amount"
      : seconds === 0
        ? "closed-shutter"
        : maximumLength === 0
          ? "zero-maximum"
          : delta === 0
            ? "paused"
            : frame.cameraCut
              ? "camera-cut"
              : null;
  const velocityScale = bypassReason ? 0 : (seconds * settings.amount) / delta;
  if (!Number.isFinite(velocityScale) || velocityScale > 1e12)
    throw new RangeError(
      "CP-F22 shutter-to-frame ratio is outside the supported finite range",
    );
  return Object.freeze({
    seconds,
    source,
    interval: Object.freeze([...interval]),
    velocityScale,
    maximumLength,
    maximumSupport: maximumLength * Math.max(...interval.map(Math.abs)),
    bypassReason,
    active: bypassReason === null,
    exposureAppliedToColor: false,
  });
}

export function shutterDisplacement(velocityUv, outputSize, shutter) {
  if (
    !Array.isArray(velocityUv) ||
    velocityUv.length !== 2 ||
    !velocityUv.every(Number.isFinite)
  )
    throw new TypeError("CP-F22 velocity requires two finite UV components");
  const displacement = [
    velocityUv[0] * outputSize.width * shutter.velocityScale,
    velocityUv[1] * outputSize.height * shutter.velocityScale,
  ];
  if (!displacement.every(Number.isFinite))
    throw new RangeError(
      "CP-F22 shutter displacement exceeds the finite numeric range",
    );
  const length = Math.hypot(...displacement);
  const scale =
    length > shutter.maximumLength ? shutter.maximumLength / length : 1;
  return displacement.map((component) => component * scale);
}
