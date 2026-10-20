import * as contract from "../mlPipelineContract.js";
import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { registerPass } from "../mlPassGraph.js";
import { createTraceTilePass, TRACE_TILE_OWNER, TRACE_TILE_PASS_NAME } from "../mlTraceTileGlue.js";

export const PHASE_ID = "ML-F13";

const TRACE_TILES_FLAG = "MegaLightsTraceTiles";


const TRACE_TILES_TIER_DEFAULTS = { fraco: false, medio: true, forte: true };


const DEFAULT_TIER_NAME = "medio";

function tierOfFrame(frameContext) {
  const tierName = frameContext && frameContext.tier;
  return typeof tierName === "string" && tierName ? tierName : DEFAULT_TIER_NAME;
}

function renderResolutionOfBench(bench) {
  const canvas = bench && bench.renderer && bench.renderer.domElement;
  if (!canvas) return { width: 0, height: 0 };
  return { width: Number(canvas.width) || 0, height: Number(canvas.height) || 0 };
}


function traceRequestSourceOf(frameContextOwner) {
  const lightSampleGeneration = frameContextOwner && frameContextOwner.lightSampleGeneration;
  if (lightSampleGeneration && typeof lightSampleGeneration.readTraceRequests === "function") {
    return lightSampleGeneration;
  }
  return null;
}

export function installPhase(installContext) {
  const context = installContext || {};
  const bench = context.bench || null;
  const telemetry = context.mlQa || null;
  const three = context.THREE || null;





  registerFlag({
    id: TRACE_TILES_FLAG,
    phase: PHASE_ID,
    description:
      "classifies each 16x16 trace tile (empty / screen / shadow map / ray / mixed), " +
      "compacts the tile list with a two level prefix sum and measures the granularity waste",
    defaultsByTier: TRACE_TILES_TIER_DEFAULTS,
  });

  const traceTilePass = createTraceTilePass({
    THREE: three,
    telemetry,
    requestSource: traceRequestSourceOf(bench),
    renderResolution: () => renderResolutionOfBench(bench),
    tileSize: contract.MGL_TRACE_TILE_SIZE,
  });

  registerPass(TRACE_TILE_PASS_NAME, {
    owner: TRACE_TILE_OWNER,


    isEnabled(frameContext) {
      return isFlagActive(TRACE_TILES_FLAG, tierOfFrame(frameContext));
    },
    execute(frameContext) {
      return traceTilePass.execute(frameContext);
    },
  });

  if (telemetry && typeof telemetry.textureUnit === "function") {


    telemetry.textureUnit(PHASE_ID + ":traceTileList", 0);
  }

  if (telemetry && typeof telemetry.phase === "function") {
    telemetry.phase(PHASE_ID, {
      implemented: true,
      flag: TRACE_TILES_FLAG,
      pass: TRACE_TILE_PASS_NAME,
      tileSize: contract.MGL_TRACE_TILE_SIZE,
      buffer: "traceTileList",
      patchSlots: 0,
      lightingTextureUnits: 0,
      compaction: "two level prefix sum (no wave ops, no atomics)",
      dispatchSubstitute: "scissor rect + stencil bit per tracer",
      pendingDependencies: contract.MGL_PASS_OWNER && contract.MGL_PASS_OWNER.lightSampleGeneration
        ? "trace requests come from ML-F11 (lightSampleGeneration)"
        : null,
    });
  }

  if (typeof window !== "undefined") {
    window.__mlLab = window.__mlLab || {};
    window.__mlLab.traceTiles = {
      owner: PHASE_ID,
      flag: TRACE_TILES_FLAG,
      handle: () => traceTilePass.handle(),
      inspect: () => traceTilePass.inspect(),
      planFor: (tracer) => traceTilePass.handle().planFor(tracer),
      ledger: () => traceTilePass.handle().ledger.summary(),
    };
  }

  return {
    phaseId: PHASE_ID,
    flag: TRACE_TILES_FLAG,
    pass: TRACE_TILE_PASS_NAME,
    dispose: () => traceTilePass.dispose(),
  };
}

export default { PHASE_ID, installPhase };
