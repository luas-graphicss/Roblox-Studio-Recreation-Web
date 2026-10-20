import {
  DISOCCLUSION_POLICY_DEFAULTS,
  DISOCCLUSION_STATE,
  resolveDisocclusionPolicy,
} from "./mlDisocclusionPolicyCore.js";
import { gatherDisocclusionNeighbourhood } from "./mlDisocclusionNeighbourhoodCore.js";
import { accumulateInTonemappedSpace, luminanceOf } from "./mlTonemappedAccumulationCore.js";
import { clampRadianceToNeighbourhood } from "./mlAntiFireflyCore.js";
import { resolveShadingConfidence } from "./mlShadingConfidenceCore.js";

export const DISOCCLUSION_FRAME_REFUSAL = Object.freeze({
  none: "none",
  signalMissing: "signalMissing",
  emptyFrame: "emptyFrame",
  overBudget: "overBudget",
});

export const DISOCCLUSION_FRAME_DEFAULTS = Object.freeze({


  maxResolvedPixels: 65536,


  diffuseEnergyShareWithoutEvidence: 1,
});

const BLACK_RADIANCE = Object.freeze({ r: 0, g: 0, b: 0 });

function radianceOrBlack(value) {
  if (!value) return BLACK_RADIANCE;
  return {
    r: Number(value.r) || 0,
    g: Number(value.g) || 0,
    b: Number(value.b) || 0,
  };
}

function scaledRadiance(radiance, scale) {
  return { r: radiance.r * scale, g: radiance.g * scale, b: radiance.b * scale };
}


function secondMomentForHeldRelativeVariance(luminance, heldRelativeVariance) {
  return luminance * luminance * (1 + heldRelativeVariance);
}

function emptyResult(refusal) {
  return Object.freeze({
    resolved: false,
    refusal,
    width: 0,
    height: 0,
    diffuse: null,
    specular: null,
    accumulatedFrameCounts: null,
    shadingConfidence: null,
    stats: Object.freeze({ pixelCount: 0 }),
  });
}










