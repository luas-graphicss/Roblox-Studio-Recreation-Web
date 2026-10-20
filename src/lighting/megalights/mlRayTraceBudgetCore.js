import { raysPerPixelForTier } from "./mlRayTraceCore.js";

export const UNBOUNDED_RAYS_REFUSAL_CODE = "rayTrace.noUnboundedRays";

function wholeCount(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}


export function rayCeilingForFrame(request) {
  const settings = request || {};
  const pixelCount = wholeCount(settings.pixelCount);
  const raysPerPixel = wholeCount(settings.raysPerPixel);
  if (pixelCount === 0) {
    return { totalRays: 0, bounded: true, reason: "no pixels to trace" };
  }
  if (raysPerPixel === 0) {
    return {
      totalRays: 0,
      bounded: false,
      reason: UNBOUNDED_RAYS_REFUSAL_CODE + ": raysPerPixel must be a positive whole number",
    };
  }
  return {
    totalRays: pixelCount * raysPerPixel,
    bounded: true,
    reason: pixelCount + " pixels x " + raysPerPixel + " ray(s) per pixel",
  };
}


export function createRayBudget(request) {
  const settings = request || {};
  const raysPerPixel = Number.isFinite(Number(settings.raysPerPixel))
    ? wholeCount(settings.raysPerPixel)
    : raysPerPixelForTier(settings.tierName);
  const ceiling = rayCeilingForFrame({ pixelCount: settings.pixelCount, raysPerPixel });

  let spentRays = 0;
  let refusedRays = 0;

  return Object.freeze({
    tierName: settings.tierName || "",
    raysPerPixel,
    totalRays: ceiling.totalRays,
    bounded: ceiling.bounded,
    reason: ceiling.reason,

    spend(rayCount) {
      const requested = wholeCount(rayCount) || 1;
      if (spentRays + requested > ceiling.totalRays) {
        refusedRays += requested;
        return false;
      }
      spentRays += requested;
      return true;
    },
    remaining() {
      return Math.max(0, ceiling.totalRays - spentRays);
    },
    statistics() {
      return {
        tierName: settings.tierName || "",
        raysPerPixel,
        totalRays: ceiling.totalRays,
        spentRays,
        remainingRays: Math.max(0, ceiling.totalRays - spentRays),
        refusedRays,
        bounded: ceiling.bounded,
        reason: ceiling.reason,
      };
    },
  });
}
