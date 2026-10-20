import {
  MAXIMUM_VELOCITY_IN_UV,
  decodeVelocityFromUnitRange,
  previousUvFromVelocity,
  velocityLengthInPixels,
} from "./mlVelocityEncodingCore.js";

export const REPROJECTION_LIMITS = Object.freeze({

  maximumStaticReprojectionErrorInPixels: 0.1,
  bilinearTapCount: 4,
  maximumVelocityInUv: MAXIMUM_VELOCITY_IN_UV,
});

export const REPROJECTION_STATUS = Object.freeze({
  reprojected: "reprojected",
  velocityInvalid: "velocityInvalid",
  outsideFrame: "outsideFrame",
  frameSizeInvalid: "frameSizeInvalid",
});

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function frameSizeOf(frame) {
  const source = frame || {};
  const width = Math.floor(finiteNumberOrFallback(source.width, 0));
  const height = Math.floor(finiteNumberOrFallback(source.height, 0));
  return { width, height, valid: width > 0 && height > 0 };
}


export function pixelCentreToUv(pixelX, pixelY, width, height) {
  return [
    (finiteNumberOrFallback(pixelX, 0) + 0.5) / Math.max(1, width),
    (finiteNumberOrFallback(pixelY, 0) + 0.5) / Math.max(1, height),
  ];
}


export function uvToPixelCentre(u, v, width, height) {
  return [
    finiteNumberOrFallback(u, 0) * Math.max(1, width) - 0.5,
    finiteNumberOrFallback(v, 0) * Math.max(1, height) - 0.5,
  ];
}


export function resolveScreenVelocity(request) {
  const input = request || {};
  if (Array.isArray(input.screenVelocity)) {
    return [
      finiteNumberOrFallback(input.screenVelocity[0], 0),
      finiteNumberOrFallback(input.screenVelocity[1], 0),
    ];
  }
  if (Array.isArray(input.encodedVelocity)) {
    return decodeVelocityFromUnitRange(input.encodedVelocity[0], input.encodedVelocity[1]);
  }
  return [0, 0];
}


export function bilinearHistoryTaps(previousPixelX, previousPixelY, width, height) {
  const baseX = Math.floor(finiteNumberOrFallback(previousPixelX, 0));
  const baseY = Math.floor(finiteNumberOrFallback(previousPixelY, 0));
  const fractionX = finiteNumberOrFallback(previousPixelX, 0) - baseX;
  const fractionY = finiteNumberOrFallback(previousPixelY, 0) - baseY;
  const taps = [];
  for (let offsetY = 0; offsetY <= 1; offsetY++) {
    for (let offsetX = 0; offsetX <= 1; offsetX++) {
      const pixelX = baseX + offsetX;
      const pixelY = baseY + offsetY;
      const weightX = offsetX === 0 ? 1 - fractionX : fractionX;
      const weightY = offsetY === 0 ? 1 - fractionY : fractionY;
      taps.push(
        Object.freeze({
          pixelX,
          pixelY,
          weight: weightX * weightY,
          insideFrame: pixelX >= 0 && pixelY >= 0 && pixelX < width && pixelY < height,
        }),
      );
    }
  }
  return Object.freeze(taps);
}


export function reprojectPixel(request) {
  const input = request || {};
  const frame = frameSizeOf(input.frame);
  const pixelX = finiteNumberOrFallback(input.pixelX, 0);
  const pixelY = finiteNumberOrFallback(input.pixelY, 0);

  if (!frame.valid) {
    return Object.freeze({
      status: REPROJECTION_STATUS.frameSizeInvalid,
      insideFrame: false,
      previousPixelX: pixelX,
      previousPixelY: pixelY,
      previousU: 0,
      previousV: 0,
      screenVelocity: Object.freeze([0, 0]),
      motionInPixels: 0,
      taps: Object.freeze([]),
    });
  }

  const velocityIsValid = input.velocityIsValid === undefined ? true : !!input.velocityIsValid;
  const screenVelocity = resolveScreenVelocity(input);
  const currentUv = pixelCentreToUv(pixelX, pixelY, frame.width, frame.height);
  const previousUv = previousUvFromVelocity(currentUv, screenVelocity);
  const previousPixel = uvToPixelCentre(previousUv[0], previousUv[1], frame.width, frame.height);
  const insideFrame =
    previousUv[0] >= 0 && previousUv[0] < 1 && previousUv[1] >= 0 && previousUv[1] < 1;

  let status = REPROJECTION_STATUS.reprojected;
  if (!velocityIsValid) status = REPROJECTION_STATUS.velocityInvalid;
  else if (!insideFrame) status = REPROJECTION_STATUS.outsideFrame;

  return Object.freeze({
    status,
    insideFrame,
    previousPixelX: previousPixel[0],
    previousPixelY: previousPixel[1],
    previousU: previousUv[0],
    previousV: previousUv[1],
    screenVelocity: Object.freeze(screenVelocity),
    motionInPixels: velocityLengthInPixels(screenVelocity, frame.width, frame.height),
    taps:
      status === REPROJECTION_STATUS.reprojected
        ? bilinearHistoryTaps(previousPixel[0], previousPixel[1], frame.width, frame.height)
        : Object.freeze([]),
  });
}


export function measureReprojectionErrorInPixels(reprojection, expectedPreviousPixelX, expectedPreviousPixelY) {
  const source = reprojection || {};
  const errorX = finiteNumberOrFallback(source.previousPixelX, 0) - finiteNumberOrFallback(expectedPreviousPixelX, 0);
  const errorY = finiteNumberOrFallback(source.previousPixelY, 0) - finiteNumberOrFallback(expectedPreviousPixelY, 0);
  return Math.sqrt(errorX * errorX + errorY * errorY);
}
