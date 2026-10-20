import {
  validateSize,
  validateResource,
  requireFiniteNumber,
} from "../../contracts/frameContract.js";
import { validateChromaticCrop } from "./chromaticSettings.js";
import { CHROMATIC_CHANNEL_WEIGHTS, CHROMATIC_INTENSITY_SCALE } from "./chromaticContract.js";

export function resolveChromaticGeometry(settings, source, frame, cameraResource = null) {
  let crop = Object.freeze([0, 0, 1, 1]);
  let width = source.width;
  let height = source.height;
  if (settings.enabled && settings.cropMode !== "preserve") {
    validateSize(frame.outputSize, "CP-F23 outputSize");
    width = frame.outputSize.width;
    height = frame.outputSize.height;
    if (settings.cropMode === "camera") {
      validateResource(cameraResource, frame, "CP-F23 camera binding");
      const camera = cameraResource.value;
      const lens = camera?.lens;
      const overscan = requireFiniteNumber(lens?.overscan, "CP-F23 camera overscan", 1, 4);
      if (overscan !== 1 && (!camera.enabled || !camera.binding?.applied))
        throw new Error("CP-F23 cannot crop an unapplied camera overscan");
      const rectangle = lens.outputCropUv;
      crop = validateChromaticCrop([
        rectangle?.x,
        rectangle?.y,
        rectangle?.width,
        rectangle?.height,
      ]);
      const expectedExtent = 1 / overscan;
      if (
        Math.abs(crop[2] - expectedExtent) > 1e-9 ||
        Math.abs(crop[3] - expectedExtent) > 1e-9 ||
        Math.abs(crop[0] - (1 - expectedExtent) / 2) > 1e-9 ||
        Math.abs(crop[1] - (1 - expectedExtent) / 2) > 1e-9
      )
        throw new Error("CP-F23 camera crop disagrees with overscan");
    } else crop = settings.cropUv;
  }
  validateSize({ width, height }, "CP-F23 output extent");
  const diagonal = Math.hypot(frame.outputSize.width, frame.outputSize.height);
  const axisScale = Object.freeze([
    frame.outputSize.width / diagonal,
    frame.outputSize.height / diagonal,
  ]);
  const exactCopy =
    width === source.width &&
    height === source.height &&
    crop.every((value, index) => value === [0, 0, 1, 1][index]);
  return Object.freeze({
    width,
    height,
    crop,
    axisScale,
    exactCopy,
    cropped: !crop.every((value, index) => value === [0, 0, 1, 1][index]),
  });
}

export function chromaticRadialWeight(uv, settings, geometry) {
  const radius = Math.hypot(
    2 * (uv[0] - settings.center[0]) * geometry.axisScale[0],
    2 * (uv[1] - settings.center[1]) * geometry.axisScale[1],
  );
  if (!settings.enabled || settings.intensity === 0 || settings.startOffset === 1) return 0;
  return Math.min(1, Math.max(0, (radius - settings.startOffset) / (1 - settings.startOffset)));
}

export function chromaticSampleCoordinates(uv, settings, geometry) {
  const weight = chromaticRadialWeight(uv, settings, geometry);
  const strength = settings.intensity * CHROMATIC_INTENSITY_SCALE * weight;
  const map = (channelWeight) =>
    Object.freeze(
      uv.map(
        (coordinate, axis) =>
          geometry.crop[axis] +
          (settings.center[axis] +
            (coordinate - settings.center[axis]) * (1 - strength * channelWeight)) *
            geometry.crop[axis + 2],
      ),
    );
  return Object.freeze({
    red: map(CHROMATIC_CHANNEL_WEIGHTS[0]),
    green: map(CHROMATIC_CHANNEL_WEIGHTS[1]),
    blue: map(CHROMATIC_CHANNEL_WEIGHTS[2]),
    alpha: map(0),
    weight,
  });
}
