import { requireFiniteVector } from "../CP-F04/colorMatrix.js";
import { OUTPUT_WHITE_POINTS } from "./outputContract.js";

export function resolveOutputWhitePoint(value) {
  const coordinates = typeof value === "string" ? OUTPUT_WHITE_POINTS[value] : value;
  if (!coordinates) throw new TypeError("CP-F28 source white point is unsupported");
  const point = requireFiniteVector(coordinates, 2, "CP-F28 source white point");
  if (point.some(coordinate => coordinate <= 0 || coordinate >= 1) || point[0] + point[1] >= 1) throw new RangeError("CP-F28 source white point is outside valid chromaticity");
  return Object.freeze(point);
}
