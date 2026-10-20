import { bus } from '../core/eventBus.js';
import { store } from '../core/state.js';
import { flushWarmupTask } from './deferredWarmupQueue.js';
import { DEFERRED_WARMUP_TASK_IDS } from './deferredWarmupTasks.js';
import { warmUpRenderEngine } from './engineWarmup.js';

export function startProjectOpenWarmupTrigger({ onWarmupError } = {}) {
  return bus.on('project:loaded', (event) => {
    (async () => {


      await Promise.resolve();
      if (event?.source === 'new' && store.get('appMode') !== 'EDITOR') return;
      await flushWarmupTask(DEFERRED_WARMUP_TASK_IDS.STUDIO_PANELS, { onWarmupError });
      await warmUpRenderEngine();
    })().catch((error) => onWarmupError?.({ taskId: 'project-graphics', error }));
  });
}
