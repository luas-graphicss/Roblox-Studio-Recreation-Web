import { createSubstrateSmWarmupPlan } from '../../lighting/substrateSm/ssmWarmupPlanCore.js';
import { createSubstrateSmLifecycleResidency } from '../../lighting/substrateSm/ssmLifecycleResidency.js';
import { createSubstrateSmGlobalBudgetAdapter } from '../../lighting/substrateSm/ssmGlobalBudgetAdapter.js';
import { createSubstrateSmWarmupScheduler } from './ssmWarmupScheduler.js';
import { createSubstrateSmMaterialLifecycle } from './ssmMaterialLifecycle.js';
import { createSubstrateSmLifecycleScope } from './ssmLifecycleScope.js';

export function createSubstrateSmProgramWarmup({
  profile = 'Lite',
  canvas,
  contextGeneration = 0,
  projectGeneration = 0,
  now = () => performance.now(),
  onRestore = () => {},
  memoryLedger,
  planOptions = {},
  residencyOptions = {},
} = {}) {
  const plan = createSubstrateSmWarmupPlan({ ...planOptions, profile });
  const scheduler = createSubstrateSmWarmupScheduler({ plan, now });
  const residency = createSubstrateSmLifecycleResidency({ ...residencyOptions, profile, memoryLedger });
  const globalBudget = createSubstrateSmGlobalBudgetAdapter();
  const controllers = new Map();
  const retainedControllers = new Set();
  let disposed = false;
  const scope = createSubstrateSmLifecycleScope({
    canvas: canvas ?? new EventTarget(),
    contextGeneration,
    projectGeneration,
    onRestore,
  });

  function unregister(lifecycle) {
    const controller = controllers.get(lifecycle);
    if (!controller) return false;
    controller.dispose();
    if (controller.getState().retainedRetirements > 0) retainedControllers.add(controller);
    controllers.delete(lifecycle);
    scope.remove(lifecycle);
    return true;
  }

  function register({ material, adapter, enabled = false } = {}) {
    if (disposed) return null;
    const generations = scope.getState();
    const controller = createSubstrateSmMaterialLifecycle({
      scheduler,
      residency,
      adapter,
      enabled,
      now,
      contextGeneration: generations.contextGeneration,
      projectGeneration: generations.projectGeneration,
    });
    const lifecycle = Object.freeze({ ...controller, dispose: () => unregister(lifecycle) });
    controllers.set(lifecycle, controller);
    try {
      if (!scope.add(lifecycle, material)) throw new Error('SSM_WARMUP_SCOPE_REGISTRATION_FAILED');
      return lifecycle;
    } catch (error) {
      unregister(lifecycle);
      throw error;
    }
  }

  function processSlice(frame) {
    if (disposed) return 0;
    return scheduler.advanceFrame(frame);
  }

  function applyHostBudgetDecision(input) {
    if (disposed) return null;
    const decision = globalBudget.applyHostDecision(input);
    if (decision?.changed)
      for (const lifecycle of controllers.keys()) lifecycle.applyBudgetDecision(decision);
    return decision;
  }

  function resetProject(nextProjectGeneration) {
    if (disposed) return false;
    const changed = scope.resetProject(nextProjectGeneration);
    globalBudget.resetForExplicitRequest();
    return changed;
  }

  function retryRetiredResources() {
    for (const controller of retainedControllers) {
      if (controller.retryRetiredResources()) retainedControllers.delete(controller);
    }
    return retainedControllers.size === 0;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scope.dispose();
    scheduler.dispose();
  }

  function getState() {
    return Object.freeze({
      disposed,
      controllerCount: controllers.size,
      retainedControllers: retainedControllers.size,
      scheduler: scheduler.readStatistics(),
      residency: residency.readStatistics(),
      scope: scope.getState(),
      budget: globalBudget.getState(),
    });
  }

  return Object.freeze({
    register,
    unregister,
    processSlice,
    applyHostBudgetDecision,
    resetProject,
    retryRetiredResources,
    dispose,
    getState,
  });
}
