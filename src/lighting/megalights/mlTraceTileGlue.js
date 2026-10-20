import {
  createTraceTileClassifier,
  traceTileGridFor,
  TRACE_STAGE_ORDER,
  TRACE_TILE_CLASS_INDEX,
} from "./mlTraceTileClassifyCore.js";
import {
  compactFlaggedItems,
  compactSurvivorLanes,
  createCompactionLedger,
} from "./mlTraceCompactionCore.js";
import {
  packTraceTileList,
  traceTileListMemoryReport,
  traceTileListTextureSize,
  TRACE_TILE_LIST_CHANNEL_ORDER,
  TRACE_TILE_LIST_ROW_WIDTH,
} from "./mlTraceTileListPackingCore.js";
import { planCompactedLanePass, planTracerPass } from "./mlTraceScissorPlanCore.js";
import { compareGranularityWaste, measureGranularityWaste } from "./mlTraceGranularityWasteCore.js";

export const TRACE_TILE_OWNER = "ML-F13";
export const TRACE_TILE_PASS_NAME = "traceTiles";
export const TRACE_TILE_REFUSAL_TRACE_BEFORE_CLASSIFICATION = "traceTiles.noTraceBeforeClassification";

const NO_REQUEST_SOURCE_REASON = "no trace requests: ML-F11 lightSampleGeneration is still a stub";


