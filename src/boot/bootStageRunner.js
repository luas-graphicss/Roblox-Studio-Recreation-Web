import { BOOT_STAGES, createBootProgressTracker } from './bootStageModel.js';
import { yieldToBrowserPaint } from './browserPaint.js';
export { yieldToBrowserPaint } from './browserPaint.js';

export const BOOT_STAGE_STATUS = Object.freeze({
  DONE: 'done', SKIPPED: 'skipped', FAILED: 'failed', TIMED_OUT: 'timed-out',
});
const DEADLINE_REACHED = Symbol('boot-stage-deadline-reached');

function notify(listener, payload) {
  if (typeof listener !== 'function') return;
  try { listener(payload); } catch {                                            }
}

async function runSingleStage(stage, action, context, onStageError) {
  if (typeof action !== 'function') {
    return Object.freeze({ stageId: stage.id, status: BOOT_STAGE_STATUS.SKIPPED });
  }
  let deadlineTimer = null;
  try {
    const pending = Promise.resolve().then(() => action(context));
    const outcome = stage.deadlineMs > 0
      ? await Promise.race([
          pending,
          new Promise((resolve) => {
            deadlineTimer = setTimeout(() => resolve(DEADLINE_REACHED), stage.deadlineMs);
          }),
        ])
      : await pending;
    if (outcome === DEADLINE_REACHED) {
      const error = new Error(`Loading stage "${stage.id}" exceeded ${stage.deadlineMs}ms.`);
      const result = Object.freeze({ stageId: stage.id, status: BOOT_STAGE_STATUS.TIMED_OUT, error });
      notify(onStageError, result);
      return result;
    }
    return Object.freeze({ stageId: stage.id, status: BOOT_STAGE_STATUS.DONE });
  } catch (error) {
    const result = Object.freeze({ stageId: stage.id, status: BOOT_STAGE_STATUS.FAILED, error });
    notify(onStageError, result);
    return result;
  } finally {
    clearTimeout(deadlineTimer);
  }
}

export async function runBootStages({
  stages = BOOT_STAGES,
  actions = {},
  onStageChange,
  onStageError,
  waitForPaint = yieldToBrowserPaint,
  stopOnFailure = false,
} = {}) {
  const tracker = createBootProgressTracker(stages);
  const stageResults = [];
  for (const stage of tracker.stages) {
    const controller = new AbortController();
    let acceptsProgress = true;
    const context = Object.freeze({
      signal: controller.signal,
      waitForPaint,
      reportProgress(fraction) {
        if (!acceptsProgress || controller.signal.aborted) return;
        notify(onStageChange, tracker.advance(stage.id, fraction));
      },
    });
    notify(onStageChange, tracker.begin(stage.id));
    await waitForPaint({ signal: controller.signal });
    const result = await runSingleStage(stage, actions[stage.id], context, onStageError);
    acceptsProgress = false;
    stageResults.push(result);
    if (result.status !== BOOT_STAGE_STATUS.DONE) {
      controller.abort(result.error || new Error(`Loading stage "${stage.id}" was skipped.`));
      if (stopOnFailure) break;
    }
    notify(onStageChange, tracker.complete(stage.id));
  }
  return Object.freeze({ snapshot: tracker.snapshot(), stageResults });
}
