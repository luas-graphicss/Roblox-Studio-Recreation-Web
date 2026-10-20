import { createPassTiming } from './passTiming.js';
import { createMsmBudgetGovernor } from '../lighting/megalightsSm/msmBudgetGovernorCore.js';

export function createMsmRuntimePerformance({ renderer, getPassTiming, now = () => performance.now() }) {
  const governor = createMsmBudgetGovernor({ extraPassIds: ['msm-moments', 'msm-cpu-feed', 'msm-composite'] });
  let timing = null, ownedTiming = null, frameOpen = false, lastDecision = null;
  let collectMeasurements = false, consumedSampleCount = 0, observedSampleCount = 0;
  function finishFrame() {
    if (frameOpen && ownedTiming) ownedTiming.frameEnd();
    frameOpen = false;
  }
  function beginFrame(tier, idle, warming = false) {
    finishFrame();
    const shared = getPassTiming?.() || null;
    if (shared && ownedTiming) { ownedTiming.dispose(); ownedTiming = null; }
    const nextTiming = shared || (ownedTiming ||= createPassTiming({ renderer }));
    if (nextTiming !== timing) { consumedSampleCount = 0; observedSampleCount = 0; }
    timing = nextTiming;
    if (ownedTiming) ownedTiming.frameStart();
    frameOpen = true;
    collectMeasurements = !warming;
    const currentState = governor.getState();
    if (!currentState.tier) governor.reset({ tier });
    const changingTier = !!currentState.tier && currentState.tier !== tier;
    const ledger = timing.getLedger();
    const sampleCount = ledger.passes.find(pass => pass.id === 'msm-sample')?.samples || 0;
    if (sampleCount < observedSampleCount) consumedSampleCount = 0;
    observedSampleCount = sampleCount;
    const freshMeasurements = sampleCount > consumedSampleCount && sampleCount >= 2;
    if (!lastDecision || changingTier || warming || idle || freshMeasurements) {


      const spatialRetired = currentState.settings.spatialFilter === 'off';
      const activeLedger = spatialRetired
        ? { ...ledger, passes: ledger.passes.filter(pass => pass.id !== 'msm-spatial') } : ledger;
      lastDecision = governor.sample({ nowMs: now(), tier, ledger: activeLedger,
        isIdle: idle && !changingTier, hold: (warming || !freshMeasurements) && !changingTier });
      if (!warming && !idle && freshMeasurements) consumedSampleCount = sampleCount;
    }
    return lastDecision.settings;
  }
  function measure(id, work) {
    if (!collectMeasurements) return work();
    timing?.begin(id);
    try { return work(); } finally { timing?.end(); }
  }
  function measureCpu(id, work) {
    if (!collectMeasurements) return work();
    timing?.beginCpu(id);
    try { return work(); } finally { timing?.endCpu(); }
  }
  return { beginFrame, finishFrame, measure, measureCpu,
    reset: () => { consumedSampleCount = 0; observedSampleCount = 0; lastDecision = null; governor.reset(); },
    describe: () => ({ mode: timing?.isGpuTimer() ? 'gpu' : timing ? 'cpu-estimated' : 'not-measured',
      scope: 'MSM passes and CPU feed; native atlas and forward base cost remain in their owners',
      lastDecision, state: governor.getState(),
      passes: timing?.getLedger().passes.filter(pass => pass.id.startsWith('msm-')) || [] }),
    dispose: () => { finishFrame(); ownedTiming?.dispose(); ownedTiming = null; timing = null; } };
}
