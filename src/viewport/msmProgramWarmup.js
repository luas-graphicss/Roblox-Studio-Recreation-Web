import { planMsmWarmup, MSM_WARMUP_SLICE } from '../lighting/megalightsSm/msmWarmupPlanCore.js';
import { createMsmWarmupRunner, MSM_WARMUP_STATE } from '../lighting/megalightsSm/msmWarmupRunnerCore.js';
export { compileMsmMaterial } from './msmShaderPreparation.js';

const GPU_PRIME_SLICE = 'prime-gpu-program';
export function createMsmProgramWarmup({ renderer, camera, sample, denoise, targets }) {
  let runner = createMsmWarmupRunner();
  let armed = false;
  const jobs = [];
  const counts = { allocations: 0, noiseBuilds: 0, programCompiles: 0, depthWarmupFrames: 0, gridBuilds: 0, gpuPrimeDraws: 0 };
  function arm(tier) {
    const base = planMsmWarmup({ transition: 'ignite', tier, compositeMode: 'A', atlasPageCount: 0 });
    const steps = [];
    for (const step of base.steps) {
      if (step.slice === MSM_WARMUP_SLICE.OPEN_ATLAS_PAGE) continue;
      steps.push({ ...step, programOrdinal: 0 });
      if (step.slice === MSM_WARMUP_SLICE.ALLOCATE_TARGETS && !sample.isNoiseReady()) {
        steps.push({ ...step, stepKey: step.stepKey + '-noise', noise: true,
          description: 'Decode and upload the precomputed STBN texture data' });
      }
      if (step.slice === MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM) {
        for (let index = 1; index < 5; index += 1) steps.push({ ...step,
          stepKey: step.stepKey + '-filter-' + index, programOrdinal: index,
          description: index === 4 ? 'Warm the shared depth target and shader' : 'Submit one temporal, moment or spatial program' });
      }
    }
    const template = base.steps.find(step => step.slice === MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM);
    for (let index = 0; index < 4; index += 1) steps.push({ ...template,
      slice: GPU_PRIME_SLICE, stepKey: GPU_PRIME_SLICE + '-' + index, programOrdinal: index,
      description: 'Execute one unpublished GPU pass to warm first-use uniforms and driver state' });
    runner.arm({ ...base, atlasPageCount: 0,
      steps: steps.map((step, index) => ({ ...step, index })), frameCount: steps.length });
    armed = true;
  }
  function tick(state, budget) {
    if (!armed) arm(state.tier);
    if (!runner.isActive()) return;
    const next = runner.currentPlan().steps[runner.snapshot().stepIndex];
    const drawsSharedDepth = next.slice === MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM && next.programOrdinal === 4;
    if (next.slice === GPU_PRIME_SLICE || drawsSharedDepth) {


      for (const job of jobs) job.poll({ prepare: false });
      if (jobs.some(job => !job.compiled && !job.ready && !job.error)) return;

      const preparation = jobs.find(job => !job.ready && !job.error);
      if (preparation) { preparation.poll(); return; }
    }
    runner.tick({ now: () => performance.now(), runSlice: step => {
      const failedJob = jobs.find(job => job.error);
      if (failedJob) throw failedJob.error;
      if (step.slice === MSM_WARMUP_SLICE.ALLOCATE_TARGETS) {
        if (step.noise) { if (sample.warmupNoise()) counts.noiseBuilds += 1; }
        else { targets.ensure(budget.width, budget.height); targets.allocateGpu(); counts.allocations += 1; }
      } else if (step.slice === MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM) {
        if (step.programOrdinal === 4) {
          sample.warmupSharedDepth(budget.fullWidth, budget.fullHeight); counts.depthWarmupFrames += 1;
        } else {
          const job = step.programOrdinal === 0 ? sample.warmupProgram(renderer) : denoise.warmupProgram(renderer, step.programOrdinal - 1);
          if (job) jobs.push(job);
          counts.programCompiles += 1;
        }
      } else if (step.slice === MSM_WARMUP_SLICE.BUILD_WORLD_GRID) {
        if (!sample.applyState(state)) throw new Error('MSM warmup has no executable sample state');
        counts.gridBuilds += 1;
      } else if (step.slice === GPU_PRIME_SLICE) {
        const previousTarget = renderer.getRenderTarget();
        try {
          const frameTargets = targets.frame();
          if (step.programOrdinal === 0) {
            if (!sample.render(renderer, budget.fullWidth, budget.fullHeight, { target: frameTargets.sample, budget, frame: 0 }))
              throw new Error('MSM sample first-use warmup failed');
          } else denoise.primeGpuProgram(renderer, { targets: frameTargets, camera,
            sceneUniforms: sample.sceneUniforms(), alpha: 1, threshold: 0.04, mode: state.mode, valid: false, mipmapped: false }, step.programOrdinal - 1);
          counts.gpuPrimeDraws += 1;
        } finally { renderer.setRenderTarget(previousTarget); }
      } else throw new Error('Unsupported MSM warmup slice: ' + step.slice);
    } });
  }
  function cancelJobs() { for (const job of jobs) job.cancel(); jobs.length = 0; }
  return { tick,
    ready: () => armed && runner.snapshot().state === MSM_WARMUP_STATE.DONE,
    aborted: () => runner.snapshot().state === MSM_WARMUP_STATE.ABORTED,
    contextLost: () => { cancelJobs(); runner.noteContextLost(); },
    reset: () => { cancelJobs(); runner.cancel('rearm'); runner = createMsmWarmupRunner(); armed = false; },
    dispose: cancelJobs,
    describe: () => ({ ...runner.snapshot(), ...counts, frameTimeMeasured: false,
      pendingPrograms: jobs.filter(job => !job.ready && !job.error).length,
      validatedPrograms: jobs.reduce((total, job) => total + job.validatedPrograms, 0),
      worstProgramCpuMs: Math.max(0, ...jobs.map(job => job.cpuMs)),
      programs: jobs.map(job => ({ name: job.name, compiled: job.compiled, ready: job.ready,
        cpuMs: job.cpuMs, waitMs: job.waitMs, error: job.error?.message || null })),
      atlasOwner: 'shared native allocator' }),
  };
}
