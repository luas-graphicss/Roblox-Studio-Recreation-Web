import { mlQa } from "./runtime/megaLightsTelemetry.js";


export const FRAME_STAGE_SLOT = Object.freeze({
  "ML-F22": 20,
  "ML-F23": 40,
  "ML-F24": 60,
});

const UNLISTED_OWNER_SLOT = 900;

const registeredStages = new Map();
const stagesDisabledByError = new Set();
const stageErrorMessages = new Map();

let lastPublishedSignature = "";

function trimmedTextOrEmpty(value) {
  return typeof value === "string" ? value.trim() : "";
}

function slotForStage(owner, explicitSlot) {
  const explicit = Number(explicitSlot);
  if (Number.isFinite(explicit)) return explicit;
  const ownerSlot = Number(FRAME_STAGE_SLOT[owner]);
  return Number.isFinite(ownerSlot) ? ownerSlot : UNLISTED_OWNER_SLOT;
}


let cachedStagesInRunOrder = null;

function invalidateRunOrderCache() {
  cachedStagesInRunOrder = null;
}

function stagesInRunOrder() {
  if (!cachedStagesInRunOrder) {
    cachedStagesInRunOrder = Array.from(registeredStages.values()).sort((left, right) => left.slot - right.slot);
  }
  return cachedStagesInRunOrder;
}

function disableStageAfterError(stage, error, whileDoing) {
  stagesDisabledByError.add(stage.stageName);
  stageErrorMessages.set(stage.stageName, whileDoing + ": " + ((error && error.message) || String(error)));
  mlQa.error(error, { frameStage: stage.stageName, owner: stage.owner, whileDoing });
}

function publishWhenChanged(report) {
  const signature = [
    report.executed.join(","),
    report.skipped.join(","),
    report.failed.join(","),
    registeredStages.size,
  ].join("|");
  if (signature === lastPublishedSignature) return;
  lastPublishedSignature = signature;
  mlQa.phase("base", {
    frameStages: {
      runsAfter: "mlPassGraph.executeGraph",
      registered: stagesInRunOrder().map((stage) => stage.stageName),
      executed: report.executed,
      skipped: report.skipped,
      failed: report.failed,
    },
  });
}










export function registerFrameStage(registration) {
  const request = registration || {};
  const stageName = trimmedTextOrEmpty(request.stageName);
  const owner = trimmedTextOrEmpty(request.owner);

  if (!stageName) throw new Error("registerFrameStage needs an explicit stageName");
  if (!owner) throw new Error('the frame stage "' + stageName + '" needs an owner phase id');
  if (typeof request.execute !== "function") {
    throw new Error('the frame stage "' + stageName + '" needs an execute(frameContext) function');
  }

  const slot = slotForStage(owner, request.slot);
  const collision = stagesInRunOrder().find(
    (stage) => stage.slot === slot && stage.stageName !== stageName,
  );
  if (collision) {
    throw new Error(
      'the frame stage "' + stageName + '" claims slot ' + slot + ', already taken by "' + collision.stageName +
        '". Two stages in one slot would run in module load order, so the table decides, never the imports.',
    );
  }

  registeredStages.set(stageName, {
    stageName,
    owner,
    slot,
    execute: request.execute,
    isEnabled: typeof request.isEnabled === "function" ? request.isEnabled : null,
  });
  stagesDisabledByError.delete(stageName);
  stageErrorMessages.delete(stageName);
  invalidateRunOrderCache();
  return { stageName, owner, slot };
}


export function restoreFrameStage(stageName) {
  const name = trimmedTextOrEmpty(stageName);
  const removed = registeredStages.delete(name);
  stagesDisabledByError.delete(name);
  stageErrorMessages.delete(name);
  invalidateRunOrderCache();
  return removed;
}

export function clearFrameStages() {
  registeredStages.clear();
  stagesDisabledByError.clear();
  stageErrorMessages.clear();
  invalidateRunOrderCache();
  lastPublishedSignature = "";
}


export function runFrameStages(frameContext) {
  const context = frameContext || {};
  const executed = [];
  const skipped = [];
  const failed = [];
  const stages = stagesInRunOrder();

  for (let index = 0; index !== stages.length; index += 1) {
    const stage = stages[index];

    if (stagesDisabledByError.has(stage.stageName)) {
      skipped.push(stage.stageName);
      continue;
    }

    let stageIsEnabled = true;
    if (stage.isEnabled) {
      try {
        stageIsEnabled = stage.isEnabled(context) !== false;
      } catch (error) {
        disableStageAfterError(stage, error, "isEnabled");
        failed.push(stage.stageName);
        continue;
      }
    }

    if (!stageIsEnabled) {
      skipped.push(stage.stageName);
      continue;
    }

    try {
      const returned = stage.execute(context);


      if (returned !== undefined && returned !== context) {
        mlQa.error(
          new Error('the frame stage "' + stage.stageName + '" returned a value instead of mutating the shared frame context'),
          { frameStage: stage.stageName, owner: stage.owner },
        );
      }
      executed.push(stage.stageName);
    } catch (error) {
      disableStageAfterError(stage, error, "execute");
      failed.push(stage.stageName);
    }
  }

  publishWhenChanged({ executed, skipped, failed });
  return { frameContext: context, executed, skipped, failed };
}

export function listFrameStages() {
  return stagesInRunOrder().map((stage) => ({
    stageName: stage.stageName,
    owner: stage.owner,
    slot: stage.slot,
    disabledByError: stagesDisabledByError.has(stage.stageName),
    lastError: stageErrorMessages.get(stage.stageName) || null,
  }));
}

export function frameStageCount() {
  return registeredStages.size;
}
