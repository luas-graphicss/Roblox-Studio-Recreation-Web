import { requireFiniteNumber } from "../../contracts/frameContract.js";

export function apertureAxes(anamorphicRatio) {
  requireFiniteNumber(anamorphicRatio, "anamorphicRatio", 0.25, 4);
  const horizontal = Math.sqrt(anamorphicRatio);
  return Object.freeze([horizontal, 1 / horizontal]);
}

export function diaphragmFootprintExtent(radiusPixels, settings) {
  requireFiniteNumber(radiusPixels, "radiusPixels", 0, 24);
  if (radiusPixels === 0) return Object.freeze([0, 0]);
  return Object.freeze(apertureAxes(settings.anamorphicRatio).map((scale) => Math.ceil((radiusPixels + 0.5) * scale)));
}

export function diaphragmKernelWeight(offsetX, offsetY, radiusPixels, settings) {
  requireFiniteNumber(offsetX, "offsetX");
  requireFiniteNumber(offsetY, "offsetY");
  requireFiniteNumber(radiusPixels, "radiusPixels", 0, 24);
  if (radiusPixels === 0) return offsetX === 0 && offsetY === 0 ? 1 : 0;
  const [horizontal, vertical] = apertureAxes(settings.anamorphicRatio);
  const x = offsetX / horizontal, y = offsetY / vertical;
  const radial = Math.hypot(x, y);
  if (radial === 0) return Math.min(1, radiusPixels + 0.5);
  const sector = 2 * Math.PI / settings.bladeCount;
  const angle = Math.atan2(y, x) - settings.bladeRotationDegrees * Math.PI / 180;
  const local = ((angle % sector) + sector) % sector - sector / 2;
  const polygon = Math.cos(Math.PI / settings.bladeCount) / Math.cos(local);
  const boundary = (polygon + (1 - polygon) * settings.bladeCurvature) * radiusPixels;
  return Math.max(0, Math.min(1, boundary + 0.5 - radial));
}

export function createDiaphragmKernel(radiusPixels, settings) {
  const [extentX, extentY] = diaphragmFootprintExtent(radiusPixels, settings);
  const samples = [];
  let normalization = 0;
  for (let y = -extentY; y <= extentY; y += 1) {
    for (let x = -extentX; x <= extentX; x += 1) {
      const weight = diaphragmKernelWeight(x, y, radiusPixels, settings);
      if (weight === 0) continue;
      samples.push({ x: x === 0 ? 0 : x, y: y === 0 ? 0 : y, weight });
      normalization += weight;
    }
  }
  return Object.freeze({ radiusPixels, extentX, extentY, normalization,
    samples: Object.freeze(samples.map((sample) => Object.freeze({ ...sample, weight: sample.weight / normalization }))) });
}
