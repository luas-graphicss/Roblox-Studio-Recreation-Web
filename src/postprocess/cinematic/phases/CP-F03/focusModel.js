import { enumValue, finiteNumber, vector3 } from "./cameraValidation.js";

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function resolveFocus({ mode = "manual", distanceMeters, offsetMeters = 0, trackingTargetWorld, rackDiopters }, { positionWorld, forwardWorld, units, nearMeters, focalLengthMm }) {
  enumValue(mode, "focusMode", ["manual", "tracking", "infinity", "rack"]);
  finiteNumber(offsetMeters, "focusOffsetMeters");
  finiteNumber(nearMeters, "nearMeters", Number.MIN_VALUE);
  finiteNumber(focalLengthMm, "focalLengthMm", 0.1, 10000);
  const positionMeters = vector3(positionWorld, "camera position").map(units.toMeters);
  const direction = vector3(forwardWorld, "camera forward");
  const length = finiteNumber(Math.hypot(...direction), "camera forward length", Number.MIN_VALUE);
  const normal = direction.map((component) => component / length);
  let requestedDistance = null;
  let atInfinity = mode === "infinity";
  if (mode === "manual") requestedDistance = finiteNumber(distanceMeters, "focusDistanceMeters", 0) + offsetMeters;
  if (mode === "tracking") {
    const target = vector3(trackingTargetWorld, "trackingTargetWorld").map(units.toMeters);
    requestedDistance = dot(target.map((component, index) => component - positionMeters[index]), normal);
    if (!(requestedDistance > 0)) throw new RangeError("Tracking target must be in front of the camera");
    requestedDistance += offsetMeters;
  }
  if (mode === "rack") {
    finiteNumber(rackDiopters, "rackDiopters", 0);
    atInfinity = rackDiopters === 0;
    if (!atInfinity) requestedDistance = 1 / rackDiopters + offsetMeters;
  }
  const opticalBoundaryMeters = Math.max(nearMeters, focalLengthMm / 1000);
  const minimumDistanceMeters = finiteNumber(opticalBoundaryMeters + Math.max(0.000001, opticalBoundaryMeters * Number.EPSILON), "minimumFocusDistanceMeters");
  const resolvedDistance = atInfinity ? null : Math.max(finiteNumber(requestedDistance, "resolvedFocusDistance"), minimumDistanceMeters);
  const plane = atInfinity ? null : Object.freeze({ normal: Object.freeze(normal), constantMeters: finiteNumber(-dot(normal, positionMeters) - resolvedDistance, "focus plane constant"), coordinateSpace: "world-meters" });
  return Object.freeze({
    mode,
    atInfinity,
    distanceMeters: resolvedDistance,
    diopters: atInfinity ? 0 : 1 / resolvedDistance,
    requestedDistanceMeters: requestedDistance,
    minimumDistanceMeters,
    clampedToOpticalMinimum: !atInfinity && resolvedDistance !== requestedDistance,
    plane,
    trackingDistancePolicy: "optical-axis-projection-not-euclidean"
  });
}
