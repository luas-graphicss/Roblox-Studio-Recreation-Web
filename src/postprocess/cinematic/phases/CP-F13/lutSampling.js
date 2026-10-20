import { assertLutTable, requireFinite } from "./lutTable.js";

export const LUT_INTERPOLATIONS = Object.freeze(["trilinear", "tetrahedral"]);
export const LUT_BOUNDARY_POLICIES = Object.freeze(["extrapolate", "clamp"]);

export function validateSampling(interpolation, boundary) {
  if (!LUT_INTERPOLATIONS.includes(interpolation)) throw new TypeError("Unknown LUT interpolation");
  if (!LUT_BOUNDARY_POLICIES.includes(boundary)) throw new TypeError("LUT boundary must be extrapolate or explicit clamp");
}

function sampleChannel(table, red, green, blue, channel) {
  return table.values[3 * (red + table.size * (green + table.size * blue)) + channel];
}

export function sampleLut(table, color, { interpolation = "trilinear", boundary = "extrapolate" } = {}) {
  assertLutTable(table);
  validateSampling(interpolation, boundary);
  if (!color || color.length !== 3) throw new TypeError("LUT sampling requires an RGB triplet");
  const coordinates = Array.from(color, (value, channel) => {
    const normalized = (requireFinite(value, `Input channel ${channel}`) - table.domainMin[channel]) / (table.domainMax[channel] - table.domainMin[channel]);
    return (boundary === "clamp" ? Math.max(0, Math.min(1, normalized)) : normalized) * (table.size - 1);
  });
  const lower = coordinates.map((value) => Math.max(0, Math.min(table.size - 2, Math.floor(value))));
  const fraction = coordinates.map((value, channel) => value - lower[channel]);
  if (table.dimension === 1) return fraction.map((weight, channel) => {
    const start = table.values[3 * lower[channel] + channel];
    return start + weight * (table.values[3 * (lower[channel] + 1) + channel] - start);
  });
  if (interpolation === "tetrahedral") {
    const axes = [0, 1, 2].sort((left, right) => fraction[right] - fraction[left] || left - right);
    return [0, 1, 2].map((channel) => {
      const corner = [...lower];
      let previous = sampleChannel(table, ...corner, channel);
      let result = previous;
      for (const axis of axes) {
        corner[axis] += 1;
        const next = sampleChannel(table, ...corner, channel);
        result += fraction[axis] * (next - previous);
        previous = next;
      }
      return result;
    });
  }
  return [0, 1, 2].map((channel) => {
    const interpolate = (start, end, weight) => start + (end - start) * weight;
    const samplePlane = (blue) => {
      const sampleRow = (green) => interpolate(sampleChannel(table, lower[0], green, blue, channel), sampleChannel(table, lower[0] + 1, green, blue, channel), fraction[0]);
      return interpolate(sampleRow(lower[1]), sampleRow(lower[1] + 1), fraction[1]);
    };
    return interpolate(samplePlane(lower[2]), samplePlane(lower[2] + 1), fraction[2]);
  });
}
