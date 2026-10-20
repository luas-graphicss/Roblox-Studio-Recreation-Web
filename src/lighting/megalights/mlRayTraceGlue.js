import {
  RAY_TRACE_PASS_NAME,
  RAY_TRACE_REFUSAL_CODES,
  describeRayPolicy,
  isRayTraceAllowedForTier,
  raysPerPixelForTier,
  resolveSampleWithRayTrace,
} from "./mlRayTraceCore.js";
import { createRayBudget } from "./mlRayTraceBudgetCore.js";
import {
  BVH_TEXTURE_RESIDUALS,
  createBvhTexturePayload,
  describeBvhTexture,
} from "./mlBvhTextureLayoutCore.js";
import {
  bvhTraversalBindingsForLightingShader,
  buildBvhTraversalProbeFragmentShader,
  describeBvhTraversalGlsl,
} from "./mlBvhTraversalGlsl.js";

export const PHASE_ID = "ML-F16";
export const RAY_TRACE_TEXTURE_UNIT_KEY = "ML-F16:bvh";

export const RAY_TRACE_PASS_STATUS = Object.freeze({
  ready: "ready",
  disabledByTier: "disabledByTier",
  waitingForPackedBvh: "waitingForPackedBvh",
  refusedPackedBvh: "refusedPackedBvh",
  waitingForLightSamples: "waitingForLightSamples",
});

function wholeCount(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}