export function createTraceTilePass(dependencies) {
  const settings = dependencies || {};
  const three = settings.THREE || null;
  const telemetry = settings.telemetry || null;
  const injectedRequestSource = settings.requestSource || null;
  const compactedLaneRowWidth = Math.max(
    1,
    Math.floor(Number(settings.compactedLaneRowWidth) || TRACE_TILE_LIST_ROW_WIDTH),
  );

  const compactionLedger = createCompactionLedger();

  let classifier = null;
  let classifierGridKey = "";
  let currentGrid = null;
  let currentDownsampleFactor = 1;
  let compactedTiles = [];
  let classifiedThisFrame = false;
  let listTexture = null;
  let listTextureWidth = 0;
  let listTextureHeight = 0;
  let lastReport = { ready: false, reason: "the pass has not run yet" };

  function reportRefusal(reason, context) {
    if (telemetry && typeof telemetry.error === "function") {
      telemetry.error(TRACE_TILE_REFUSAL_TRACE_BEFORE_CLASSIFICATION + ": " + reason, TRACE_TILE_OWNER + "." + context);
    }
    return {
      refused: true,
      refusal: TRACE_TILE_REFUSAL_TRACE_BEFORE_CLASSIFICATION,
      reason,
    };
  }

  function configuredRenderResolution() {
    const configured =
      typeof settings.renderResolution === "function" ? settings.renderResolution() : settings.renderResolution;
    return configured || null;
  }

  function renderResolutionOf(frameContext) {
    const fromFrame = frameContext && frameContext.renderResolution;
    if (fromFrame && Number(fromFrame.width) > 0 && Number(fromFrame.height) > 0) return fromFrame;
    const configured = configuredRenderResolution();
    if (configured && Number(configured.width) > 0 && Number(configured.height) > 0) return configured;
    return { width: 0, height: 0 };
  }

  function downsampleFactorOf(frameContext) {
    const fromFrame = Math.floor(Number(frameContext && frameContext.downsampleFactor) || 0);
    if (fromFrame >= 1) return fromFrame;
    const fromSettings = Math.floor(Number(settings.downsampleFactor) || 0);
    if (fromSettings >= 1) return fromSettings;
    return 1;
  }

  function readTraceRequests(frameContext) {
    const fromFrame = frameContext && frameContext.lightSampleGeneration;
    if (fromFrame && typeof fromFrame.readTraceRequests === "function") {
      const answer = fromFrame.readTraceRequests() || {};
      return {
        requests: Array.isArray(answer.requests) ? answer.requests : [],
        renderResolution: answer.renderResolution || null,
        source: "ML-F11 lightSampleGeneration",
      };
    }
    if (injectedRequestSource && typeof injectedRequestSource.readTraceRequests === "function") {
      const answer = injectedRequestSource.readTraceRequests() || {};
      return {
        requests: Array.isArray(answer.requests) ? answer.requests : [],
        renderResolution: answer.renderResolution || null,
        source: "injected request source",
      };
    }
    return { requests: [], renderResolution: null, source: NO_REQUEST_SOURCE_REASON };
  }

  function classifierFor(grid) {
    const gridKey = grid.tileCountX + "x" + grid.tileCountY + "@" + grid.tileSize;
    if (classifier && classifierGridKey === gridKey) {
      classifier.reset();
      return classifier;
    }
    classifier = createTraceTileClassifier(grid);
    classifierGridKey = gridKey;
    return classifier;
  }

  function uploadTileListTexture(packed) {
    if (!three || typeof three.DataTexture !== "function") {
      return { texture: null, uploaded: false, reallocated: false, reason: "no three in the pass" };
    }

    const sizeChanged = !listTexture || listTextureWidth !== packed.width || listTextureHeight !== packed.height;
    if (sizeChanged) {
      if (listTexture && typeof listTexture.dispose === "function") listTexture.dispose();
      listTexture = new three.DataTexture(packed.data, packed.width, packed.height, three.RGBAFormat, three.FloatType);
      listTexture.minFilter = three.NearestFilter;
      listTexture.magFilter = three.NearestFilter;
      listTexture.generateMipmaps = false;
      listTextureWidth = packed.width;
      listTextureHeight = packed.height;
    } else {
      listTexture.image.data = packed.data;
    }
    listTexture.needsUpdate = true;
    return { texture: listTexture, uploaded: true, reallocated: sizeChanged, reason: null };
  }


  function planFor(tracer) {
    if (!classifiedThisFrame) {
      return reportRefusal('planFor("' + tracer + '") ran before the frame was classified and compacted', "planFor");
    }
    const plan = planTracerPass({
      tiles: compactedTiles,
      tracer,
      tileSize: currentGrid ? currentGrid.tileSize : undefined,
      downsampleFactor: currentDownsampleFactor,
    });
    return Object.assign({ refused: false }, plan, {
      waste: measureGranularityWaste(Object.assign({ label: tracer }, plan)),
    });
  }


  function compactSurvivors(input) {
    const stage = String((input && input.stage) || "?");
    if (!classifiedThisFrame) {
      return reportRefusal('compactSurvivors("' + stage + '") ran before the frame was classified', "compactSurvivors");
    }

    const compaction = compactSurvivorLanes({
      lanes: (input && input.lanes) || [],
      rowWidth: compactedLaneRowWidth,
      isSurvivor: input && input.isSurvivor,
    });
    const stageRecord = compactionLedger.record({
      stage,
      inputCount: compaction.inputCount,
      survivorCount: compaction.survivorCount,
    });
    const plan = planCompactedLanePass({
      tracer: (input && input.nextTracer) || null,
      survivorLaneCount: compaction.survivorCount,
      rowWidth: compactedLaneRowWidth,
    });

    return {
      refused: false,
      stage,
      survivors: compaction.survivors,
      inputCount: compaction.inputCount,
      survivorCount: compaction.survivorCount,
      resolvedCount: compaction.resolvedCount,
      unclassifiedCount: compaction.unclassifiedCount,
      record: stageRecord,
      plan,
      waste: measureGranularityWaste(Object.assign({ label: stage + " (compacted)" }, plan)),
    };
  }


  const traceTileHandle = {
    owner: TRACE_TILE_OWNER,
    passName: TRACE_TILE_PASS_NAME,
    ready: false,
    grid: null,
    tileList: [],
    tileListTexture: null,
    tileListChannelOrder: TRACE_TILE_LIST_CHANNEL_ORDER,
    tileSize: 0,
    statistics: null,
    ledger: compactionLedger,
    granularity: null,
    planFor,
    compactSurvivors,
  };

  function publishNotReady(frameContext, reason, requestSource) {
    classifiedThisFrame = false;
    compactedTiles = [];
    traceTileHandle.ready = false;
    traceTileHandle.grid = null;
    traceTileHandle.tileList = [];
    traceTileHandle.statistics = null;
    traceTileHandle.granularity = null;
    lastReport = { ready: false, reason, requestSource };
    if (telemetry && typeof telemetry.phase === "function") {
      telemetry.phase(TRACE_TILE_OWNER, { implemented: true, ready: false, reason, requestSource });
    }
    if (frameContext) frameContext.traceTiles = traceTileHandle;
    return frameContext;
  }

  function execute(frameContext) {
    classifiedThisFrame = false;

    const requests = readTraceRequests(frameContext);
    const resolution = requests.renderResolution && Number(requests.renderResolution.width) > 0
      ? requests.renderResolution
      : renderResolutionOf(frameContext);
    const grid = traceTileGridFor(resolution, settings.tileSize);

    if (grid.tileCount === 0) {


      return publishNotReady(frameContext, "no render resolution: the tile grid is empty", requests.source);
    }

    currentGrid = grid;
    currentDownsampleFactor = downsampleFactorOf(frameContext);

    const frameClassifier = classifierFor(grid);
    frameClassifier.addRequests(requests.requests);
    const classification = frameClassifier.classify();


    const tileFlags = new Int32Array(grid.tileCount);
    for (let tileIndex = 0; tileIndex < grid.tileCount; tileIndex++) {
      tileFlags[tileIndex] = classification.tileClassIndex[tileIndex] === TRACE_TILE_CLASS_INDEX.empty ? 0 : 1;
    }

    const compaction = compactFlaggedItems({
      flags: tileFlags,
      rowWidth: grid.tileCountX,
      build: (tileIndex) => frameClassifier.tileRecordAt(tileIndex),
    });
    compactedTiles = compaction.items;

    const packed = packTraceTileList(
      compactedTiles,
      traceTileListTextureSize(compactedTiles.length, TRACE_TILE_LIST_ROW_WIDTH),
    );
    const upload = uploadTileListTexture(packed);

    compactionLedger.begin(classification.statistics.acceptedRequestCount);


    const screenStagePlan = planTracerPass({
      tiles: compactedTiles,
      tracer: TRACE_STAGE_ORDER[0],
      tileSize: grid.tileSize,
      downsampleFactor: currentDownsampleFactor,
    });
    const granularity = compareGranularityWaste(
      Object.assign({ label: "tile plan: " + TRACE_STAGE_ORDER[0] }, screenStagePlan),
      planCompactedLanePass({
        tracer: TRACE_STAGE_ORDER[0],
        survivorLaneCount: screenStagePlan.neededLaneCount,
        rowWidth: compactedLaneRowWidth,
      }),
    );

    traceTileHandle.ready = true;
    traceTileHandle.grid = grid;
    traceTileHandle.tileSize = grid.tileSize;
    traceTileHandle.tileList = compactedTiles;
    traceTileHandle.tileListTexture = upload.texture;
    traceTileHandle.statistics = classification.statistics;
    traceTileHandle.granularity = granularity;

    classifiedThisFrame = true;

    lastReport = {
      ready: true,
      requestSource: requests.source,
      requestCount: classification.statistics.requestCount,
      acceptedRequestCount: classification.statistics.acceptedRequestCount,
      refusedOutsideGridCount: classification.statistics.refusedOutsideGridCount,
      refusedUnknownTracerCount: classification.statistics.refusedUnknownTracerCount,
      tileSize: grid.tileSize,
      tileCountX: grid.tileCountX,
      tileCountY: grid.tileCountY,
      tileCount: grid.tileCount,
      emptyTileCount: classification.statistics.emptyTileCount,
      emptyTileRatio: classification.statistics.emptyTileRatio,
      skippedEmptyTileCount: grid.tileCount - compactedTiles.length,
      occupiedTileCount: classification.statistics.occupiedTileCount,
      screenOnlyTileCount: classification.statistics.screenOnlyTileCount,
      virtualShadowMapTileCount: classification.statistics.virtualShadowMapTileCount,
      rayTraceTileCount: classification.statistics.rayTraceTileCount,
      mixedTileCount: classification.statistics.mixedTileCount,
      compactedTileCount: compactedTiles.length,
      droppedTileCount: packed.droppedTileCount,
      listTextureWidth: packed.width,
      listTextureHeight: packed.height,
      listMemory: traceTileListMemoryReport(packed),
      textureUploaded: upload.uploaded,
      textureReallocated: upload.reallocated,
      textureSkippedReason: upload.reason,
      tilePlanRasterizedLaneCount: granularity.before.rasterizedLaneCount,
      tilePlanNeededLaneCount: granularity.before.neededLaneCount,
      tilePlanWasteRatio: granularity.before.wasteRatio,
      tilePlanVerdict: granularity.before.verdict,
      compactedPlanWasteRatio: granularity.after.wasteRatio,
      compactedPlanVerdict: granularity.after.verdict,
      lanesRemovedByCompaction: granularity.rasterizedLaneCountRemoved,
    };

    if (telemetry && typeof telemetry.phase === "function") {
      telemetry.phase(TRACE_TILE_OWNER, Object.assign({ implemented: true }, lastReport));
    }
    if (telemetry && typeof telemetry.uniform === "function") {
      telemetry.uniform("uMglTraceTileSize", grid.tileSize);
    }

    if (frameContext) frameContext.traceTiles = traceTileHandle;
    return frameContext;
  }

  function dispose() {
    if (listTexture && typeof listTexture.dispose === "function") listTexture.dispose();
    listTexture = null;
    listTextureWidth = 0;
    listTextureHeight = 0;
    classifier = null;
    classifierGridKey = "";
    compactedTiles = [];
    classifiedThisFrame = false;
    traceTileHandle.ready = false;
    traceTileHandle.tileListTexture = null;
    traceTileHandle.tileList = [];
    compactionLedger.reset();
  }

  return {
    execute,
    handle: () => traceTileHandle,
    inspect: () => ({
      owner: TRACE_TILE_OWNER,
      passName: TRACE_TILE_PASS_NAME,
      lightingTextureUnits: 0,
      report: lastReport,
      ledger: compactionLedger.summary(),
    }),
    dispose,
  };
}
