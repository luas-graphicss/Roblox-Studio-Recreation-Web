import { enumValue, finiteNumber, positiveNumber } from "./cameraValidation.js";

const DEGREES_PER_RADIAN = 180 / Math.PI;

export function fieldOfViewDegrees(sensorExtentMm, focalLengthMm) {
  positiveNumber(sensorExtentMm, "sensorExtentMm");
  positiveNumber(focalLengthMm, "focalLengthMm");
  return 2 * Math.atan(sensorExtentMm / (2 * focalLengthMm)) * DEGREES_PER_RADIAN;
}

export function focalLengthFromFieldOfView(sensorExtentMm, fieldOfView) {
  positiveNumber(sensorExtentMm, "sensorExtentMm");
  finiteNumber(fieldOfView, "fieldOfViewDegrees", 0.000001, 179.999999);
  return sensorExtentMm / (2 * Math.tan(fieldOfView / (2 * DEGREES_PER_RADIAN)));
}

export function resolveLensProjection({ sensorWidthMm, sensorHeightMm, focalLengthMm, squeezeFactor = 1, overscan = 1, gateFit = "crop" }, outputSize) {
  finiteNumber(sensorWidthMm, "sensorWidthMm", 0.1, 1000);
  finiteNumber(sensorHeightMm, "sensorHeightMm", 0.1, 1000);
  finiteNumber(focalLengthMm, "focalLengthMm", 0.1, 10000);
  finiteNumber(squeezeFactor, "squeezeFactor", 1, 4);
  finiteNumber(overscan, "overscan", 1, 4);
  enumValue(gateFit, "gateFit", ["crop", "horizontal", "vertical"]);
  for (const dimension of ["width", "height"]) {
    if (!Number.isInteger(outputSize?.[dimension]) || outputSize[dimension] < 1) throw new TypeError("Output size requires positive integer pixels");
  }
  const outputAspect = outputSize.width / outputSize.height;
  const desqueezedWidthMm = sensorWidthMm * squeezeFactor;
  const preserveWidth = gateFit === "horizontal" || (gateFit === "crop" && outputAspect >= desqueezedWidthMm / sensorHeightMm);
  const activeHeightMm = preserveWidth ? desqueezedWidthMm / outputAspect : sensorHeightMm;
  const activeWidthMm = preserveWidth ? desqueezedWidthMm : sensorHeightMm * outputAspect;
  const cropExtent = 1 / overscan;
  return Object.freeze({
    sensorWidthMm,
    sensorHeightMm,
    focalLengthMm,
    squeezeFactor,
    overscan,
    gateFit,
    outputAspect,
    activeWidthMm,
    activeHeightMm,
    capturedSensorWidthMm: activeWidthMm / squeezeFactor,
    baseHorizontalFovDegrees: fieldOfViewDegrees(activeWidthMm, focalLengthMm),
    baseVerticalFovDegrees: fieldOfViewDegrees(activeHeightMm, focalLengthMm),
    horizontalFovDegrees: fieldOfViewDegrees(activeWidthMm * overscan, focalLengthMm),
    verticalFovDegrees: fieldOfViewDegrees(activeHeightMm * overscan, focalLengthMm),
    projectionScaleX: 2 * focalLengthMm / (activeWidthMm * overscan),
    projectionScaleY: 2 * focalLengthMm / (activeHeightMm * overscan),
    outputCropUv: Object.freeze({ x: (1 - cropExtent) / 2, y: (1 - cropExtent) / 2, width: cropExtent, height: cropExtent }),
    overscanPolicy: "expanded-frustum-with-explicit-center-crop"
  });
}
