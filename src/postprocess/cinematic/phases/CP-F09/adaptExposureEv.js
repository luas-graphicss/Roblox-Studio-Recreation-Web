import { requireExposureNumber } from "./exposureValidation.js";

export function adaptExposureEv({ actualEv100, targetEv100, deltaSeconds, speedUpStopsPerSecond, speedDownStopsPerSecond, transitionDistanceStops }) {
  requireExposureNumber(actualEv100, "actualEv100", -128, 128);
  requireExposureNumber(targetEv100, "targetEv100", -128, 128);
  requireExposureNumber(deltaSeconds, "deltaSeconds", 0);
  requireExposureNumber(speedUpStopsPerSecond, "speedUpStopsPerSecond", 0, 128);
  requireExposureNumber(speedDownStopsPerSecond, "speedDownStopsPerSecond", 0, 128);
  requireExposureNumber(transitionDistanceStops, "transitionDistanceStops", 0, 32);
  const signedDistance = targetEv100 - actualEv100;
  const direction = Math.sign(signedDistance);
  const initialDistance = Math.abs(signedDistance);
  const speed = direction > 0 ? speedUpStopsPerSecond : speedDownStopsPerSecond;
  if (initialDistance === 0 || speed === 0 || deltaSeconds === 0) return actualEv100;
  if (transitionDistanceStops === 0) return actualEv100 + direction * Math.min(initialDistance, speed * deltaSeconds);
  const linearDistance = Math.max(0, initialDistance - transitionDistanceStops);
  const linearSeconds = linearDistance / speed;
  if (deltaSeconds <= linearSeconds) return actualEv100 + direction * speed * deltaSeconds;
  const exponentialSeconds = deltaSeconds - linearSeconds;
  const remainingDistance = Math.min(initialDistance, transitionDistanceStops) * Math.exp(-speed * exponentialSeconds / transitionDistanceStops);
  return targetEv100 - direction * remainingDistance;
}
