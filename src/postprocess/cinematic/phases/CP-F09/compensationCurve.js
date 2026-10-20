import { MAX_COMPENSATION_CURVE_POINTS } from "./exposureContract.js";
import { isAutomaticValue, requireExposureNumber, requireExposureObject } from "./exposureValidation.js";

export function createCompensationCurve(asset) {
  if (isAutomaticValue(asset)) return null;
  requireExposureObject(asset, "compensationCurve");
  if (asset.version !== 1 || asset.interpolation !== "linear" || typeof asset.id !== "string" || !asset.id.trim()) {
    throw new TypeError("Compensation curve requires id, version 1 and explicit linear interpolation");
  }
  if (!Array.isArray(asset.points) || asset.points.length < 1 || asset.points.length > MAX_COMPENSATION_CURVE_POINTS) {
    throw new RangeError(`Compensation curve requires 1..${MAX_COMPENSATION_CURVE_POINTS} points`);
  }
  const points = asset.points.map((point, index) => {
    requireExposureObject(point, `curve point ${index}`);
    return Object.freeze({
      ev100: requireExposureNumber(point.ev100, `curve point ${index}.ev100`, -64, 64),
      compensationStops: requireExposureNumber(point.compensationStops, `curve point ${index}.compensationStops`, -16, 16)
    });
  });
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].ev100 <= points[index - 1].ev100) throw new RangeError("Curve EV100 coordinates must be strictly increasing");
  }
  return Object.freeze({ id: asset.id, version: 1, interpolation: "linear", points: Object.freeze(points) });
}

export function evaluateCompensationCurve(curve, ev100) {
  requireExposureNumber(ev100, "curve EV100", -64, 64);
  if (!curve) return 0;
  const points = curve.points;
  if (ev100 <= points[0].ev100) return points[0].compensationStops;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    if (ev100 > right.ev100) continue;
    const left = points[index - 1];
    const weight = (ev100 - left.ev100) / (right.ev100 - left.ev100);
    return left.compensationStops + weight * (right.compensationStops - left.compensationStops);
  }
  return points.at(-1).compensationStops;
}
