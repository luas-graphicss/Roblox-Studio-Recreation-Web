import { createMegaLightsSmSamplePass } from './megaLightsSm.js';
import { createMsmFrameTargets } from './msmFrameTargets.js';
import { createMsmDenoisePasses } from './msmDenoisePasses.js';
import { createMsmFrameInvalidation } from './msmFrameInvalidation.js';
import { createMsmMaterialHistoryInvalidation } from './msmMaterialHistoryInvalidation.js';
import { createMsmRuntimePerformance } from './msmRuntimePerformance.js';
import { createMsmProgramWarmup } from './msmProgramWarmup.js';
import { resolveMsmRuntimeBudget } from '../lighting/megalightsSm/msmRuntimeBudgetCore.js';
import { createConvergenceClock, MSM_CONVERGENCE_FRAMES_98 } from '../lighting/megalightsSm/msmConvergenceClockCore.js';
import { msmTemporalDecisionFor } from '../lighting/megalightsSm/msmTemporalCore.js';
import { MSM_HISTORY_ACTION } from '../lighting/megalightsSm/msmGridDirtyCore.js';
import { getMsmTierPolicy } from '../lighting/megalightsSm/msmTierPolicy.js';

export function createMegaLightsSmPipeline(dependencies) {
  const { THREE, renderer, camera, scene } = dependencies;
  const sample = createMegaLightsSmSamplePass(dependencies);
  const targets = createMsmFrameTargets({ THREE, renderer });
  const denoise = createMsmDenoisePasses(dependencies);
  const invalidation = createMsmFrameInvalidation();
  const performanceState = createMsmRuntimePerformance(dependencies);
  const warmup = createMsmProgramWarmup({ renderer, camera, sample, denoise, targets });
  let clock = createConvergenceClock();
  const invalidateMaterialHistory = createMsmMaterialHistoryInvalidation({
    targets, invalidation, getClock: () => clock, requestRender: dependencies.requestRender,
  });
  let state = null, sampleState = null, policy = null, pendingChange = null, budget = null;
  let enabled = false, reason = 'no-state', lastMode = 'A', clockFrames = MSM_CONVERGENCE_FRAMES_98;
  let skippedFrames = 0, lastAlpha = 1, options = {}, lightIdentity = '';

  function sleep(why) {
    enabled = false; reason = why;
    targets.invalidate(); invalidation.reset(); sample.applyState(null);
    performanceState.finishFrame();
    return false;
  }
  function contextLost() { warmup.contextLost(); sleep('context-lost'); }
  function contextRestored() {
    warmup.reset(); targets.invalidate(); invalidation.reset();
    clock.registerDirtyPulse({ reason: 'context-restored' });
    dependencies.requestRender?.();
  }
  renderer.domElement?.addEventListener('webglcontextlost', contextLost);
  renderer.domElement?.addEventListener('webglcontextrestored', contextRestored);

  function applyState(nextState) {
    state = nextState || null;
    const tierPolicy = state ? getMsmTierPolicy(state.tier) : null;
    if (!tierPolicy || !state.lights?.length) return sleep('no-eligible-local-lights');
    if (state.strength === 0) return sleep('zero-strength');
    if (renderer.getContext?.().isContextLost?.()) return sleep('context-lost');
    if (warmup.aborted()) return sleep('warmup-aborted');
    options = state.options || {};
    const quality = performanceState.beginFrame(state.tier, clock.state().frozen, !warmup.ready());
    policy = { ...tierPolicy, ...quality };
    if (!quality.isMsmEnabled) return sleep('governor-off');
    lastMode = state.mode === 'B' ? 'B' : 'A';
    camera.updateMatrixWorld();
    pendingChange = invalidation.inspect({ lights: state.lights, scene, camera,
      settingsKey: [state.tier, lastMode, state.strength, options.temporal, options.spatial,
        options.proxy, options.atlas, options.fairness, options.specular, options.screenTrace,
        JSON.stringify(quality)].join('|') });
    const nextIdentity = JSON.stringify(state.lights.map(light => light.lightKey).sort());
    if (pendingChange.reset || nextIdentity !== lightIdentity) targets.invalidate();
    lightIdentity = nextIdentity;
    if (Object.values(pendingChange).some(Boolean)) clock.registerDirtyPulse({ reason: 'scene-change' });
    sampleState = { ...state, quality, mode: lastMode,
      geometryDirty: pendingChange.reset || pendingChange.geometryChanged || pendingChange.cameraChanged };
    enabled = !warmup.ready() || performanceState.measureCpu('msm-cpu-feed', () => sample.applyState(sampleState));
    reason = enabled ? warmup.ready() ? '' : 'warming-up' : sample.sleepReason();
    if (!enabled) performanceState.finishFrame();
    return enabled;
  }

  function render(activeRenderer, width, height) {
    if (!enabled) return false;
    budget = resolveMsmRuntimeBudget({ width, height, preferredDivisor: policy.resolutionDivisor,
      fixedBytes: sample.residentTextureBytes(), webgl2: renderer.capabilities.isWebGL2 });
    if (!budget.fits) return sleep(budget.reason);
    if (!warmup.ready()) {
      warmup.tick(sampleState, budget);
      if (warmup.aborted()) return sleep('warmup-aborted');
      return true;
    }
    const resized = targets.ensure(budget.width, budget.height);
    const requiredFrames = Math.max(MSM_CONVERGENCE_FRAMES_98, budget.coverageCycleFrames);
    if (clockFrames !== requiredFrames) {
      clockFrames = requiredFrames;
      clock = createConvergenceClock({ freezeAfterCleanFrames: clockFrames });
    }
    if (resized) clock.registerDirtyPulse({ reason: 'resize' });
    const frameTargets = targets.frame(), clockState = clock.state();
    if (clockState.frozen && frameTargets.valid) { skippedFrames += 1; return true; }
    const savedTarget = activeRenderer.getRenderTarget();
    try {
      const rendered = performanceState.measure('msm-sample', () => sample.render(activeRenderer, width, height,
        { target: frameTargets.sample, budget, frame: clockState.frame }));
      if (!rendered) return sleep(sample.sleepReason());
      const dirty = pendingChange && (pendingChange.lightsChanged || pendingChange.geometryChanged);
      const decision = msmTemporalDecisionFor({
        historyAction: !frameTargets.valid ? MSM_HISTORY_ACTION.RESET : dirty ? MSM_HISTORY_ACTION.FAST_ALPHA : undefined,
        framesSinceDirtyPulse: clockState.framesSinceDirtyPulse, frozen: false,
      });
      lastAlpha = !frameTargets.valid || options.temporal === false ? 1 : decision.alpha;
      const spatial = options.spatial !== false && policy.spatialFilter !== 'off' && policy.spatialFilter !== 'OFF';
      denoise.render(activeRenderer, { targets: frameTargets, camera, sceneUniforms: sample.sceneUniforms(),
        alpha: lastAlpha, spatial, threshold: policy.spatialFilter === 'gated' ? 0.04 : 0,
        mode: lastMode, valid: frameTargets.valid && options.temporal !== false,
        measure: performanceState.measure, mipmapped: renderer.capabilities.isWebGL2 === true });
      targets.commit(spatial); clock.tick(); pendingChange = null; reason = '';
      return true;
    } catch (error) {
      return sleep('render-failed: ' + String(error?.message || error));
    } finally { activeRenderer.setRenderTarget(savedTarget); }
  }

  return {
    applyState, render, invalidateMaterialHistory, isEnabled: () => enabled, sleepReason: () => reason,
    irradianceTexture: () => enabled ? targets.history()?.texture || null : null,
    reducedSize: () => ({ width: budget?.width || 0, height: budget?.height || 0 }),
    sceneUniforms: sample.sceneUniforms, activeLightKeys: sample.activeLightKeys,
    previousViewProjection: denoise.previousViewProjection,
    qualitySettings: () => policy,
    measureComposite: work => performanceState.measure('msm-composite', work),
    endFrame: performanceState.finishFrame,
    isConverged: () => !enabled || (warmup.ready() && clock.state().frozen),
    describe: () => ({ ...sample.describe(), pipeline: 'P1 -> P2 -> P3', mode: lastMode,
      targetBudget: budget, history: targets.describe(), filters: denoise.describe(),
      alpha: lastAlpha, convergence: clock.state(), skippedFrames,
      warmup: warmup.describe(), governor: performanceState.describe(), sleepReason: reason }),
    dispose: () => {
      enabled = false;
      renderer.domElement?.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement?.removeEventListener('webglcontextrestored', contextRestored);
      warmup.dispose(); performanceState.dispose(); sample.dispose(); denoise.dispose(); targets.dispose();
    },
  };
}