export function resolveDisocclusionFrame(request) {
  const settings = request || {};
  const readTexel = typeof settings.readTexel === "function" ? settings.readTexel : null;
  if (!readTexel) return emptyResult(DISOCCLUSION_FRAME_REFUSAL.signalMissing);

  const width = Math.max(0, Math.floor(Number(settings.width) || 0));
  const height = Math.max(0, Math.floor(Number(settings.height) || 0));
  const pixelCount = width * height;
  if (pixelCount === 0) return emptyResult(DISOCCLUSION_FRAME_REFUSAL.emptyFrame);

  const maxResolvedPixels = Number.isFinite(Number(settings.maxResolvedPixels))
    ? Math.max(0, Math.floor(Number(settings.maxResolvedPixels)))
    : DISOCCLUSION_FRAME_DEFAULTS.maxResolvedPixels;
  if (pixelCount > maxResolvedPixels) return emptyResult(DISOCCLUSION_FRAME_REFUSAL.overBudget);

  const readUpsampledRadiance =
    typeof settings.readUpsampledRadiance === "function" ? settings.readUpsampledRadiance : null;
  const policy = settings.policy || null;
  const heldRelativeVariance = DISOCCLUSION_POLICY_DEFAULTS.heldRelativeVariance;

  const diffuse = new Float32Array(pixelCount * 3);
  const specular = new Float32Array(pixelCount * 3);
  const accumulatedFrameCounts = new Float32Array(pixelCount);
  const shadingConfidence = new Uint8Array(pixelCount);

  let pixelsWithoutHistory = 0;
  let disoccludedPixelCount = 0;
  let convergingPixelCount = 0;
  let convergedPixelCount = 0;
  let filledFromUpsampleCount = 0;
  let filledFromNeighbourhoodCount = 0;
  let leftBlackPixelCount = 0;
  let spatialTapsAccepted = 0;
  let spatialTapsRejected = 0;
  let clampedPixelCount = 0;
  let residualFireflyPixelCount = 0;
  let confidenceSum = 0;

  for (let pixelY = 0; pixelY !== height; pixelY += 1) {
    for (let pixelX = 0; pixelX !== width; pixelX += 1) {
      const pixelIndex = pixelY * width + pixelX;
      const radianceOffset = pixelIndex * 3;

      const centreTexel = readTexel(pixelX, pixelY);
      const framesOfHistory = centreTexel ? Number(centreTexel.accumulatedFrameCount) || 0 : 0;
      const decision = resolveDisocclusionPolicy({
        framesOfHistory,
        historyRejected: !centreTexel,
        policy,
      });

      if (decision.state === DISOCCLUSION_STATE.disoccluded) disoccludedPixelCount += 1;
      else if (decision.state === DISOCCLUSION_STATE.converging) convergingPixelCount += 1;
      else convergedPixelCount += 1;

      let neighbourhood = null;
      if (decision.spatialSampleCount > 0) {
        neighbourhood = gatherDisocclusionNeighbourhood({
          pixelX,
          pixelY,
          width,
          height,
          readTexel,
          centreTexel,
          tapCount: decision.spatialSampleCount,
        });
        spatialTapsAccepted += neighbourhood.acceptedTapCount;
        spatialTapsRejected += neighbourhood.rejectedTapCount;
      }

      let resolvedDiffuse = BLACK_RADIANCE;
      let resolvedSpecular = BLACK_RADIANCE;

      if (!centreTexel) {
        pixelsWithoutHistory += 1;
        const fallbackRadiance = readUpsampledRadiance ? readUpsampledRadiance(pixelX, pixelY) : null;
        const hasNeighbourEvidence = neighbourhood !== null && neighbourhood.acceptedTapCount > 0;

        if (fallbackRadiance) {


          const neighbourDiffuseLuminance = hasNeighbourEvidence ? luminanceOf(neighbourhood.diffuse) : 0;
          const neighbourSpecularLuminance = hasNeighbourEvidence ? luminanceOf(neighbourhood.specular) : 0;
          const neighbourTotalLuminance = neighbourDiffuseLuminance + neighbourSpecularLuminance;
          const diffuseShare = neighbourTotalLuminance > 0
            ? neighbourDiffuseLuminance / neighbourTotalLuminance
            : DISOCCLUSION_FRAME_DEFAULTS.diffuseEnergyShareWithoutEvidence;

          const fallback = radianceOrBlack(fallbackRadiance);
          resolvedDiffuse = scaledRadiance(fallback, diffuseShare);
          resolvedSpecular = scaledRadiance(fallback, 1 - diffuseShare);
          filledFromUpsampleCount += 1;
        } else if (hasNeighbourEvidence) {
          resolvedDiffuse = radianceOrBlack(neighbourhood.diffuse);
          resolvedSpecular = radianceOrBlack(neighbourhood.specular);
          filledFromNeighbourhoodCount += 1;
        } else {
          leftBlackPixelCount += 1;
        }
      } else {
        const historyDiffuse = radianceOrBlack(centreTexel.diffuse);
        const historySpecular = radianceOrBlack(centreTexel.specular);
        const hasNeighbourEvidence = neighbourhood !== null && neighbourhood.acceptedTapCount > 0;

        if (hasNeighbourEvidence && decision.accumulatesInTonemappedSpace) {


          const historyWeight = 1 - decision.handlingStrength;
          resolvedDiffuse = accumulateInTonemappedSpace({
            current: neighbourhood.diffuse,
            history: historyDiffuse,
            historyWeight,
          });
          resolvedSpecular = accumulateInTonemappedSpace({
            current: neighbourhood.specular,
            history: historySpecular,
            historyWeight,
          });
        } else {
          resolvedDiffuse = historyDiffuse;
          resolvedSpecular = historySpecular;
        }
      }


      if (neighbourhood !== null && neighbourhood.acceptedTapCount > 0) {
        const totalRadiance = {
          r: resolvedDiffuse.r + resolvedSpecular.r,
          g: resolvedDiffuse.g + resolvedSpecular.g,
          b: resolvedDiffuse.b + resolvedSpecular.b,
        };
        const clamped = clampRadianceToNeighbourhood({
          radiance: totalRadiance,
          neighbourhoodMeanLuminance: neighbourhood.meanLuminance,
          neighbourCount: neighbourhood.acceptedTapCount,
          clampRatio: settings.clampRatio,
        });
        if (clamped.wasClamped) {
          resolvedDiffuse = scaledRadiance(resolvedDiffuse, clamped.appliedScale);
          resolvedSpecular = scaledRadiance(resolvedSpecular, clamped.appliedScale);
          clampedPixelCount += 1;
          if (luminanceOf(clamped.radiance) > clamped.allowedLuminance) residualFireflyPixelCount += 1;
        }
      }

      diffuse[radianceOffset] = resolvedDiffuse.r;
      diffuse[radianceOffset + 1] = resolvedDiffuse.g;
      diffuse[radianceOffset + 2] = resolvedDiffuse.b;
      specular[radianceOffset] = resolvedSpecular.r;
      specular[radianceOffset + 1] = resolvedSpecular.g;
      specular[radianceOffset + 2] = resolvedSpecular.b;
      accumulatedFrameCounts[pixelIndex] = framesOfHistory;


      const diffuseLuminance = luminanceOf(resolvedDiffuse);
      const specularLuminance = luminanceOf(resolvedSpecular);
      const diffuseSecondMoment = decision.holdsVarianceConstant || !centreTexel
        ? secondMomentForHeldRelativeVariance(diffuseLuminance, heldRelativeVariance)
        : centreTexel.diffuseSecondMoment;
      const specularSecondMoment = decision.holdsVarianceConstant || !centreTexel
        ? secondMomentForHeldRelativeVariance(specularLuminance, heldRelativeVariance)
        : centreTexel.specularSecondMoment;

      const diffuseConfidence = resolveShadingConfidence({
        framesOfHistory: decision.framesOfHistory,
        luminance: diffuseLuminance,
        secondMoment: diffuseSecondMoment,
      });
      const specularConfidence = resolveShadingConfidence({
        framesOfHistory: decision.framesOfHistory,
        luminance: specularLuminance,
        secondMoment: specularSecondMoment,
      });
      const confidence = Math.min(diffuseConfidence.confidence, specularConfidence.confidence);

      shadingConfidence[pixelIndex] = Math.round(confidence * 255);
      confidenceSum += confidence;
    }
  }

  const pixelsInsideWindow = disoccludedPixelCount + convergingPixelCount;
  return Object.freeze({
    resolved: true,
    refusal: DISOCCLUSION_FRAME_REFUSAL.none,
    width,
    height,
    diffuse,
    specular,
    accumulatedFrameCounts,
    shadingConfidence,
    stats: Object.freeze({
      pixelCount,
      pixelsWithHistory: pixelCount - pixelsWithoutHistory,
      pixelsWithoutHistory,
      disoccludedPixelCount,
      convergingPixelCount,
      convergedPixelCount,
      pixelsInsideWindow,
      filledFromUpsampleCount,
      filledFromNeighbourhoodCount,
      leftBlackPixelCount,
      spatialTapsAccepted,
      spatialTapsRejected,
      clampedPixelCount,
      clampedPixelRatio: clampedPixelCount / pixelCount,
      residualFireflyPixelCount,
      residualFireflyPixelRatio: residualFireflyPixelCount / pixelCount,
      meanConfidence: confidenceSum / pixelCount,
    }),
  });
}
