import { startLogger, logger } from "./logger.js";
import { bus } from "./eventBus.js";
import { enforceTopLevelBrowsingContext } from "./frameGuard.js";           
import { getSharedLoadingScreen } from "../boot/sharedLoadingScreen.js";
import { createBootStageActions } from "../boot/bootStageActions.js";
import { runBootStages, BOOT_STAGE_STATUS } from "../boot/bootStageRunner.js";
import { BOOT_STAGE_IDS } from "../boot/bootStageModel.js";
import { registerWarmupTasks } from "../boot/deferredWarmupQueue.js";
import { createDeferredWarmupTasks } from "../boot/deferredWarmupTasks.js";
import { startProjectOpenWarmupTrigger } from "../boot/projectOpenWarmupTrigger.js";


const REQUIRED_BOOT_STAGE_IDS = Object.freeze([
  ...Object.values(BOOT_STAGE_IDS),
]);

const BOOT_FAILURE_MESSAGE = "The studio could not finish loading.";

function findFailedRequiredStage(stageResults) {
  return stageResults.find(
    (result) =>
      REQUIRED_BOOT_STAGE_IDS.includes(result.stageId) &&
      result.status !== BOOT_STAGE_STATUS.DONE,
  );
}

function reportStageFailure(failure) {
  logger.error(
    `Boot stage "${failure.stageId}" ${failure.status}:`,
    failure.error,
  );
}

function reportWarmupFailure(failure) {
  logger.error(`Deferred warm-up "${failure.taskId}" failed:`, failure.error);
}

export async function boot() {
  startLogger("info");
  logger.info("Starting Roblox Studio Web\u2026");


  if (!enforceTopLevelBrowsingContext()) {
    logger.warn("Boot cancelled: the page is embedded in an untrusted frame.");
    return;
  }


  const loadingScreen = getSharedLoadingScreen();
  const { actions, getBootContext } = createBootStageActions();


  registerWarmupTasks(createDeferredWarmupTasks());
  startProjectOpenWarmupTrigger({ onWarmupError: reportWarmupFailure });

  const { snapshot, stageResults } = await runBootStages({
    actions,
    stopOnFailure: true,
    onStageChange: (stage) => loadingScreen.showStage(stage),
    onStageError: reportStageFailure,
  });

  const failedRequiredStage = findFailedRequiredStage(stageResults);
  if (failedRequiredStage) {


    logger.error(
      `Boot aborted: required stage "${failedRequiredStage.stageId}" did not complete.`,
    );
    loadingScreen.showFailure(BOOT_FAILURE_MESSAGE);
    return;
  }

  const { activeTheme, loadedSettings } = getBootContext();


  bus.emit("app:ready", { theme: activeTheme, settings: loadedSettings });

  await loadingScreen.hide();




  logger.info(
    `Application ready (${snapshot.completedStageCount}/${snapshot.stageCount} boot stages).`,
  );
}