export function createRayTracePass(dependencies) {
  const three = (dependencies && dependencies.THREE) || null;
  const telemetry = (dependencies && dependencies.telemetry) || null;
  const uniformNames = bvhTraversalBindingsForLightingShader();

  let lastStatus = RAY_TRACE_PASS_STATUS.waitingForPackedBvh;
  let lastReason = "the pass has not run yet";
  let packedBvhRevision = null;
  let payload = null;
  let bvhTexture = null;
  let executionCount = 0;
  let currentBudget = null;
  let currentTierName = "";

  const rayStatistics = {
    sampleCount: 0,
    resolvedCount: 0,
    unknownCount: 0,
    raysSpent: 0,
    nodeVisitCount: 0,
    triangleTestCount: 0,
  };

  function report(status, reason) {
    lastStatus = status;
    lastReason = reason;
  }

  function releaseTexture() {
    if (bvhTexture && typeof bvhTexture.dispose === "function") bvhTexture.dispose();
    bvhTexture = null;
  }

  function uploadTexture() {
    releaseTexture();
    if (!three || !payload || !payload.ok) return null;


    const texture = new three.DataTexture(
      payload.data,
      payload.layout.width,
      payload.layout.usedRowCount,
      three.RGBAFormat,
      three.FloatType,
    );
    texture.minFilter = three.NearestFilter;
    texture.magFilter = three.NearestFilter;
    texture.wrapS = three.ClampToEdgeWrapping;
    texture.wrapT = three.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    bvhTexture = texture;
    return texture;
  }

  function packIfRevisionChanged(packedBvh) {
    const revision = packedBvh.revision === undefined ? null : packedBvh.revision;
    if (payload && revision !== null && revision === packedBvhRevision) return payload;

    payload = createBvhTexturePayload({
      layoutName: packedBvh.layoutName,
      nodesF32: packedBvh.nodesF32,
      trianglesF32: packedBvh.trianglesF32,
      nodeCount: packedBvh.nodeCount,
      triangleCount: packedBvh.triangleCount,
    });
    packedBvhRevision = revision;
    if (payload.ok) uploadTexture();
    else releaseTexture();
    return payload;
  }





  function resolveSample(sample, options) {
    const resolution = resolveSampleWithRayTrace({
      sample,
      payload,
      tierName: currentTierName,
      budget: currentBudget,
      biasStuds: options ? options.biasStuds : undefined,
      maximumNodeVisits: options ? options.maximumNodeVisits : undefined,
    });
    rayStatistics.sampleCount++;
    rayStatistics.raysSpent += resolution.raysSpent;
    if (resolution.resolved) rayStatistics.resolvedCount++;
    else rayStatistics.unknownCount++;
    if (resolution.statistics) {
      rayStatistics.nodeVisitCount += resolution.statistics.nodeVisitCount;
      rayStatistics.triangleTestCount += resolution.statistics.triangleTestCount;
    }
    return resolution;
  }

  function publishHandle(frameContext, extra) {
    frameContext.rayTrace = Object.assign(
      {
        owner: PHASE_ID,
        pass: RAY_TRACE_PASS_NAME,
        ready: false,
        status: lastStatus,
        reason: lastReason,
        tierName: currentTierName,
        raysPerPixel: raysPerPixelForTier(currentTierName),


        resolveSample,
        bvhTexture,
        bvhTextureUniform: uniformNames.bvhNodesSampler,
        traversalGlsl: describeBvhTraversalGlsl(),
        probeFragmentShader: buildBvhTraversalProbeFragmentShader,
      },
      extra || {},
    );
    return frameContext;
  }

  return {
    owner: PHASE_ID,

    execute(frameContext) {
      const frame = frameContext || {};
      executionCount++;
      currentTierName = frame.tier || "medio";
      const raysPerPixel = raysPerPixelForTier(currentTierName);
      if (telemetry) telemetry.uniform(uniformNames.raysPerPixel, raysPerPixel);

      if (!isRayTraceAllowedForTier(currentTierName)) {
        currentBudget = null;
        report(
          RAY_TRACE_PASS_STATUS.disabledByTier,
          RAY_TRACE_REFUSAL_CODES[0] + ": tier " + currentTierName + " traces no rays",
        );
        return publishHandle(frame);
      }

      const packedBvh = frame.packedBvh || null;
      if (!packedBvh) {
        currentBudget = null;
        report(
          RAY_TRACE_PASS_STATUS.waitingForPackedBvh,
          "no packed BVH on the frame: the engine bvhCore owns packBvhForGpu and this phase must never build a second BVH",
        );
        return publishHandle(frame);
      }

      const packed = packIfRevisionChanged(packedBvh);
      if (!packed || !packed.ok) {
        currentBudget = null;
        const problems = packed && packed.problems ? packed.problems.join("; ") : "unknown problem";
        report(RAY_TRACE_PASS_STATUS.refusedPackedBvh, "the packed BVH was refused instead of truncated: " + problems);
        if (telemetry) telemetry.error(lastReason, PHASE_ID + ".execute");
        return publishHandle(frame);
      }

      if (telemetry) telemetry.uniform(uniformNames.bvhNodeCount, payload.layout.nodeCount);


      const sampleCount = wholeCount(frame.sampleCount) || wholeCount(frame.pixelCount);
      currentBudget = createRayBudget({ tierName: currentTierName, pixelCount: sampleCount });

      const lightSamples = frame.lightSamples || null;
      if (!lightSamples || !lightSamples.ready) {
        report(
          RAY_TRACE_PASS_STATUS.waitingForLightSamples,
          "ML-F11 has not produced light samples, so there is no sample to promote to a ray",
        );
        return publishHandle(frame);
      }

      report(RAY_TRACE_PASS_STATUS.ready, "");
      return publishHandle(frame, { ready: true });
    },

    resolveSample,

    inspect() {
      return {
        owner: PHASE_ID,
        pass: RAY_TRACE_PASS_NAME,
        executionCount,
        status: lastStatus,
        reason: lastReason,
        policy: describeRayPolicy(),
        budget: currentBudget ? currentBudget.statistics() : null,
        rays: Object.assign({}, rayStatistics),
        bvhTexture: describeBvhTexture(payload),
        textureUnitKey: RAY_TRACE_TEXTURE_UNIT_KEY,


        lightingTextureUnits: 0,
        textureUploadAvailable: !!three,
        residuals: BVH_TEXTURE_RESIDUALS,
        traversalGlsl: describeBvhTraversalGlsl(),
      };
    },

    dispose() {
      releaseTexture();
      payload = null;
      packedBvhRevision = null;
      currentBudget = null;
    },
  };
}
