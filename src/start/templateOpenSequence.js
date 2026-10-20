import { runBootStages, yieldToBrowserPaint } from '../boot/bootStageRunner.js';
import { getSharedLoadingScreen } from '../boot/sharedLoadingScreen.js';
import { flushWarmupTask } from '../boot/deferredWarmupQueue.js';
import { DEFERRED_WARMUP_TASK_IDS } from '../boot/deferredWarmupTasks.js';
import { warmUpRenderEngine } from '../boot/engineWarmup.js';
import { TEMPLATE_OPEN_STAGES, TEMPLATE_OPEN_STAGE_IDS } from './templateOpenStages.js';

async function prepareStudioPanels(context) {
  const ready = await flushWarmupTask(DEFERRED_WARMUP_TASK_IDS.STUDIO_PANELS, context);
  if (!ready) throw new Error('The studio panels could not be initialized.');
}

export async function openTemplateInStages({
  clearPlace, buildTemplate, enterEditor, onStageError,
} = {}) {
  const loadingScreen = getSharedLoadingScreen();
  loadingScreen.show({ title: 'Loading template', label: TEMPLATE_OPEN_STAGES[0].label });
  await yieldToBrowserPaint();
  try {
    const result = await runBootStages({
      stages: TEMPLATE_OPEN_STAGES,
      stopOnFailure: true,
      actions: {
        [TEMPLATE_OPEN_STAGE_IDS.PREPARE_ENGINE]: prepareStudioPanels,
        [TEMPLATE_OPEN_STAGE_IDS.CLEAR_PLACE]: clearPlace,
        [TEMPLATE_OPEN_STAGE_IDS.BUILD_TEMPLATE]: buildTemplate,
        [TEMPLATE_OPEN_STAGE_IDS.ENTER_EDITOR]: enterEditor,


        [TEMPLATE_OPEN_STAGE_IDS.SETTLE_FIRST_FRAME]: warmUpRenderEngine,
      },
      onStageChange: (stage) => loadingScreen.showStage(stage),
      onStageError,
    });
    if (!result.snapshot.isComplete) {
      const failedStage = result.stageResults.at(-1);
      throw failedStage?.error || new Error('Template loading did not finish.');
    }
    await loadingScreen.hide();
    return result;
  } catch (error) {


    loadingScreen.showFailure('The template could not finish loading. Reload to try again.');
    throw error;
  }
}
